import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cloudflareAccess } from './access.mjs';
import { createGateway, reply } from './gateway.mjs';

const origin = process.env.CONNECT_ORIGIN;
if (!origin || !origin.startsWith('https://') || new URL(origin).origin !== origin) throw new Error('Configure the HTTPS origin.');
const email = process.env.CONNECT_EMAIL;
const permitted = cloudflareAccess({issuer:process.env.ACCESS_ISSUER, audience:process.env.ACCESS_AUDIENCE, email});
const password = (await readFile('/run/secrets/aimeter_admin', 'utf8')).trim();
if (!password) throw new Error('Configure the private upstream credential.');
const gateway = createGateway({origin, password, webDir:new URL('./web/', import.meta.url), upstream:'http://aimeter:3000'});

createServer(async (req, res) => {
  res.setHeader('cache-control','private, no-store');
  res.setHeader('referrer-policy','no-referrer');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (!await permitted(req)) return reply(res,403,'Cần xác thực đúng tài khoản để mở trang này.');
    await gateway(req,res);
  } catch {
    if (!res.headersSent) return reply(res,502,'AIMeter chưa xử lý được yêu cầu. Vui lòng thử lại.');
    res.end();
  }
}).listen(8080,'0.0.0.0');
