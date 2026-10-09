import { createCloudHandler } from '../cloud/handler.mjs';
let handler;
export default async function main(req, res) {
  try {
    handler ||= createCloudHandler();
    await handler(req, res);
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'El servicio no está disponible. Volvé a intentar en unos instantes.' }));
  }
}
