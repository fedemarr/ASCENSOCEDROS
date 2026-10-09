import { neon } from '@neondatabase/serverless';
export function cloudDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL: no se permite usar SQLite en producción.');
  const sql=neon(process.env.DATABASE_URL);
  return {
    query: (text,params=[]) => sql.query(text,params),
    transaction: (statements,options={}) => sql.transaction(statements.map(([text,params=[]]) => sql.query(text,params)),options)
  };
}
