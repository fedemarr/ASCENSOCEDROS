import { test, before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApplication } from '../server.mjs';

let app, base, admin, security, secondDevice, photo;
const dir = mkdtempSync(join(tmpdir(), 'cedros-test-'));
const passwords = { admin: 'Admin-Test-Password-2026!', seguridad: 'Security-Test-Password-2026!' };
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, { method: options.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'LosCedros', ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
};
const login = async (username) => {
  const r = await request('/api/login', { method: 'POST', body: { username, password: passwords[username] } });
  assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0];
};
const makeInviter = async (name, capacity) => {
  const r = await request('/api/inviters', { method: 'POST', cookie: admin, body: { name, capacity } });
  assert.equal(r.status, 201); return r.data.inviter;
};
const register = (i, dni, extras = {}) => request(`/api/invitation/${i.slug}?token=${i.token}`, { method: 'POST', body: { first_name: 'José', last_name: 'Pérez', dni, photo, consent: true, ...extras } });
before(async () => {
  app = createApplication({ dataDir: dir, passwords });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = await login('admin'); security = await login('seguridad'); secondDevice = await login('seguridad');
  const image = await sharp({ create: { width: 300, height: 180, channels: 3, background: '#b7c5e2' } }).png().toBuffer();
  photo = `data:image/png;base64,${image.toString('base64')}`;
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

test('páginas y recursos públicos sin exponer datos privados', async () => {
  for (const path of ['/', '/admin', '/seguridad', '/app.js', '/style.css', '/assets/escudo.png', '/assets/club.jpeg']) assert.equal((await request(path)).status, 200);
  for (const path of ['/api/guests', '/api/stats', '/api/inviters', '/data/cedros.sqlite', '/data/photo.key']) assert.ok([401,404].includes((await request(path)).status));
  assert.equal((await request('/api/inviters', { cookie: security })).status, 403);
  assert.equal((await request('/api/settings', { cookie: security, method: 'PATCH', body: { title: 'Changed' } })).status, 403);
});

test('links impredecibles, invitador fijado en el servidor y DNI único global', async () => {
  const a = await makeInviter('Juan Pérez', 3); const b = await makeInviter('Martín López', 2);
  assert.equal(a.slug, 'juan-perez'); assert.equal(a.token.length, 43); assert.notEqual(a.token, b.token);
  assert.equal((await request(`/api/invitation/${a.slug}`)).status, 404);
  assert.equal((await request(`/api/invitation/${a.slug}?token=${b.token}`)).status, 404);
  const result = await register(a, '12.345.678', { inviter_id: b.id, inviter_name: 'Otra persona' }); assert.equal(result.status, 201);
  const list = await request('/api/guests?q=12345678', { cookie: security });
  assert.equal(list.data.guests[0].inviter_id, a.id); assert.equal(list.data.guests[0].inviter_name, 'Juan Pérez');
  assert.equal((await register(b, '12345678')).status, 409);
  assert.equal((await register(a, '12345678')).status, 409);
  for (const query of ['jose', 'perez', 'José Pérez', '12345678', '12.345.678']) assert.equal((await request(`/api/guests?q=${encodeURIComponent(query)}`, { cookie: security })).data.total, 1);
  const stats = await request('/api/inviters', { cookie: admin });
  const inviter = stats.data.inviters.find((i) => i.id === a.id);
  assert.equal(inviter.registered, 1); assert.equal(inviter.available, 2);
});

test('concurrencia: último cupo y registros repetidos', async () => {
  const a = await makeInviter('Último Cupo', 1);
  const results = await Promise.all([register(a, '22345678'), register(a, '22345679')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201,409]);
  const b = await makeInviter('Duplicados Simultáneos', 3);
  const dupes = await Promise.all([register(b, '32345678'), register(b, '32345678')]);
  assert.deepEqual(dupes.map((r) => r.status).sort(), [201,409]);
  const list = await request(`/api/guests?inviter=${a.id}`, { cookie: security }); assert.equal(list.data.total, 1);
  const shrink = await request(`/api/inviters/${a.id}`, { cookie: admin, method: 'PATCH', body: { capacity: 0 } }); assert.equal(shrink.status, 400);
});

test('fotos cifradas y visibles únicamente con sesión autorizada', async () => {
  const g = (await request('/api/guests?q=12345678', { cookie: security })).data.guests[0];
  const path = `/api/guests/${g.id}/photo`;
  assert.equal((await request(path)).status, 401);
  const r = await request(path, { cookie: security }); assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(r.data); assert.equal(bytes.subarray(0,2).toString('hex'), 'ffd8');
  const raw = Buffer.from(app.db.prepare('SELECT photo FROM guests WHERE id=?').get(g.id).photo);
  assert.notEqual(raw.subarray(0,2).toString('hex'), 'ffd8');
  assert.notDeepEqual(raw, bytes);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='photo_viewed'").get().n, 1);
});

test('dos dispositivos marcan un único ingreso y reciben actualizaciones SSE', async () => {
  const g = (await request('/api/guests?q=12345678', { cookie: security })).data.guests[0];
  const abort = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: secondDevice }, signal: abort.signal });
  assert.equal(response.status,200); const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: connected/);
  const results = await Promise.all([request(`/api/guests/${g.id}/enter`, { cookie: security, method: 'POST', body: {} }), request(`/api/guests/${g.id}/enter`, { cookie: secondDevice, method: 'POST', body: {} })]);
  assert.deepEqual(results.map((r) => r.data.already_entered).sort(), [false,true]);
  assert.equal(results[0].data.entered_at, results[1].data.entered_at);
  const update = await Promise.race([reader.read(), new Promise((_,reject) => setTimeout(() => reject(new Error('No hubo sincronización')),2000))]);
  assert.match(new TextDecoder().decode(update.value), /event: update/); abort.abort();
  const list = await request('/api/guests?state=entered', { cookie: secondDevice }); assert.equal(list.data.total, 1);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='entered' AND target_id=?").get(g.id).n, 1);
});

