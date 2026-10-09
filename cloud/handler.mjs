import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { put, get, del } from '@vercel/blob';
import { cloudDatabase } from './database.mjs';
import { normalize,digest,checkPassword,fail,textField,photoCrypto } from './security.mjs';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const json=(res,status,data) => { res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const now=() => new Date().toISOString();
const defaults={ title:'LOS CEDROS NIGHT',subtitle:'Una noche para encontrarnos.',date:'',time:'',location:'Los Cedros Rugby Club',description:'Los colores de siempre. Una noche distinta. Sumate a compartir música, amigos y toda la energía del club.' };
export function createCloudHandler(options={}) {
  const db=options.db || cloudDatabase();
  const crypto=photoCrypto(options.photoKey || Buffer.from(process.env.PHOTO_KEY || '','base64'));
  const blobs=options.blobs || {
    async save(path,bytes) { return (await put(path,bytes,{ access:'private',contentType:'application/octet-stream',addRandomSuffix:false })).pathname; },
    async read(path) { const result=await get(path,{ access:'private',useCache:false }); if (!result || result.statusCode!==200) fail(404,'Foto no encontrada.'); return Buffer.from(await new Response(result.stream).arrayBuffer()); },
    remove: (path) => del(path)
  };
  const secure=options.secureCookies ?? true;
  const q=(text,params=[]) => db.query(text,params);
  const one=async (text,params=[]) => (await q(text,params))[0];
  const settings=async () => Object.fromEntries((await q('SELECT key,value FROM settings')).filter((s) => !s.key.startsWith('_')).map((s) => [s.key,s.value]));
  const auditStatement=(user,action,target) => ['INSERT INTO audit(user_id,action,target_id,created_at) VALUES($1,$2,$3,$4)',[user?.id || null,action,target,now()]];
  const mutate=async (statements,user,action,target) => db.transaction([...statements,auditStatement(user,action,target),['UPDATE changes SET version=version+1 WHERE id=1']]);
  const session=async (req) => {
    const token=/(?:^|;\s*)lc_session=([a-zA-Z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
    return token ? one('SELECT u.id,u.username,u.role,s.token_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2',[digest(token),Date.now()]) : null;
  };
  const requireUser=async (req,role) => { const user=await session(req); if (!user) fail(401,'Iniciá sesión para continuar.'); if (role && user.role!==role) fail(403,'No tenés permiso para esta acción.'); return user; };
  const limiter=async (req,kind,max,window=60000) => {
    // Vercel supplies this header at the edge; never trust a client-supplied x-forwarded-for.
    const ip=process.env.VERCEL ? String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0] : req.socket?.remoteAddress || 'local';
    const key=digest(`${kind}:${ip}`); const time=Date.now();
    const r=await one(`INSERT INTO rate_limits(key,count,until) VALUES($1,1,$2)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.until<$3 THEN 1 ELSE rate_limits.count+1 END,
      until=CASE WHEN rate_limits.until<$3 THEN $2 ELSE rate_limits.until END RETURNING count`,[key,time+window,time]);
    if (r.count>max) fail(429,'Demasiados intentos. Esperá unos minutos y volvé a intentar.');
  };
  const readBody=async (req) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'Formato de solicitud inválido.');
    if (Number(req.headers['content-length'])>4_000_000) fail(413,'La foto es demasiado grande. Volvé a elegirla para optimizarla.');
    // Vercel may have already parsed req.body; standalone Node passes a readable stream.
    let body=req.body;
    if (body===undefined) { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if (size>4_000_000) fail(413,'La foto es demasiado grande.'); chunks.push(chunk); } body=Buffer.concat(chunks).toString(); }
    if (typeof body==='string' || Buffer.isBuffer(body)) { try { body=JSON.parse(String(body)); } catch { fail(400,'Datos inválidos.'); } }
    if (!body || typeof body!=='object' || Array.isArray(body)) fail(400,'Datos inválidos.'); return body;
  };
  const publicInviter=async (slug,token) => {
    if (!token || token.length>64) fail(404,'Este link de invitación no es válido.');
    const i=await one('SELECT * FROM inviters WHERE slug=$1 AND token=$2',[slug,token]);
    if (!i) fail(404,'Este link de invitación no es válido.'); if (!i.active) fail(410,'Esta invitación fue revocada. Contactá a quien te invitó.'); return i;
  };
  const inviterStats=() => q(`SELECT i.*,COUNT(g.id)::int AS registered,
    COUNT(g.id) FILTER(WHERE g.entered_at IS NOT NULL)::int AS entered,
    COUNT(g.id) FILTER(WHERE g.revoked=1)::int AS revoked,
    GREATEST(0,i.capacity-COUNT(g.id))::int AS available
    FROM inviters i LEFT JOIN guests g ON g.inviter_id=i.id GROUP BY i.id ORDER BY i.created_at DESC`);
  const guestsQuery=async (url) => {
    let query=normalize(url.searchParams.get('q') || '').slice(0,100); if (/^[\d.\s]+$/.test(query)) query=query.replace(/[.\s]/g,'');
    const params=[]; const clauses=[];
    for (const part of query.split(/\s+/).filter(Boolean).slice(0,8)) {
      params.push(`%${part.replace(/[\\%_]/g,'\\$&')}%`);
      clauses.push(`(g.search_name LIKE $${params.length} ESCAPE '\\' OR g.dni LIKE $${params.length} ESCAPE '\\')`);
    }
    const inviter=url.searchParams.get('inviter'); if (inviter) { params.push(inviter); clauses.push(`g.inviter_id=$${params.length}`); }
    const state=url.searchParams.get('state');
    if (state==='entered') clauses.push('g.entered_at IS NOT NULL');
    if (state==='pending') clauses.push('g.entered_at IS NULL AND g.revoked=0 AND i.active=1');
    if (state==='revoked') clauses.push('(g.revoked=1 OR i.active=0)');
    const where=clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page')) || 1)));
    const [count,guests]=await Promise.all([
      one(`SELECT COUNT(*)::int AS n FROM guests g JOIN inviters i ON i.id=g.inviter_id ${where}`,params),
      q(`SELECT g.id,g.inviter_id,g.first_name,g.last_name,g.dni,g.created_at,g.entered_at,g.revoked,i.name AS inviter_name,i.active AS inviter_active
      FROM guests g JOIN inviters i ON i.id=g.inviter_id ${where} ORDER BY g.last_name,g.first_name,g.dni LIMIT 50 OFFSET $${params.length+1}`,[...params,(page-1)*50])
    ]);
    return { guests,total:count.n,page,pages:Math.ceil(count.n/50) };
  };
  const stream=async (req,res,user) => {
    let version=(await one('SELECT version FROM changes WHERE id=1')).version;
    res.writeHead(200,{ 'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no' });
    res.write('event: connected\ndata: {}\n\n'); res.flushHeaders?.();
    let closed=false; res.on('close',() => closed=true);
    const deadline=Date.now()+(options.streamDuration || 25000);
    while (!closed && Date.now()<deadline) {
      await delay(options.pollInterval || 1000); if (closed) break;
      const current=await one('SELECT c.version,s.expires_at FROM changes c LEFT JOIN sessions s ON s.token_hash=$1 AND s.expires_at>$2 WHERE c.id=1',[user.token_hash,Date.now()]);
      if (!current.expires_at) break;
      if (String(current.version)!==String(version)) { version=current.version; res.write('event: update\ndata: {}\n\n'); }
      else res.write(': heartbeat\n\n');
    }
    if (!closed) res.end();
  };
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()'); if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method;
      if (!['GET','HEAD'].includes(method)) {
        if (req.headers['x-requested-with']!=='LosCedros') fail(403,'Solicitud no autorizada.');
        if (req.headers.origin) {
          const origin=new URL(req.headers.origin); const configured=options.publicUrl || process.env.PUBLIC_URL;
          if (configured ? origin.origin!==new URL(configured).origin : origin.host!==req.headers.host) fail(403,'Origen no autorizado.');
        }
      }
      if (path==='/api/health' && method==='GET') { await q('SELECT 1'); return json(res,200,{ ok:true,storage:'postgresql-private-blob' }); }
      if (path==='/api/event' && method==='GET') return json(res,200,await settings());
      if (path==='/api/session' && method==='GET') { const user=await session(req); return json(res,200,{ user:user ? { username:user.username,role:user.role } : null }); }
      if (path==='/api/login' && method==='POST') {
        await limiter(req,'login',30,900000); const body=await readBody(req);
        if (typeof body.password!=='string' || body.password.length>256 || typeof body.username!=='string' || body.username.length>80) fail(400,'Credenciales inválidas.');
        const user=await one('SELECT * FROM users WHERE username=$1',[body.username.trim().toLowerCase()]);
        const valid=checkPassword(body.password,user?.password || '00'.repeat(16)+':'+ '00'.repeat(64)); if (!user || !valid) fail(401,'Usuario o contraseña incorrectos.');
        const token=randomBytes(32).toString('base64url');
        await db.transaction([['DELETE FROM sessions WHERE expires_at<$1',[Date.now()]],['DELETE FROM rate_limits WHERE until<$1',[Date.now()]],['INSERT INTO sessions VALUES($1,$2,$3)',[digest(token),user.id,Date.now()+43200000]]]);
        res.setHeader('Set-Cookie',`lc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
        return json(res,200,{ user:{ username:user.username,role:user.role } });
      }
      if (path==='/api/logout' && method==='POST') { const user=await session(req); if (user) await q('DELETE FROM sessions WHERE token_hash=$1',[user.token_hash]); res.setHeader('Set-Cookie',`lc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`); return json(res,200,{ ok:true }); }
      const invitation=/^\/api\/invitation\/([^/]+)$/.exec(path);
      if (invitation && method==='GET') { await limiter(req,'invitation',150); const i=await publicInviter(invitation[1],url.searchParams.get('token')); const count=await one('SELECT COUNT(*)::int AS n FROM guests WHERE inviter_id=$1',[i.id]); return json(res,200,{ name:i.name,available:Math.max(0,i.capacity-count.n),event:await settings() }); }
      if (invitation && method==='POST') {
        await limiter(req,'register',25,600000); const i=await publicInviter(invitation[1],url.searchParams.get('token')); const body=await readBody(req);
        const first=textField(body.first_name,'Nombre'); const last=textField(body.last_name,'Apellido'); const dni=String(body.dni || '').replace(/[.\s]/g,'');
        if (!/^\d{7,8}$/.test(dni)) fail(400,'Ingresá un DNI válido de 7 u 8 números.'); if (body.consent!==true) fail(400,'Aceptá el uso de tus datos para el control de ingreso.');
        if (typeof body.photo!=='string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.photo)) fail(400,'Subí una foto del DNI en formato JPG, PNG o WebP.');
        const bytes=Buffer.from(body.photo.slice(body.photo.indexOf(',')+1),'base64'); if (bytes.length>2_800_000) fail(413,'La foto es demasiado grande. Volvé a elegirla para optimizarla.');
        let photo; try { const image=sharp(bytes,{ limitInputPixels:25000000,animated:false }); const meta=await image.metadata(); if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1)>1) throw new Error(); photo=await image.rotate().resize({ width:1600,height:1600,fit:'inside',withoutEnlargement:true }).jpeg({ quality:85 }).toBuffer(); } catch { fail(400,'No pudimos leer la foto. Subí una imagen válida.'); }
        const id=randomUUID(); const photoPath=await blobs.save(`dni/${id}.bin`,crypto.encrypt(photo));
        try { await q('SELECT register_guest($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,invitation[1],url.searchParams.get('token'),first,last,dni,normalize(`${first} ${last}`),photoPath,now()]); }
        catch (e) {
          // A network failure may occur after COMMIT. Keep the document when registration actually succeeded.
          let committed; try { committed=await one('SELECT id FROM guests WHERE id=$1',[id]); } catch { throw e; }
          if (!committed) { try { await blobs.remove(photoPath); } catch { console.error('No se pudo limpiar una foto de registro fallido.'); } throw e; }
        }
        return json(res,201,{ ok:true,first_name:first,last_name:last,inviter_name:i.name });
      }
      if (path==='/api/events' && method==='GET') return await stream(req,res,await requireUser(req));
      if (path==='/api/stats' && method==='GET') {
        await requireUser(req);
        const [totals,other]=await Promise.all([
          one(`SELECT COUNT(*)::int AS registered,COUNT(*) FILTER(WHERE g.entered_at IS NOT NULL)::int AS entered,
            COUNT(*) FILTER(WHERE g.revoked=1 OR i.active=0)::int AS revoked,
            COUNT(*) FILTER(WHERE g.entered_at IS NULL AND g.revoked=0 AND i.active=1)::int AS pending
            FROM guests g JOIN inviters i ON i.id=g.inviter_id`),
          one(`SELECT COUNT(*)::int AS inviters,COALESCE(SUM(CASE WHEN active=1 THEN GREATEST(0,capacity-(SELECT COUNT(*) FROM guests g WHERE g.inviter_id=i.id)) ELSE 0 END),0)::int AS available FROM inviters i`)
        ]); return json(res,200,{ ...totals,...other });
      }
      if (path==='/api/guests' && method==='GET') { await requireUser(req); return json(res,200,await guestsQuery(url)); }
      const guestRoute=/^\/api\/guests\/([a-f0-9-]+)\/(photo|enter|revoke)$/.exec(path);
      if (guestRoute) {
        const user=await requireUser(req,guestRoute[2]==='revoke' ? 'admin' : undefined);
        if (guestRoute[2]==='enter' && method==='POST') { const result=await one('SELECT * FROM enter_guest($1,$2,$3)',[guestRoute[1],user.id,now()]); return json(res,200,{ ok:true,...result }); }
        const guest=await one('SELECT g.*,i.active AS inviter_active FROM guests g JOIN inviters i ON i.id=g.inviter_id WHERE g.id=$1',[guestRoute[1]]); if (!guest) fail(404,'Invitado no encontrado.');
        if (guestRoute[2]==='photo' && method==='GET') { const photo=crypto.decrypt(await blobs.read(guest.photo_path)); await db.transaction([auditStatement(user,'photo_viewed',guest.id)]); res.writeHead(200,{ 'Content-Type':'image/jpeg','Content-Disposition':'inline; filename="documento.jpg"' }); return res.end(photo); }
        if (guestRoute[2]==='revoke' && method==='POST') { const body=await readBody(req); if (typeof body.revoked!=='boolean') fail(400,'Estado inválido.'); await mutate([['UPDATE guests SET revoked=$1 WHERE id=$2',[Number(body.revoked),guest.id]]],user,body.revoked ? 'guest_revoked' : 'guest_restored',guest.id); return json(res,200,{ ok:true }); }
      }
      if (path==='/api/inviters' && method==='GET') { await requireUser(req,'admin'); return json(res,200,{ inviters:await inviterStats() }); }
      if (path==='/api/inviters' && method==='POST') { const user=await requireUser(req,'admin'); const body=await readBody(req); const name=textField(body.name,'Nombre del invitador'); if (!Number.isInteger(body.capacity) || body.capacity<1 || body.capacity>10000) fail(400,'El cupo debe ser entre 1 y 10.000.'); const id=randomUUID(); const slug=normalize(name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'invitador'; await mutate([['INSERT INTO inviters VALUES($1,$2,$3,$4,$5,1,$6)',[id,name,slug,randomBytes(32).toString('base64url'),body.capacity,now()]]],user,'inviter_created',id); return json(res,201,{ inviter:(await inviterStats()).find((i) => i.id===id) }); }
      const inviterRoute=/^\/api\/inviters\/([a-f0-9-]+)$/.exec(path);
      if (inviterRoute && method==='PATCH') {
        const user=await requireUser(req,'admin'); const body=await readBody(req);
        if (body.capacity!==undefined && (!Number.isInteger(body.capacity) || body.capacity<0 || body.capacity>10000)) fail(400,'El cupo debe ser entre 0 y 10.000.');
        if (body.active!==undefined && typeof body.active!=='boolean' || body.rotate!==undefined && typeof body.rotate!=='boolean') fail(400,'Estado inválido.');
        await q('SELECT update_inviter($1,$2,$3,$4,$5,$6,$7)',[inviterRoute[1],body.capacity ?? null,body.active===undefined ? null : Number(body.active),body.rotate===true,user.id,randomBytes(32).toString('base64url'),now()]);
        return json(res,200,{ inviter:(await inviterStats()).find((i) => i.id===inviterRoute[1]) });
      }
      if (path==='/api/settings' && method==='PATCH') {
        const user=await requireUser(req,'admin'); const body=await readBody(req); const values=await settings();
        for (const key of Object.keys(defaults)) { if (body[key]===undefined) continue; if (typeof body[key]!=='string' || body[key].length>(key==='description' ? 600 : 120)) fail(400,'Datos del evento inválidos.'); values[key]=body[key].trim(); }
        if (values.title.length<2 || values.location.length<2) fail(400,'Completá título y lugar.'); const date=new Date(`${values.date}T12:00:00Z`);
        if (values.date && (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==values.date)) fail(400,'Fecha inválida.');
        if (values.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time)) fail(400,'Horario inválido.');
        await mutate(Object.entries(values).map(([key,value]) => ['UPDATE settings SET value=$1 WHERE key=$2',[value,key]]),user,'event_updated','event'); return json(res,200,values);
      }
      if (path.startsWith('/api/')) fail(404,'Ruta no encontrada.');
      if (!['GET','HEAD'].includes(method)) fail(405,'Método no permitido.');
      const assets={ '/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/assets/escudo.png':['assets/escudo.png','image/png'],'/assets/club.jpeg':['assets/club.jpeg','image/jpeg'] };
      const asset=assets[path]; if (!asset && !['/','/admin','/seguridad','/login'].includes(path) && !/^\/invitacion\/[^/]+$/.test(path)) fail(404,'Página no encontrada.');
      res.writeHead(200,{ 'Content-Type':asset?.[1] || 'text/html; charset=utf-8' }); return res.end(method==='HEAD' ? undefined : readFileSync(join(ROOT,'public',asset?.[0] || 'index.html')));
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const codes={ INVALID_LINK:[404,'Este link de invitación no es válido.'],REVOKED:[403,'Acceso revocado. Consultá a administración.'],DUPLICATE_DNI:[409,'Este DNI ya está registrado para el evento.'],FULL:[409,'Este invitador ya completó su cupo.'],NOT_FOUND:[404,'Invitado no encontrado.'],CAPACITY_TOO_SMALL:[400,'El cupo no puede ser menor a la cantidad de registrados.'] };
      const mapped=e.code==='23505' ? codes.DUPLICATE_DNI : codes[e.message];
      if (!e.status && !mapped) console.error('Error de servicio:',e.code || e.name);
      json(res,e.status || mapped?.[0] || 503,{ error:e.status ? e.message : mapped?.[1] || 'No pudimos completar la operación. Volvé a intentar.' });
    }
  };
}
