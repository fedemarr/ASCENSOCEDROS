import { DatabaseSync } from 'node:sqlite';
import { readFileSync,existsSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import { cloudDatabase } from '../cloud/database.mjs';
import { schemaStatements } from '../cloud/schema.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dir=resolve(process.env.DATA_DIR || join(root,'data'));
if (!existsSync(join(dir,'cedros.sqlite'))) throw new Error('Falta la base local. Iniciar con npm start antes de migrar.');
const source=new DatabaseSync(join(dir,'cedros.sqlite'),{ readOnly:true });
const key=readFileSync(join(dir,'photo.key'));
if (!process.env.PHOTO_KEY || !key.equals(Buffer.from(process.env.PHOTO_KEY,'base64'))) throw new Error('La clave PHOTO_KEY no coincide con la base local.');
const db=cloudDatabase();
await db.transaction(schemaStatements.map((sql) => [sql]));
const keyDigest=createHash('sha256').update(key).digest('hex');
const [existing]=await db.query("SELECT value FROM settings WHERE key='_photo_key_digest'");
if (existing && existing.value!==keyDigest) throw new Error('La base de destino utiliza otra clave de fotos. No se modificó ningún registro.');
await db.query("INSERT INTO settings(key,value) VALUES('_photo_key_digest',$1) ON CONFLICT DO NOTHING",[keyDigest]);
await db.transaction(source.prepare('SELECT * FROM users').all().map((u) => ['INSERT INTO users VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[u.id,u.username,u.password,u.role]]));
const inviters=source.prepare('SELECT * FROM inviters').all();
if (inviters.length) await db.transaction(inviters.map((i) => ['INSERT INTO inviters VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[i.id,i.name,i.slug,i.token,i.capacity,i.active,i.created_at]]));
const guests=source.prepare('SELECT * FROM guests').all();
let migrated=0;
for (const g of guests) {
  if ((await db.query('SELECT id FROM guests WHERE id=$1',[g.id])).length) continue;
  const blob=g.photo.length ? await put(`dni/${g.id}.bin`,Buffer.from(g.photo),{ access:'private',contentType:'application/octet-stream',addRandomSuffix:false }) : {pathname:''};
  await db.query(`INSERT INTO guests(id,inviter_id,first_name,last_name,dni,search_name,photo_path,created_at,entered_at,entered_by,revoked)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[g.id,g.inviter_id,g.first_name,g.last_name,g.dni,g.search_name,blob.pathname,g.created_at,g.entered_at,g.entered_by,g.revoked]);
  migrated++;
}
await db.transaction(source.prepare('SELECT * FROM settings').all().map((s) => ['INSERT INTO settings VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[s.key,s.value]]));
const audit=source.prepare('SELECT * FROM audit').all();
if (audit.length) {
  await db.transaction(audit.map((a) => ['INSERT INTO audit(id,user_id,action,target_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[a.id,a.user_id,a.action,a.target_id,a.created_at]]));
  await db.query("SELECT setval(pg_get_serial_sequence('audit','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM audit");
}
await db.query('UPDATE changes SET version=version+1 WHERE id=1');
source.close();
console.log(`Migración completada: ${inviters.length} invitadores, ${migrated} invitados nuevos. Cuentas y datos locales conservados.`);
