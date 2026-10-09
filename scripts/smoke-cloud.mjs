import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { cloudDatabase } from '../cloud/database.mjs';
const base=new URL(process.argv[2] || 'https://ascensocedros.vercel.app').origin;
if (!base.startsWith('https://')) throw new Error('Usar la URL HTTPS del despliegue.');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const credentials=readFileSync(join(root,'data','accesos-iniciales.txt'),'utf8');
const password=(username) => credentials.split(/\r?\n/).find((line) => line.startsWith(`${username}: `))?.slice(username.length+2);
const db=cloudDatabase();
let inviterId; const fixtureName='Validacion tecnica '+randomBytes(12).toString('hex'); const sessions=[];
const call=async (path,options={}) => {
  const r=await fetch(base+path,{ method:options.method || 'GET',headers:{ 'Content-Type':'application/json','X-Requested-With':'LosCedros',Origin:base,...(options.cookie ? { Cookie:options.cookie } : {}) },...(options.body ? { body:JSON.stringify(options.body) } : {}) });
  const data=(r.headers.get('content-type') || '').includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status:r.status,data,headers:r.headers };
};
const login=async (username) => {
  const r=await call('/api/login',{ method:'POST',body:{ username,password:password(username) } });
  assert.equal(r.status,200,`No se pudo iniciar sesión: ${r.data.error}`);
  const cookie=r.headers.get('set-cookie').split(';')[0]; sessions.push(cookie); return cookie;
};
try {
  assert.equal((await call('/api/health')).status,200);
  assert.equal((await call('/api/guests')).status,401);
  const admin=await login('admin'); const security=await login('seguridad'); const otherDevice=await login('seguridad');
  let dni; do { dni=String(90000000+Math.floor(Math.random()*9999999)); } while ((await db.query('SELECT id FROM guests WHERE dni=$1',[dni])).length);
  const path='/api/registration';
  const body={first_name:'Prueba',last_name:'Técnica',dni,inviter_name:fixtureName,consent:true};
  assert.equal((await call(path,{method:'POST',body})).status,201);
  assert.equal((await call(path,{method:'POST',body})).status,409);
  const list=await call('/api/guests?q='+dni,{cookie:security});assert.equal(list.data.total,1);const g=list.data.guests[0];inviterId=g.inviter_id;
  assert.equal((await call('/api/guests/'+g.id+'/photo',{cookie:security})).status,404);
  const [stored]=await db.query('SELECT photo_path FROM guests WHERE id=$1',[g.id]);assert.equal(stored.photo_path,'');
  const abort=new AbortController(); const response=await fetch(`${base}/api/events`,{ headers:{ Cookie:otherDevice },signal:abort.signal });
  assert.equal(response.status,200); const reader=response.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value),/event: connected/);
  const results=await Promise.all([call(`/api/guests/${g.id}/enter`,{ cookie:security,method:'POST',body:{} }),call(`/api/guests/${g.id}/enter`,{ cookie:otherDevice,method:'POST',body:{} })]);
  assert.deepEqual(results.map((r) => r.data.already_entered).sort(),[false,true]);
  assert.equal(results[0].data.entered_at,results[1].data.entered_at);
  let updates=''; const timeout=setTimeout(() => abort.abort(),12000);
  try { while (!updates.includes('event: update')) { const next=await reader.read(); if (next.done) break; updates+=new TextDecoder().decode(next.value); } assert.match(updates,/event: update/); }
  finally { clearTimeout(timeout); abort.abort(); }
  await call(`/api/guests/${g.id}/revoke`,{ cookie:admin,method:'POST',body:{ revoked:true } });
  assert.equal((await call(`/api/guests/${g.id}/enter`,{ cookie:security,method:'POST',body:{} })).status,403);
  const stats=await call('/api/inviters',{ cookie:admin }); const inviter=stats.data.inviters.find((row) => row.id===inviterId);
  assert.equal(inviter.registered,1); assert.equal(inviter.entered,1);
  console.log('Producción verificada: cuentas, registro, DNI único, registro sin foto, ingreso único, SSE y revocación.');
} finally {
  // Delete only this run's own fixture IDs. Never touch other guests or inviters.
  if (!inviterId) inviterId=(await db.query('SELECT id FROM inviters WHERE name=$1',[fixtureName]))[0]?.id;
  if (inviterId) {
    const guests=await db.query('SELECT id,photo_path FROM guests WHERE inviter_id=$1',[inviterId]);

    await db.transaction([
      ['DELETE FROM audit WHERE target_id=$1 OR target_id IN (SELECT id FROM guests WHERE inviter_id=$1)',[inviterId]],
      ['DELETE FROM guests WHERE inviter_id=$1',[inviterId]],
      ['DELETE FROM inviters WHERE id=$1',[inviterId]],
      ['UPDATE changes SET version=version+1 WHERE id=1']
    ]);
    console.log('Datos de prueba eliminados.');
  }
  for (const cookie of sessions) await call('/api/logout',{ cookie,method:'POST',body:{} });
}
