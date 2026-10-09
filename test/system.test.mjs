import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {registrationContract} from './registration-contract.mjs';
let app,base,admin,security,dir;
const passwords={admin:'Admin-Testing!',seguridad:'Security-Testing!'};
const request=async(path,o={})=>{const r=await fetch(base+path,{method:o.method || 'GET',headers:{'Content-Type':'application/json','X-Requested-With':'LosCedros',...(o.cookie?{Cookie:o.cookie}:{}),...o.headers},...(o.body?{body:JSON.stringify(o.body)}:{})});return {status:r.status,data:(r.headers.get('content-type') || '').includes('application/json')?await r.json():await r.text(),headers:r.headers};};
before(async()=>{dir=mkdtempSync(join(tmpdir(),'cedros-shared-'));app=createApplication({dataDir:dir,passwords});const id=randomUUID();app.db.prepare('INSERT INTO inviters VALUES(?,?,?,?,?,1,?)').run(id,'Juan Pérez','juan-perez','old-token',1,new Date().toISOString());app.db.prepare('INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,'Registro','Anterior','30000000','registro anterior',Buffer.from('legacy-photo'),new Date().toISOString());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;for(const username of ['admin','seguridad']){const r=await request('/api/login',{method:'POST',body:{username,password:passwords[username]}});const cookie=r.headers.get('set-cookie').split(';')[0];if(username==='admin')admin=cookie;else security=cookie;}});
after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
registrationContract('SQLite',()=>({request,admin,security,otherBase:base,assertNoNewPhotos:async()=>assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM guests WHERE length(photo)>0').get().n,1)}));
test('SQLite: búsqueda móvil con 10.000 invitados y paginación',async()=>{
  const inviter=randomUUID(); const stamp=new Date().toISOString();
  app.db.prepare('INSERT INTO inviters VALUES(?,?,?,?,?,1,?)').run(inviter,'Volumen aislado','volumen',randomUUID(),10000,stamp);
  const insert=app.db.prepare('INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo,created_at) VALUES(?,?,?,?,?,?,?,?)');
  app.db.exec('BEGIN IMMEDIATE');
  for(let n=0;n<10000;n++)insert.run(randomUUID(),inviter,'Persona','Prueba',String(80000000+n),'persona prueba',Buffer.alloc(0),stamp);
  app.db.exec('COMMIT');
  try {
    const start=performance.now(); const result=(await request('/api/guests?q=persona',{cookie:security})).data;
    assert.equal(result.total,10000);assert.equal(result.guests.length,50);assert.equal(result.pages,200);
    assert.ok(performance.now()-start<250);
    const second=(await request('/api/guests?q=persona&page=2',{cookie:security})).data;
    assert.ok(!second.guests.some(g=>result.guests.some(other=>other.id===g.id)));
  } finally {app.db.prepare('DELETE FROM guests WHERE inviter_id=?').run(inviter);app.db.prepare('DELETE FROM inviters WHERE id=?').run(inviter);}
});
test('SQLite: persistencia tras reiniciar',async()=>{const before=(await request('/api/stats',{cookie:admin})).data;await app.close();app=createApplication({dataDir:dir,passwords});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;assert.deepEqual((await request('/api/stats',{cookie:admin})).data,before);});
