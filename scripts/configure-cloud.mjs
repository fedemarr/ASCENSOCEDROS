import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cloudDatabase } from '../cloud/database.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const file=join(root,'.env.cloud.local');
if (!existsSync(file)) throw new Error('Primero ejecutar vercel env pull .env.cloud.local --environment production.');
const dataDir=resolve(process.env.DATA_DIR || join(root,'data'));
const key=readFileSync(join(dataDir,'photo.key')).toString('base64');
process.loadEnvFile(file);
try {
  const [existing]=await cloudDatabase().query("SELECT value FROM settings WHERE key='_photo_key_digest'");
  if (existing && existing.value!==createHash('sha256').update(Buffer.from(key,'base64')).digest('hex')) throw new Error('La nube usa otra clave de fotos. No se modificó la configuración.');
} catch (e) { if (e.code!=='42P01') throw e; }
const source=readFileSync(file,'utf8').replace(/^PHOTO_KEY=.*\r?\n?/gm,'');
writeFileSync(file,`${source.trim()}\nPHOTO_KEY="${key}"\n`,{ mode:0o600 });
const cli=process.env.VERCEL_CLI_PATH || join(process.env.APPDATA || '', 'npm','node_modules','vercel','dist','index.js');
if (!existsSync(cli)) throw new Error('Definir VERCEL_CLI_PATH con la ruta al index.js de Vercel CLI.');
for (const environment of ['production','development']) {
  const result=spawnSync(process.execPath,[cli,'env','add','PHOTO_KEY',environment,'--force','--scope','fmcodes-projects'],{ cwd:root,input:`${key}\n`,encoding:'utf8' });
  if (result.status!==0) throw new Error(`No se pudo guardar PHOTO_KEY en ${environment}. Revisar el acceso a Vercel.`);
  console.log(`Clave de fotos configurada en ${environment}.`);
}
