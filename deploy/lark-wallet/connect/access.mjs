import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readBody, reply } from './gateway.mjs';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const issuers = ['https://accounts.google.com', 'accounts.google.com'];
const stateCookie = '__Host-aimeter_connect_nonce';
const sessionCookie = '__Host-aimeter_connect_session';

export function googleAccess({ clientId, email, origin, keys = googleKeys, secret = randomBytes(32) }) {
  if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId) || !/^[a-zA-Z0-9.+_-]+@gmail\.com$/.test(email)) {
    throw new Error('Configure the wallet web client and approved Gmail address.');
  }
  function ticket(kind, id, seconds) {
    const data = [kind, id, Math.floor(Date.now()/1000) + seconds].join('.');
    return data + '.' + createHmac('sha256',secret).update(data).digest('base64url');
  }
  function verifiedCookie(req, name, kind) {
    const field = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
    if (!field) return;
    const parts = field.slice(name.length+1).split('.');
    if (parts.length!==4 || parts[0]!==kind || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) || !/^\d{1,12}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return;
    const expected = createHmac('sha256',secret).update(parts.slice(0,3).join('.')).digest('base64url');
    if (Number(parts[2]) <= Date.now()/1000 || !timingSafeEqual(Buffer.from(expected),Buffer.from(parts[3]))) return;
    return parts[1];
  }
  const cookie = (name, value, age) => name+'='+value+'; Path=/; Max-Age='+age+'; HttpOnly; Secure; SameSite=Lax';
  const randomId = () => randomBytes(32).toString('base64url');
  // Nonces are single use, including across simultaneous callback requests.
  const used = new Map();
  async function callback(req,res) {
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(res,403,'Yêu cầu đăng nhập không hợp lệ.');
    const nonce = verifiedCookie(req,stateCookie,'nonce');
    if (!nonce || used.has(nonce)) return reply(res,403,'Phiên đăng nhập đã hết hạn. Anh tải lại trang để đăng nhập.');
    try {
      const { credential } = JSON.parse(await readBody(req,24000));
      const { payload } = await jwtVerify(credential,keys,{issuer:issuers,audience:clientId,algorithms:['RS256'],requiredClaims:['exp','iat','sub'],maxTokenAge:'10m'});
      if (payload.nonce !== nonce || payload.email_verified !== true || payload.email !== email || (payload.azp && payload.azp!==clientId) || used.has(nonce)) throw new Error();
      for (const [id, expiry] of used) if (expiry<=Date.now()) used.delete(id);
      used.set(nonce,Date.now()+600000);
      res.setHeader('set-cookie',[cookie(stateCookie,'',0),cookie(sessionCookie,ticket('session',randomId(),28800),28800)]);
      res.writeHead(204);
      res.end();
    } catch { reply(res,403,'Hãy đăng nhập bằng tài khoản Google được cấp quyền.'); }
  }
  const browserScript = `window.onGoogleWalletReady=function(){
const box=document.getElementById('signin');
const msg=document.getElementById('message');
google.accounts.id.initialize({client_id:box.dataset.client,nonce:box.dataset.nonce,login_hint:box.dataset.email,auto_select:false,callback:async function(result){
  try {const res=await fetch('/connect/sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:result.credential})});
  if(res.ok){location.replace(location.pathname==='/connect/dashboard'?'/connect/dashboard':'/connect');return;} const detail=await res.json();msg.textContent=detail.error.message;}
  catch{msg.textContent='Chưa đăng nhập được. Anh tải lại trang để thử lại.';}
}});
google.accounts.id.renderButton(box,{type:'standard',theme:'outline',size:'large',text:'signin_with',locale:'vi'});
};
const providerScript=document.createElement('script');
providerScript.src='https://accounts.google.com/gsi/client';
providerScript.onload=window.onGoogleWalletReady;
providerScript.onerror=()=>{document.getElementById('message').textContent='Chưa tải được nút Google. Anh tải lại trang để thử lại.';};
document.head.append(providerScript);`;
  return async function handle(req,res) {
    if (req.method==='POST' && req.url==='/connect/sign-in') {await callback(req,res);return false;}
    if (verifiedCookie(req,sessionCookie,'session')) return true;
    if (req.method==='GET' && req.url==='/connect/sign-in.js') {
      res.setHeader('content-type','text/javascript; charset=utf-8'); res.end(browserScript); return false;
    }
    if (req.method==='GET' && (req.url==='/connect' || req.url==='/connect/' || req.url==='/connect/dashboard')) {
      const nonce=randomId();
      res.setHeader('set-cookie',cookie(stateCookie,ticket('nonce',nonce,600),600));
      res.setHeader('content-type','text/html; charset=utf-8');
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.googleusercontent.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if(req.url!=='/connect/dashboard') res.setHeader('cross-origin-opener-policy','same-origin-allow-popups');
      res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Thêm tài khoản · AIMeter</title><style>body{font:1rem/1.5 system-ui;color:#17202b;max-width:35rem;margin:12vh auto;padding:1.4rem}h1{font-size:2rem}#signin{margin:1.5rem 0}</style><h1>${req.url==='/connect/dashboard'?'Xem dashboard AIKING AI Wallet':'Thêm tài khoản vào AIMeter'}</h1><p>Đăng nhập bằng <strong>${email}</strong>.</p><div id="signin" data-email="${email}" data-client="${clientId}" data-nonce="${nonce}"></div><p id="message" role="status"></p><a href="/">Quay về dashboard</a><script src="/connect/sign-in.js"></script></html>`);
      return false;
    }
    reply(res,403,'Cần đăng nhập trước khi thêm tài khoản.');
    return false;
  };
}
