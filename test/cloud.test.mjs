import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes,randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { schemaStatements } from '../cloud/schema.mjs';
import { createCloudHandler } from '../cloud/handler.mjs';
import { hashPassword } from '../cloud/security.mjs';
let pg,base,otherBase,server,otherServer,admin,security,photo;
const files=new Map();
const password='Cloud-Test-Password!';
const db={
  async query(sql,params=[]) { return (await pg.query(sql,params)).rows; },
  async transaction(statements) { return pg.transaction(async (tx) => { const results=[]; for (const [sql,params=[]] of statements) results.push((await tx.query(sql,params)).rows); return results; }); }
};
const request=async (path,options={}) => {
  const r=await fetch((options.base || base)+path,{ method:options.method || 'GET',headers:{ 'Content-Type':'application/json','X-Requested-With':'LosCedros',...(options.cookie ? { Cookie:options.cookie } : {}),...options.headers },...(options.body ? { body:JSON.stringify(options.body) } : {}) });
  return { status:r.status,data:(r.headers.get('content-type') || '').includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()),headers:r.headers };
};
const makeInviter=async (capacity=2,name='Juan Pérez') => { const r=await request('/api/inviters',{ cookie:admin,method:'POST',body:{ name,capacity } }); assert.equal(r.status,201,JSON.stringify(r.data)); return r.data.inviter; };
const register=(i,dni,extras={}) => request(`/api/invitation/${i.slug}?token=${i.token}`,{ method:'POST',body:{ first_name:'Lucía',last_name:'Gómez',dni,photo,consent:true,...extras } });
before(async () => {
  pg=new PGlite(); for (const sql of schemaStatements) await pg.exec(sql);
  for (const [user,role] of [['admin','admin'],['seguridad','security']]) await db.query('INSERT INTO users VALUES($1,$2,$3,$4)',[randomUUID(),user,hashPassword(password),role]);
  for (const [key,value] of Object.entries({ title:'LOS CEDROS NIGHT',subtitle:'Noche del club',date:'',time:'',location:'Los Cedros',description:'Evento' })) await db.query('INSERT INTO settings VALUES($1,$2)',[key,value]);
  const options={ db,photoKey:randomBytes(32),secureCookies:false,pollInterval:30,streamDuration:3000,blobs:{ async save(path,bytes) { files.set(path,bytes); return path; },async read(path) { return files.get(path); },async remove(path) { files.delete(path); } } };
  server=http.createServer(createCloudHandler(options)); otherServer=http.createServer(createCloudHandler(options));
  await Promise.all([new Promise((r) => server.listen(0,'127.0.0.1',r)),new Promise((r) => otherServer.listen(0,'127.0.0.1',r))]);
  base=`http://127.0.0.1:${server.address().port}`; otherBase=`http://127.0.0.1:${otherServer.address().port}`;
  for (const user of ['admin','seguridad']) { const r=await request('/api/login',{ method:'POST',body:{ username:user,password } }); assert.equal(r.status,200,JSON.stringify(r.data)); if (user==='admin') admin=r.headers.get('set-cookie').split(';')[0]; else security=r.headers.get('set-cookie').split(';')[0]; }
  photo='data:image/png;base64,'+(await sharp({ create:{ width:300,height:180,channels:3,background:'#abc' } }).png().toBuffer()).toString('base64');
});
after(async () => { for (const s of [server,otherServer]) { s.closeAllConnections(); await new Promise((r) => s.close(r)); } await pg.close(); });
test('nube: permisos, archivos privados y protección de origen',async () => {
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/guests')).status,401);
  assert.equal((await request('/api/inviters',{ cookie:security })).status,403);
  assert.equal((await request('/api/inviters',{ cookie:admin,method:'POST',headers:{ Origin:'https://evil.example' },body:{ name:'Malicioso',capacity:1 } })).status,403);
});
test('nube: cupo y DNI único con solicitudes simultáneas',async () => {
  const i=await makeInviter(1);
  const results=await Promise.all([register(i,'40123456'),register(i,'40123457')]);
  assert.deepEqual(results.map((r) => r.status).sort(),[201,409]); assert.equal(files.size,1);
  const guest=(await request('/api/guests',{ cookie:security })).data.guests[0];
  const second=await makeInviter(3,'Martín López');
  assert.equal((await register(second,guest.dni,{ inviter_id:second.id })).status,409);
  const dupes=await Promise.all([register(second,'50123456',{ inviter_id:i.id }),register(second,'50123456')]);
  assert.deepEqual(dupes.map((r) => r.status).sort(),[201,409]); assert.equal(files.size,2);
  const g=(await request('/api/guests?q=50123456',{ cookie:security })).data.guests[0]; assert.equal(g.inviter_id,second.id);
  assert.equal((await request('/api/guests?q=Gómez',{ cookie:security })).data.total,2);
  assert.equal((await request('/api/guests?q=50.123.456',{ cookie:security })).data.total,1);
  assert.equal((await request(`/api/guests/${g.id}/photo`)).status,401);
  const image=await request(`/api/guests/${g.id}/photo`,{ cookie:security }); assert.equal(image.status,200); assert.equal(image.data.subarray(0,2).toString('hex'),'ffd8'); assert.equal(image.headers.get('cache-control'),'no-store');
  assert.ok([...files.values()].every((bytes) => bytes.subarray(0,2).toString('hex')!=='ffd8'));
});
test('nube: ingreso único y SSE entre dos instancias independientes',async () => {
  const guest=(await request('/api/guests?q=50123456',{ cookie:security })).data.guests[0];
  const abort=new AbortController(); const r=await fetch(`${otherBase}/api/events`,{ headers:{ Cookie:security },signal:abort.signal });
  const reader=r.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value),/event: connected/);
  // Give the other instance a baseline revision before the mutation.
  await new Promise((r) => setTimeout(r,70));
  const results=await Promise.all([request(`/api/guests/${guest.id}/enter`,{ cookie:security,method:'POST',body:{} }),request(`/api/guests/${guest.id}/enter`,{ base:otherBase,cookie:security,method:'POST',body:{} })]);
  assert.deepEqual(results.map((r) => r.data.already_entered).sort(),[false,true]); assert.equal(results[0].data.entered_at,results[1].data.entered_at);
  let updates=''; const deadline=Date.now()+2000;
  while (!updates.includes('event: update') && Date.now()<deadline) updates+=new TextDecoder().decode((await reader.read()).value);
  abort.abort(); assert.match(updates,/event: update/);
  assert.equal((await request('/api/stats',{ cookie:admin })).data.entered,1);
});
test('nube: revocar, rotar token, cupos y validar imágenes',async () => {
  const i=await makeInviter(2,'Acceso Revocable'); assert.equal((await register(i,'60123456')).status,201);
  const g=(await request('/api/guests?q=60123456',{ cookie:security })).data.guests[0];
  assert.equal((await request(`/api/inviters/${i.id}`,{ cookie:admin,method:'PATCH',body:{ capacity:0 } })).status,400);
  await request(`/api/inviters/${i.id}`,{ cookie:admin,method:'PATCH',body:{ active:false } });
  assert.equal((await request(`/api/guests/${g.id}/enter`,{ cookie:security,method:'POST',body:{} })).status,403);
  assert.equal((await register(i,'60123457')).status,410);
  await request(`/api/inviters/${i.id}`,{ cookie:admin,method:'PATCH',body:{ active:true } });
  const rotated=await request(`/api/inviters/${i.id}`,{ cookie:admin,method:'PATCH',body:{ rotate:true } }); assert.equal(rotated.status,200);
  assert.equal((await register(i,'60123457')).status,404);
  assert.equal((await register(rotated.data.inviter,'60123457',{ photo:'data:image/png;base64,aGVsbG8=' })).status,400);
  await request(`/api/guests/${g.id}/revoke`,{ cookie:admin,method:'POST',body:{ revoked:true } });
  assert.equal((await request('/api/guests?state=revoked',{ cookie:security })).data.total,1);
  assert.equal((await request(`/api/guests/${g.id}/enter`,{ cookie:security,method:'POST',body:{} })).status,403);
  await request('/api/settings',{ cookie:admin,method:'PATCH',body:{ date:'2026-11-14',time:'22:00' } });
  assert.equal((await request('/api/event')).data.time,'22:00');
});
test('nube: límites compartidos y sesiones compartidas entre instancias',async () => {
  assert.equal((await request('/api/session',{ cookie:security,base:otherBase })).data.user.role,'security');
  for (let n=0;n<30;n++) await request('/api/login',{ base:n%2 ? base : otherBase,method:'POST',body:{ username:'no-existe',password:'incorrecta' } });
  assert.equal((await request('/api/login',{ method:'POST',body:{ username:'no-existe',password:'incorrecta' } })).status,429);
  await request('/api/logout',{ base:otherBase,cookie:security,method:'POST',body:{} });
  assert.equal((await request('/api/guests',{ cookie:security })).status,401);
});