test('revocar links y accesos individuales, restaurar y rotar tokens', async () => {
  const i = await makeInviter('Acceso Revocable', 4);
  assert.equal((await register(i, '42345678')).status,201);
  const g = (await request('/api/guests?q=42345678', { cookie: security })).data.guests[0];
  assert.equal((await request(`/api/guests/${g.id}/revoke`, { cookie: security, method: 'POST', body: { revoked:true } })).status,403);
  await request(`/api/guests/${g.id}/revoke`, { cookie: admin, method: 'POST', body: { revoked:true } });
  assert.equal((await request(`/api/guests/${g.id}/enter`, { cookie: security, method: 'POST', body: {} })).status,403);
  await request(`/api/guests/${g.id}/revoke`, { cookie: admin, method: 'POST', body: { revoked:false } });
  await request(`/api/inviters/${i.id}`, { cookie: admin, method: 'PATCH', body: { active:false } });
  assert.equal((await register(i, '42345679')).status,410);
  assert.equal((await request(`/api/guests/${g.id}/enter`, { cookie: security, method: 'POST', body: {} })).status,403);
  assert.equal((await request('/api/guests?state=revoked', { cookie: security })).data.total,1);
  await request(`/api/inviters/${i.id}`, { cookie: admin, method: 'PATCH', body: { active:true } });
  const rotated = await request(`/api/inviters/${i.id}`, { cookie: admin, method: 'PATCH', body: { rotate:true } });
  assert.notEqual(rotated.data.inviter.token,i.token);
  assert.equal((await register(i, '42345679')).status,404);
  assert.equal((await register(rotated.data.inviter, '42345679')).status,201);
  assert.equal((await request(`/api/guests/${g.id}/enter`, { cookie: security, method: 'POST', body: {} })).status,200);
});

