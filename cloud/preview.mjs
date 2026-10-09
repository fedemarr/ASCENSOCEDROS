import http from 'node:http';
import { createCloudHandler } from './handler.mjs';
const server=http.createServer(createCloudHandler({ secureCookies:false }));
server.listen(Number(process.env.PORT || 3001),'127.0.0.1',() => console.log(`Vista de la base en la nube: http://localhost:${process.env.PORT || 3001}`));
