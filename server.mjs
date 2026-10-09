import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
export const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const checkPassword = (password, stored) => {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const textField = (value, label, max = 80) => {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > max || /[\x00-\x1f<>]/.test(value)) fail(400, `${label}: completá entre 2 y ${max} caracteres.`);
  return value.trim().replace(/\s+/g, ' ');
};

export function createApplication(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(ROOT, 'data'));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'cedros.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','security'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inviters (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL, capacity INTEGER NOT NULL CHECK(capacity >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guests (
      id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL REFERENCES inviters(id),
      first_name TEXT NOT NULL, last_name TEXT NOT NULL, dni TEXT UNIQUE NOT NULL,
      search_name TEXT NOT NULL, photo BLOB NOT NULL,
      created_at TEXT NOT NULL, entered_at TEXT, entered_by TEXT REFERENCES users(id),
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
    );
    CREATE INDEX IF NOT EXISTS guests_inviter ON guests(inviter_id);
    CREATE INDEX IF NOT EXISTS guests_search ON guests(search_name);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const keyFile = join(dataDir, 'photo.key');
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const defaults = { title: 'LOS CEDROS NIGHT', subtitle: 'Una noche para encontrarnos.', date: '', time: '', location: 'Los Cedros Rugby Club', description: 'Los colores de siempre. Una noche distinta. Sumate a compartir música, amigos y toda la energía del club.' };
  for (const [key, value] of Object.entries({...defaults,_registration_capacity:'10000',_registration_active:'1'})) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(key, value);
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    const credentials = [];
    for (const [username, role] of [['admin', 'admin'], ['seguridad', 'security']]) {
      const password = options.passwords?.[username] || randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(randomUUID(), username, hashPassword(password), role);
      credentials.push(`${username}: ${password}`);
    }
    if (!options.passwords) writeFileSync(join(dataDir, 'accesos-iniciales.txt'), `LOS CEDROS NIGHT — ACCESOS PRIVADOS\n\n${credentials.join('\n')}\n\nCambiar claves: npm run password -- admin\nNo compartir este archivo ni publicarlo.\n`, { mode: 0o600 });
  }
  const clients = new Set();
  const rateLimits = new Map();
  const now = () => new Date().toISOString();
  const audit = (user, action, target) => db.prepare('INSERT INTO audit(user_id,action,target_id,created_at) VALUES (?,?,?,?)').run(user?.id || null, action, target, now());
  const getSettings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().filter(s=>!s.key.startsWith('_')).map((s) => [s.key, s.value]));
  const session = (req) => {
    const token = /(?:^|;\s*)lc_session=([a-zA-Z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return db.prepare('SELECT u.id,u.username,u.role,s.expires_at,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now());
  };
  const requireUser = (req, role) => {
    const user = session(req);
    if (!user) fail(401, 'Iniciá sesión para continuar.');
    if (role && user.role !== role) fail(403, 'No tenés permiso para esta acción.');
    return user;
  };
  const broadcast = () => {
    for (const client of clients) {
      if (!db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(client.tokenHash, Date.now())) { client.res.end(); clients.delete(client); }
      else client.res.write('event: update\ndata: {}\n\n');
    }
  };
  const limiter = (req, kind, max, window = 60_000) => {
    const key = `${kind}:${req.socket.remoteAddress}`;
    const t = Date.now();
    let record = rateLimits.get(key);
    if (!record || record.until < t) { record = { count: 0, until: t + window }; rateLimits.set(key, record); }
    if (++record.count > max) fail(429, 'Demasiados intentos. Esperá unos minutos y volvé a intentar.');
  };
  const readBody = async (req) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Formato de solicitud inválido.');
    if (Number(req.headers['content-length']) > 16000) fail(413, 'La solicitud es demasiado grande.');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16000) fail(413, 'La solicitud es demasiado grande.'); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Datos inválidos.'); return body; }
    catch { fail(400, 'Datos inválidos.'); }
  };
  const registration = () => {
    const capacity=Number(db.prepare("SELECT value FROM settings WHERE key='_registration_capacity'").get().value);
    const active=db.prepare("SELECT value FROM settings WHERE key='_registration_active'").get().value==='1';
    return {capacity,active,available:Math.max(0,capacity-db.prepare('SELECT COUNT(*) AS n FROM guests').get().n),event:getSettings()};
  };
  const inviterStats = () => db.prepare(`SELECT i.*, COUNT(g.id) AS registered,
    COALESCE(SUM(CASE WHEN g.entered_at IS NOT NULL THEN 1 ELSE 0 END),0) AS entered,
    COALESCE(SUM(CASE WHEN g.revoked=1 THEN 1 ELSE 0 END),0) AS revoked,
    MAX(0,i.capacity-COUNT(g.id)) AS available
    FROM inviters i LEFT JOIN guests g ON g.inviter_id=i.id GROUP BY i.id ORDER BY i.created_at DESC`).all();
  const guestsQuery = (url) => {
    let query = normalize(url.searchParams.get('q') || '').slice(0, 100);
    if (/^[\d.\s]+$/.test(query)) query = query.replace(/[.\s]/g, '');
    const parts = query.split(/\s+/).filter(Boolean).slice(0, 8);
    const params = [];
    const clauses = parts.map((part) => {
      const escaped = `%${part.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(escaped, escaped);
      return "(g.search_name LIKE ? ESCAPE '\\' OR g.dni LIKE ? ESCAPE '\\')";
    });
    const inviter = url.searchParams.get('inviter');
    if (inviter) { clauses.push('g.inviter_id=?'); params.push(inviter); }
    const state = url.searchParams.get('state');
    if (state === 'entered') clauses.push('g.entered_at IS NOT NULL');
    if (state === 'pending') clauses.push('g.entered_at IS NULL AND g.revoked=0 AND i.active=1');
    if (state === 'revoked') clauses.push('(g.revoked=1 OR i.active=0)');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const page = Math.max(1, Math.min(100_000, Number(url.searchParams.get('page')) || 1));
    const total = db.prepare(`SELECT COUNT(*) AS n FROM guests g JOIN inviters i ON i.id=g.inviter_id ${where}`).get(...params).n;
    const guests = db.prepare(`SELECT g.id,g.inviter_id,g.first_name,g.last_name,g.dni,g.created_at,g.entered_at,g.revoked,i.name AS inviter_name,i.active AS inviter_active
      FROM guests g JOIN inviters i ON i.id=g.inviter_id ${where} ORDER BY g.last_name COLLATE NOCASE,g.first_name COLLATE NOCASE,g.dni LIMIT 50 OFFSET ?`).all(...params, (page - 1) * 50);
    return { guests, total, page, pages: Math.ceil(total / 50) };
  };
  const securityHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.SECURE_COOKIES === 'true') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers['x-requested-with'] !== 'LosCedros') fail(403, 'Solicitud no autorizada.');
        const expectedOrigin = options.publicUrl || process.env.PUBLIC_URL;
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (expectedOrigin ? origin.origin !== new URL(expectedOrigin).origin : origin.host !== req.headers.host) fail(403, 'Origen no autorizado.');
        }
      }
      if (path === '/api/event' && method === 'GET') return json(res, 200, getSettings());
      if (path === '/api/session' && method === 'GET') {
        const user = session(req);
        return json(res, 200, { user: user ? { username: user.username, role: user.role } : null });
      }
      if (path === '/api/login' && method === 'POST') {
        limiter(req, 'login', 15, 15 * 60_000);
        const body = await readBody(req);
        if (typeof body.password !== 'string' || body.password.length > 256 || typeof body.username !== 'string') fail(400, 'Credenciales inválidas.');
        const user = db.prepare('SELECT * FROM users WHERE username=?').get(body.username.trim().toLowerCase());
        const dummy = '00000000000000000000000000000000:' + '00'.repeat(64);
        const valid = checkPassword(body.password, user?.password || dummy);
        if (!user || !valid) fail(401, 'Usuario o contraseña incorrectos.');
        const token = randomBytes(32).toString('base64url');
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, Date.now() + 12 * 3600_000);
        res.setHeader('Set-Cookie', `lc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`);
        return json(res, 200, { user: { username: user.username, role: user.role } });
      }
      if (path === '/api/logout' && method === 'POST') {
        const user = session(req);
        if (user) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
        res.setHeader('Set-Cookie', 'lc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        broadcast(); return json(res, 200, { ok: true });
      }
      if (path.startsWith('/api/invitation/')) fail(410,'Usá el link general /invitacion para registrarte.');
      if (path === '/api/registration' && method === 'GET') { limiter(req,'invitation',150); return json(res,200,registration()); }
      if (path === '/api/registration' && method === 'PATCH') {
        const user=requireUser(req,'admin'); const body=await readBody(req);
        if (!Number.isInteger(body.capacity) || body.capacity<0 || body.capacity>10000 || typeof body.active!=='boolean') fail(400,'Cupo o estado inválido.');
        if (body.capacity<db.prepare('SELECT COUNT(*) AS n FROM guests').get().n) fail(400,'El cupo no puede ser menor a los registrados.');
        db.exec('BEGIN IMMEDIATE');
        try { db.prepare("UPDATE settings SET value=? WHERE key='_registration_capacity'").run(String(body.capacity)); db.prepare("UPDATE settings SET value=? WHERE key='_registration_active'").run(body.active ? '1':'0'); audit(user,'registration_updated','event'); db.exec('COMMIT'); }
        catch(e) { db.exec('ROLLBACK'); throw e; }
        broadcast(); return json(res,200,registration());
      }
      if (path === '/api/registration' && method === 'POST') {
        limiter(req,'register',25,600000); const body=await readBody(req);
        const firstName=textField(body.first_name,'Nombre'); const lastName=textField(body.last_name,'Apellido');
        const inviterName=textField(body.inviter_name,'Nombre de quien te invita'); const dni=String(body.dni || '').replace(/[.\s]/g,'');
        if (!/^\d{7,8}$/.test(dni)) fail(400,'Ingresá un DNI válido de 7 u 8 números.');
        if (body.consent!==true) fail(400,'Aceptá el uso de tus datos para el control de ingreso.');
        const id=randomUUID(); let inviter;
        db.exec('BEGIN IMMEDIATE');
        try {
          const config=registration(); if (!config.active) fail(410,'El registro está cerrado.');
          if (db.prepare('SELECT id FROM guests WHERE dni=?').get(dni)) fail(409,'Este DNI ya está registrado para el evento.');
          if (!config.available) fail(409,'El cupo del evento está completo.');
          inviter=db.prepare('SELECT * FROM inviters ORDER BY created_at,id').all().find(i=>normalize(i.name)===normalize(inviterName));
          if (inviter && !inviter.active) fail(403,'Acceso revocado. Consultá a administración.');
          if (!inviter) { inviter={id:randomUUID(),name:inviterName}; db.prepare('INSERT INTO inviters VALUES(?,?,?,?,?,1,?)').run(inviter.id,inviter.name,'shared-'+inviter.id,randomBytes(32).toString('base64url'),10000,now()); }
          db.prepare('INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,inviter.id,firstName,lastName,dni,normalize(firstName+' '+lastName),Buffer.alloc(0),now());
          audit(null,'registered',id); db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        broadcast(); return json(res,201,{ok:true,first_name:firstName,last_name:lastName,inviter_name:inviter.name});
      }
      if (path === '/api/events' && method === 'GET') {
        const user = requireUser(req);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('event: connected\ndata: {}\n\n');
        const client = { res, tokenHash: user.token_hash };
        clients.add(client); req.on('close', () => clients.delete(client)); return;
      }
      if (path === '/api/stats' && method === 'GET') {
        requireUser(req);
        const totals = db.prepare(`SELECT COUNT(*) AS registered, COALESCE(SUM(entered_at IS NOT NULL),0) AS entered,
          COALESCE(SUM(CASE WHEN g.revoked=1 OR i.active=0 THEN 1 ELSE 0 END),0) AS revoked
          FROM guests g JOIN inviters i ON g.inviter_id=i.id`).get();
        const available = db.prepare(`SELECT COALESCE(SUM(MAX(0,capacity-(SELECT COUNT(*) FROM guests g WHERE g.inviter_id=i.id))),0) AS n FROM inviters i WHERE active=1`).get().n;
        const pending = db.prepare('SELECT COUNT(*) AS n FROM guests g JOIN inviters i ON i.id=g.inviter_id WHERE g.entered_at IS NULL AND g.revoked=0 AND i.active=1').get().n;
        return json(res, 200, { ...totals, available: registration().active ? registration().available : 0, pending, inviters: db.prepare('SELECT COUNT(*) AS n FROM inviters').get().n });
      }
      if (path === '/api/guests' && method === 'GET') { requireUser(req); return json(res, 200, guestsQuery(url)); }
      const guestRoute = /^\/api\/guests\/([a-f0-9-]+)\/(enter|revoke)$/.exec(path);
      if (guestRoute) {
        const user = requireUser(req, guestRoute[2] === 'revoke' ? 'admin' : undefined);
        const guest = db.prepare('SELECT g.*,i.active AS inviter_active FROM guests g JOIN inviters i ON i.id=g.inviter_id WHERE g.id=?').get(guestRoute[1]);
        if (!guest) fail(404, 'Invitado no encontrado.');
        if (guestRoute[2] === 'enter' && method === 'POST') {
          if (guest.revoked || !guest.inviter_active) fail(403, 'Acceso revocado. Consultá a administración.');
          const timestamp = now();
          const result = db.prepare('UPDATE guests SET entered_at=?,entered_by=? WHERE id=? AND entered_at IS NULL AND revoked=0 AND EXISTS (SELECT 1 FROM inviters i WHERE i.id=guests.inviter_id AND i.active=1)').run(timestamp, user.id, guest.id);
          if (result.changes) { audit(user, 'entered', guest.id); broadcast(); }
          return json(res, 200, { ok: true, already_entered: !result.changes, entered_at: result.changes ? timestamp : guest.entered_at });
        }
        if (guestRoute[2] === 'revoke' && method === 'POST') {
          const body = await readBody(req);
          if (typeof body.revoked !== 'boolean') fail(400, 'Estado inválido.');
          db.prepare('UPDATE guests SET revoked=? WHERE id=?').run(body.revoked ? 1 : 0, guest.id);
          audit(user, body.revoked ? 'guest_revoked' : 'guest_restored', guest.id); broadcast();
          return json(res, 200, { ok: true });
        }
      }
      if (path === '/api/inviters' && method === 'GET') { requireUser(req, 'admin'); return json(res, 200, { inviters: inviterStats() }); }
      const inviterRoute = /^\/api\/inviters\/([a-f0-9-]+)$/.exec(path);
      if (inviterRoute && method === 'PATCH') {
        const user = requireUser(req, 'admin');
        const body = await readBody(req);
        if (body.capacity!==undefined || body.rotate!==undefined) fail(400,'Solo se permite cambiar el estado de acceso.');
        const inviter = db.prepare('SELECT * FROM inviters WHERE id=?').get(inviterRoute[1]);
        if (!inviter) fail(404, 'Invitador no encontrado.');
        const count = db.prepare('SELECT COUNT(*) AS n FROM guests WHERE inviter_id=?').get(inviter.id).n;
        const capacity = body.capacity ?? inviter.capacity;
        if (!Number.isInteger(capacity) || (body.capacity !== undefined && capacity < count) || capacity < 0 || capacity > 10_000) fail(400, `El cupo debe ser entre ${count} y 10.000; no puede ser menor a los registrados.`);
        if (body.active !== undefined && typeof body.active !== 'boolean') fail(400, 'Estado inválido.');
        if (body.rotate !== undefined && typeof body.rotate !== 'boolean') fail(400, 'Acción inválida.');
        const active = body.active === undefined ? inviter.active : Number(body.active);
        const token = body.rotate === true ? randomBytes(32).toString('base64url') : inviter.token;
        db.prepare('UPDATE inviters SET capacity=?,active=?,token=? WHERE id=?').run(capacity, active, token, inviter.id);
        audit(user, body.rotate ? 'link_rotated' : active ? 'inviter_updated' : 'inviter_revoked', inviter.id);
        broadcast(); return json(res, 200, { inviter: inviterStats().find((i) => i.id === inviter.id) });
      }
      if (path === '/api/settings' && method === 'PATCH') {
        const user = requireUser(req, 'admin');
        const body = await readBody(req);
        const values = getSettings();
        for (const key of Object.keys(defaults)) {
          if (body[key] === undefined) continue;
          if (typeof body[key] !== 'string' || body[key].length > (key === 'description' ? 600 : 120)) fail(400, 'Datos del evento inválidos.');
          values[key] = body[key].trim();
        }
        if (values.title.length < 2 || values.location.length < 2) fail(400, 'Completá título y lugar.');
        const eventDate = new Date(`${values.date}T12:00:00Z`);
        if (values.date && (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(eventDate.getTime()) || eventDate.toISOString().slice(0,10) !== values.date)) fail(400, 'Fecha inválida.');
        if (values.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time)) fail(400, 'Horario inválido.');
        db.exec('BEGIN IMMEDIATE');
        try { for (const [key, value] of Object.entries(values)) db.prepare('UPDATE settings SET value=? WHERE key=?').run(value, key); db.exec('COMMIT'); }
        catch (e) { db.exec('ROLLBACK'); throw e; }
        audit(user, 'event_updated', 'event'); broadcast(); return json(res, 200, values);
      }
      if (path.startsWith('/api/')) fail(404, 'Ruta no encontrada.');
      if (method !== 'GET' && method !== 'HEAD') fail(405, 'Método no permitido.');
      const assets = {
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/assets/escudo.png': ['assets/escudo.png', 'image/png'],
        '/assets/club.jpeg': ['assets/club.jpeg', 'image/jpeg']
      };
      const asset = assets[path];
      if (!asset && !['/', '/invitacion', '/admin', '/seguridad', '/login'].includes(path) && !/^\/invitacion\/[^/]+$/.test(path)) fail(404, 'Página no encontrada.');
      const file = join(ROOT, 'public', asset?.[0] || 'index.html');
      res.writeHead(200, { 'Content-Type': asset?.[1] || 'text/html; charset=utf-8' });
      return res.end(method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!error.status) console.error('Error interno:', error.message);
      json(res, error.status || 500, { error: error.status ? error.message : 'No pudimos completar la operación. Volvé a intentar.' });
    }
  });
  const heartbeat = setInterval(() => {
    for (const [key, record] of rateLimits) if (record.until < Date.now()) rateLimits.delete(key);
    for (const client of clients) {
      if (!db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(client.tokenHash, Date.now())) { client.res.end(); clients.delete(client); }
      else client.res.write(': heartbeat\n\n');
    }
  }, 20_000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); for (const client of clients) client.res.end(); db.close(); });
  return { server, db, dataDir, close: () => { for (const client of clients) client.res.end(); server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApplication();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Los Cedros Night: http://localhost:${port}`);
    console.log(`Accesos privados iniciales: ${join(app.dataDir, 'accesos-iniciales.txt')}`);
  });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