test('validación de datos, fotos y protección contra solicitudes externas', async () => {
  const i = await makeInviter('Validaciones', 8);
  assert.equal((await register(i, '123')).status,400);
  assert.equal((await register(i, '52345678', { consent:false })).status,400);
  assert.equal((await register(i, '52345678', { photo:'data:image/png;base64,aGVsbG8=' })).status,400);
  assert.equal((await register(i, '52345678', { photo:'data:image/svg+xml;base64,PHN2Zz4=' })).status,400);
  assert.equal((await register(i, '52345678', { first_name:'<script>' })).status,400);
  assert.equal((await request('/api/inviters', { method:'POST',cookie:admin,headers:{ Origin:'https://evil.example' },body:{ name:'External',capacity:1 } })).status,403);
  const noHeader = await fetch(`${base}/api/inviters`, { method:'POST',headers:{ Cookie:admin,'Content-Type':'application/json' },body:JSON.stringify({ name:'No header',capacity:1 }) });
  assert.equal(noHeader.status,403);
  assert.equal((await request('/api/guests?q=%25%27%20OR%201%3D1--', { cookie:security })).data.total,0);
});

test('configuración del flyer, estadísticas y paginación', async () => {
  const r = await request('/api/settings',{ cookie:admin,method:'PATCH',body:{ date:'2026-11-14',time:'22:00',subtitle:'Una noche azul y amarilla' } }); assert.equal(r.status,200);
  assert.equal((await request('/api/event')).data.date,'2026-11-14');
  assert.equal((await request('/api/settings',{ cookie:admin,method:'PATCH',body:{ date:'2026-99-99' } })).status,400);
  const stats = (await request('/api/stats',{ cookie:admin })).data;
  assert.equal(stats.registered,5); assert.equal(stats.entered,2); assert.equal(stats.pending,3);
  assert.equal((await request('/api/guests?page=2',{ cookie:security })).data.guests.length,0);
});

test('búsqueda rápida y paginación con 10.000 invitados', async () => {
  const i = await makeInviter('Prueba de Volumen', 10_000);
  const sourcePhoto = app.db.prepare('SELECT photo FROM guests LIMIT 1').get().photo;
  const insert = app.db.prepare('INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo,created_at) VALUES (?,?,?,?,?,?,?,?)');
  app.db.exec('BEGIN IMMEDIATE');
  for (let n = 0; n < 10_000; n++) insert.run(randomUUID(),i.id,'Persona','Prueba',String(60000000+n),'persona prueba',sourcePhoto,new Date().toISOString());
  app.db.exec('COMMIT');
  const start = performance.now();
  const r = await request('/api/guests?q=persona',{ cookie:security });
  const elapsed = performance.now()-start;
  assert.equal(r.data.total,10_000); assert.equal(r.data.guests.length,50); assert.equal(r.data.pages,200);
  assert.ok(elapsed<250, `Búsqueda demasiado lenta: ${elapsed.toFixed(1)} ms`);
  const secondPage = await request('/api/guests?q=persona&page=2',{ cookie:security });
  assert.equal(secondPage.data.guests.length,50);
  assert.ok(!secondPage.data.guests.some((g) => r.data.guests.some((first) => first.id === g.id)));
  app.db.prepare('DELETE FROM guests WHERE inviter_id=?').run(i.id);
  app.db.prepare('DELETE FROM inviters WHERE id=?').run(i.id);
});

test('persistencia después de reiniciar y cierre de sesión', async () => {
  const stats = (await request('/api/stats',{ cookie:admin })).data;
  await app.close(); app = createApplication({ dataDir:dir,passwords });
  await new Promise((r) => app.server.listen(0,'127.0.0.1',r)); base = `http://127.0.0.1:${app.server.address().port}`;
  assert.deepEqual((await request('/api/stats',{ cookie:admin })).data,stats);
  const g = (await request('/api/guests?q=12345678',{ cookie:security })).data.guests[0];
  assert.equal((await request(`/api/guests/${g.id}/photo`,{ cookie:security })).status,200);
  assert.equal((await request('/api/logout',{ cookie:security,method:'POST',body:{} })).status,200);
  assert.equal((await request('/api/guests',{ cookie:security })).status,401);
});
