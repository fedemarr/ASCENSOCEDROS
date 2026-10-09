import { test } from 'node:test';
import assert from 'node:assert/strict';

export function registrationContract(label, context) {
  const req=(...args)=>context().request(...args);
  const register=(dni,extras={})=>req('/api/registration',{method:'POST',body:{first_name:'Lucía',last_name:'Gómez',dni,inviter_name:'Juan Pérez',consent:true,...extras}});
  const admin=(path,body)=>req(path,{cookie:context().admin,method:'PATCH',body});
  const guests=(q='')=>req('/api/guests?q='+encodeURIComponent(q),{cookie:context().security});

  test(label+': registro general sin foto, conservación de datos y DNI único',async()=>{
    assert.equal((await req('/invitacion')).status,200);
    assert.equal((await req('/api/guests')).status,401);
    assert.equal((await req('/api/inviters',{cookie:context().security})).status,403);
    assert.equal((await req('/api/invitation/juan-perez?token=anterior')).status,410);
    const prior=(await guests('30000000')).data.guests[0]; assert.ok(prior);
    assert.equal((await register('40.123.456')).status,201);
    assert.equal((await register('40123457',{inviter_name:'juan perez',inviter_id:'ignored'})).status,201);
    const list=(await guests('gomez')).data; assert.equal(list.total,2);
    assert.equal(list.guests[0].inviter_id,prior.inviter_id);
    assert.equal(list.guests[1].inviter_id,prior.inviter_id);
    assert.equal((await register('40123456',{inviter_name:'Otra Persona'})).status,409);
    assert.equal((await guests('40.123.456')).data.total,1);
    assert.equal((await req('/api/guests/'+list.guests[0].id+'/photo',{cookie:context().security})).status,404);
    await context().assertNoNewPhotos();
  });
  test(label+': validación y permisos del registro compartido',async()=>{
    for (const extras of [{dni:'123'},{consent:false},{inviter_name:''},{first_name:'<script>'}]) assert.equal((await register('40123458',extras)).status,400);
    assert.equal((await req('/api/registration',{cookie:context().security,method:'PATCH',body:{capacity:10,active:true}})).status,403);
    assert.equal((await req('/api/registration',{method:'POST',headers:{Origin:'https://evil.example'},body:{}})).status,403);
    const config=(await req('/api/registration')).data;
    assert.equal((await admin('/api/registration',{capacity:0,active:false})).status,400);
    assert.deepEqual((await req('/api/registration')).data,config);
  });
  test(label+': concurrencia, cupo global y cierre sin bloquear el ingreso',async()=>{
    const count=(await req('/api/stats',{cookie:context().admin})).data.registered;
    await admin('/api/registration',{capacity:count+1,active:true});
    const results=await Promise.all([register('50123456'),register('50123457')]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    await admin('/api/registration',{capacity:10000,active:true});
    const dupes=await Promise.all([register('60123456',{inviter_name:'Martín López'}),register('60123456',{inviter_name:'martin lopez'})]);
    assert.deepEqual(dupes.map(r=>r.status).sort(),[201,409]);
    await admin('/api/registration',{capacity:10000,active:false});
    assert.equal((await register('70123456')).status,410);
    assert.equal((await req('/api/registration')).data.active,false);
    await admin('/api/registration',{capacity:10000,active:true});
  });
  test(label+': un único ingreso sincronizado entre dispositivos',async()=>{
    const g=(await guests('40123456')).data.guests[0];
    const abort=new AbortController();const response=await fetch(context().otherBase+'/api/events',{headers:{Cookie:context().security},signal:abort.signal});
    const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: connected/);
    await new Promise(r=>setTimeout(r,70));
    const entry=()=>req('/api/guests/'+g.id+'/enter',{cookie:context().security,method:'POST',body:{}});
    const results=await Promise.all([entry(),entry()]);assert.deepEqual(results.map(r=>r.data.already_entered).sort(),[false,true]);
    assert.equal(results[0].data.entered_at,results[1].data.entered_at);
    let output='';try {while(!output.includes('event: update'))output+=new TextDecoder().decode((await reader.read()).value);}finally{abort.abort();}
    assert.match(output,/event: update/);
    assert.ok((await guests('40123456')).data.guests[0].entered_at);
  });
  test(label+': revocar invitadores y accesos individuales, estadísticas',async()=>{
    const g=(await guests('60123456')).data.guests[0];
    assert.equal((await admin('/api/inviters/'+g.inviter_id,{active:false})).status,200);
    assert.equal((await register('70123456',{inviter_name:'MARTIN LOPEZ'})).status,403);
    assert.equal((await req('/api/guests/'+g.id+'/enter',{cookie:context().security,method:'POST',body:{}})).status,403);
    await admin('/api/inviters/'+g.inviter_id,{active:true});
    const revoke=revoked=>req('/api/guests/'+g.id+'/revoke',{cookie:context().admin,method:'POST',body:{revoked}});
    await revoke(true);assert.equal((await req('/api/guests/'+g.id+'/enter',{cookie:context().security,method:'POST',body:{}})).status,403);await revoke(false);
    const stats=(await req('/api/stats',{cookie:context().admin})).data;
    assert.equal(stats.registered,5);assert.equal(stats.entered,1);assert.equal(stats.available,9995);
    const inviters=(await req('/api/inviters',{cookie:context().admin})).data.inviters;
    assert.equal(inviters.length,2);assert.equal(inviters.find(i=>i.name==='Juan Pérez').registered,4);
    assert.equal((await admin('/api/settings',{date:'2026-10-17',time:'01:00'})).status,200);
    assert.equal((await req('/api/event')).data.time,'01:00');
  });
}
