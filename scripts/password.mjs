import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const username = process.argv[2];
if (!['admin', 'seguridad'].includes(username)) { console.error('Uso: npm run password -- admin (o seguridad)'); process.exit(1); }
const dir = resolve(process.env.DATA_DIR || join(root, 'data'));
if (!existsSync(join(dir, 'cedros.sqlite'))) { console.error('Primero iniciá el sistema con npm start.'); process.exit(1); }
const db = new DatabaseSync(join(dir, 'cedros.sqlite'));
const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (!user) { console.error('Usuario no encontrado.'); process.exit(1); }
const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
db.prepare('UPDATE users SET password=? WHERE id=?').run(`${salt}:${scryptSync(password,salt,64).toString('hex')}`,user.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
writeFileSync(join(dir, `nuevo-acceso-${username}.txt`), `Usuario: ${username}\nContraseña: ${password}\n`, { mode: 0o600 });
console.log(`Clave actualizada y sesiones cerradas. Leé data/nuevo-acceso-${username}.txt en privado.`);
db.close();
