import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { cloudDatabase } from '../cloud/database.mjs';
import { schemaStatements } from '../cloud/schema.mjs';

const db=cloudDatabase();
const tables=['users','inviters','guests','settings','audit'];
const snapshots=await db.transaction(tables.map(table=>[`SELECT * FROM ${table}`]),{isolationLevel:'RepeatableRead',readOnly:true});
// Validate the additive migration against an isolated copy of the current data.
const preview=new PGlite();
try {
  for(const sql of schemaStatements) await preview.exec(sql);
  for(let i=0;i<tables.length;i++) {
    for(const row of snapshots[i]) {
      const columns=Object.keys(row);
      await preview.query(`INSERT INTO ${tables[i]}(${columns.join(',')}) VALUES(${columns.map((_,j)=>'$'+(j+1)).join(',')}) ON CONFLICT DO NOTHING`,Object.values(row));
    }
  }
  await preview.exec("SELECT setval(pg_get_serial_sequence('audit','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM audit");
  for(const table of ['users','inviters','guests','audit']) {
    const original=snapshots[tables.indexOf(table)];
    assert.equal((await preview.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n,original.length);
  }
  await preview.query("UPDATE settings SET value='10000' WHERE key='_registration_capacity'");
  await preview.query("UPDATE settings SET value='1' WHERE key='_registration_active'");
  let dni='99999999';
  while((await preview.query('SELECT id FROM guests WHERE dni=$1',[dni])).rows.length) dni=String(Number(dni)-1);
  await preview.query('SELECT register_shared_guest($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),'Prueba Aislada','prueba aislada','Registro','Aislado',dni,'registro aislado',new Date().toISOString()]);
  assert.equal((await preview.query('SELECT photo_path FROM guests WHERE dni=$1',[dni])).rows[0].photo_path,'');
} finally { await preview.close(); }
console.log('Migración validada sobre una copia aislada.');
if(process.argv.includes('--apply')) {
  await db.transaction(schemaStatements.map(sql=>[sql]));
  console.log('Funciones de registro general instaladas. Los registros existentes se conservan.');
}
