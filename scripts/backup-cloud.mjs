import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from '@vercel/blob';
import { cloudDatabase } from '../cloud/database.mjs';
import { createHash } from 'node:crypto';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const db=cloudDatabase();
const key=Buffer.from(process.env.PHOTO_KEY || '','base64');
if (key.length!==32) throw new Error('Falta la clave de cifrado de las fotos.');
const tables=['users','inviters','guests','settings','audit'];
const snapshots=await db.transaction(tables.map((table) => [`SELECT * FROM ${table}`]),{ isolationLevel:'RepeatableRead',readOnly:true });
const data=Object.fromEntries(tables.map((table,i) => [table,snapshots[i]]));
const digest=data.settings.find((s) => s.key==='_photo_key_digest')?.value;
if (digest!==createHash('sha256').update(key).digest('hex')) throw new Error('La clave no coincide con la base. No se creó el respaldo.');
const dir=join(root,'data','backups',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(join(dir,'photos'),{ recursive:true,mode:0o700 });
writeFileSync(join(dir,'photo.key'),key,{ mode:0o600 });
writeFileSync(join(dir,'database.json'),JSON.stringify({ format:'los-cedros-night-cloud-v1',created_at:new Date().toISOString(),...data },null,2),{ mode:0o600 });
for (const guest of data.guests) {
  if (!guest.photo_path) continue;
  const result=await get(guest.photo_path,{ access:'private',useCache:false });
  if (!result || result.statusCode!==200) throw new Error('No se pudo descargar una foto. El respaldo está incompleto.');
  writeFileSync(join(dir,'photos',`${guest.id}.bin`),Buffer.from(await new Response(result.stream).arrayBuffer()),{ mode:0o600 });
}
writeFileSync(join(dir,'COMPLETE.txt'),`Respaldo completo. ${data.guests.length} invitados y las fotos cifradas que existan. Guardar esta carpeta de forma privada.\n`,{ mode:0o600 });
console.log(`Respaldo completo: ${dir}. Incluye base, fotos y clave. No publicarlo.`);
