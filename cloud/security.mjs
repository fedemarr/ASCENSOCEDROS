import { randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
export const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const hashPassword = (password) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
export const checkPassword = (password, stored) => {
  const [salt, hash] = stored.split(':'); const actual = scryptSync(password,salt,64); const expected = Buffer.from(hash,'hex');
  return actual.length === expected.length && timingSafeEqual(actual,expected);
};
export const fail = (status, message) => { throw Object.assign(new Error(message),{ status }); };
export const textField = (value, label, max=80) => {
  if (typeof value!=='string' || value.trim().length<2 || value.trim().length>max || /[\x00-\x1f<>]/.test(value)) fail(400,`${label}: completá entre 2 y ${max} caracteres.`);
  return value.trim().replace(/\s+/g,' ');
};
export function photoCrypto(key) {
  if (key?.length!==32) throw new Error('PHOTO_KEY debe contener 32 bytes.');
  return {
    encrypt(bytes) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv); const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),encrypted]); },
    decrypt(blob) { const bytes=Buffer.from(blob); const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12)); decipher.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]); }
  };
}
