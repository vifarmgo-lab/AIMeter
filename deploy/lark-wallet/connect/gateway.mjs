import {randomBytes} from 'node:crypto';
import { readFile } from 'node:fs/promises';

const providers = new Set(['aliyun', 'antigravity', 'claude', 'codex', 'kimi', 'minimax', 'zai', 'copilot', 'openrouter', 'ollama', 'opencode', 'cursor']);
const types = new Set(['oauth', 'cookie', 'api_key', 'jwt']);
const regions = new Set(['minimax_global', 'minimax_cn', 'zai_global', 'zai_bigmodel_cn']);
const createFields = new Set(['provider', 'authType', 'credentials', 'name', 'refreshInterval', 'region', 'plan', 'claudeAuthMode', 'opencodeWorkspaceId', 'defaultProgressItem', 'attrs']);

export function supportedRoute(method, path) {
  if (method === 'GET' && /^\/api\/providers\/wallet\/device\/[a-f0-9-]{36}$/.test(path)) return true;
  if (method === 'POST' && (['/api/providers/wallet/device/start','/api/providers/wallet/reading'].includes(path) || /^\/api\/providers\/wallet\/device\/[a-f0-9-]{36}\/cancel$/.test(path))) return true;
  if (method === 'GET') return /^\/api\/providers\/copilot\/auth\/status\/[a-zA-Z0-9_-]{1,128}$/.test(path);
  return method === 'POST' && (path === '/api/providers'
    || /^\/api\/providers\/(claude|codex|antigravity)\/oauth\/(generate-auth-url|exchange-code)$/.test(path)
    || /^\/api\/providers\/copilot\/auth\/(start|complete)$/.test(path));
}

export function validCreate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Object.keys(value).every(key => createFields.has(key))) return false;
  if (!providers.has(value.provider) || !types.has(value.authType)) return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255) return false;
  if (typeof value.credentials !== 'string' || !value.credentials.trim()) return false;
  if (value.region !== undefined && !regions.has(value.region)) return false;
  if (value.refreshInterval !== undefined && (!Number.isInteger(value.refreshInterval) || value.refreshInterval < 0 || value.refreshInterval > 1440)) return false;
  if (value.opencodeWorkspaceId && !/^wrk_[a-zA-Z0-9_-]{1,150}$/.test(value.opencodeWorkspaceId)) return false;
  return true;
}

export function reply(res, status, message) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({success:false,error:{message}}));
}

export async function readBody(req, maxBytes = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('body limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createGateway({ origin, webDir, upstream, password, fetchImpl = fetch }) {
  const tickets=new Map();
  let adminCookie;
  let loginPromise;
  async function login() {
    const result = await fetchImpl(new URL('/api/auth/admin/verify', upstream), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: {'content-type':'application/json','X-AIMeter-Role':'admin'},
      body: JSON.stringify({password}),
    });
    const cookie = result.headers.getSetCookie().map(item => item.split(';')[0]).find(item => /^aimeter_admin_session=[^;\s]+$/.test(item));
    if (!result.ok || !cookie) throw new Error('native login unavailable');
    return cookie;
  }
  async function getCookie() {
    if (adminCookie) return adminCookie;
    loginPromise ??= login().then(value => (adminCookie = value)).finally(() => { loginPromise = undefined; });
    return loginPromise;
  }
  async function forward(method, path, body) {
    const cookie = await getCookie();
    const send = current => fetchImpl(new URL(path, upstream), {
      method, redirect:'error', signal:AbortSignal.timeout(45000),
      headers:{'cookie':current,'X-AIMeter-Role':'admin','content-type':'application/json'}, body,
    });
    let result = await send(cookie);
    if (result.status === 401) {
      await result.body?.cancel();
      if (adminCookie === cookie) adminCookie = undefined;
      result = await send(await getCookie());
    }
    return result;
  }
  return async function gateway(req, res) {
    const path = req.url;
    if (req.method==='GET' && path==='/connect/dashboard') {
      res.setHeader('content-type','text/html; charset=utf-8');
      return res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard AIKING AI Wallet</title><main><p id="status" role="status">Đang mở dashboard AIKING AI Wallet…</p></main><script type="module" src="/connect/dashboard.js"></script></html>');
    }
    if (req.method==='GET' && path==='/connect/dashboard.js') {
      res.setHeader('content-type','text/javascript; charset=utf-8');
      return res.end(await readFile(new URL('./dashboard.mjs',import.meta.url)));
    }
    if (['/connect/viewer/ticket','/connect/viewer/redeem','/connect/viewer/local'].includes(path)) {
      if(req.method!=='POST' || req.headers.origin!==origin || req.headers['content-type']!=='application/json') return reply(res,403,'Yêu cầu không hợp lệ.');
      let body;
      try {body=JSON.parse(await readBody(req,512));} catch {return reply(res,400,'Yêu cầu không hợp lệ.');}
      const now=Date.now();
      if(path==='/connect/viewer/ticket') {
        for (const [key,expiry] of tickets) if(expiry<=now)tickets.delete(key);
        if(tickets.size>=128)return reply(res,429,'Thử lại sau.');
        const ticket=randomBytes(32).toString('base64url');
        tickets.set(ticket,now+60000);
        res.setHeader('content-type','application/json');
        return res.end(JSON.stringify({ticket}));
      }
      if(path==='/connect/viewer/redeem') {
        const expires=tickets.get(body?.ticket);
        if(!expires || expires<=now)return reply(res,403,'Phiên mở dashboard đã hết hạn.');
        tickets.delete(body.ticket);
      }
      const result=await forward('POST','/api/providers/wallet/viewer-session','{}');
      const cookie=result.headers.getSetCookie().find(c=>c.startsWith('aimeter_normal_session='));
      if(result.status!==204 || !cookie)return reply(res,503,'Chưa mở được dashboard.');
      const pair=cookie.split(';')[0];
      const age=cookie.match(/(?:^|; )Max-Age=(\d+)/i)?.[1] || '3600';
      res.setHeader('set-cookie',pair+'; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age='+age);
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET' && (path === '/connect' || path === '/connect/')) {
      res.setHeader('content-type','text/html; charset=utf-8');
      return res.end(await readFile(new URL('index.html', webDir)));
    }
    if (req.method === 'GET' && /^\/connect\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(path)) {
      res.setHeader('content-type',path.endsWith('.js') ? 'text/javascript' : 'text/css');
      try { return res.end(await readFile(new URL(path.slice('/connect/'.length), webDir))); }
      catch { return reply(res,404,'Không tìm thấy tài nguyên.'); }
    }
    const target = path.startsWith('/connect/') ? path.slice('/connect'.length) : '';
    if (!supportedRoute(req.method, target)) return reply(res,404,'Chức năng này không có trên trang thêm tài khoản.');
    let payload;
    if (req.method === 'POST') {
      if (req.headers.origin !== origin) {
        return reply(res,403,'Yêu cầu không hợp lệ.');
      }
      try {
        const raw = await readBody(req);
        if (raw && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new Error();
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (target === '/api/providers' && !validCreate(parsed))) throw new Error();
        payload = JSON.stringify(parsed);
      } catch { return reply(res,400,'Vui lòng kiểm tra lại thông tin tài khoản.'); }
    }
    const result = await forward(req.method, target, payload);
    if (result.status === 204) { res.writeHead(204); return res.end(); }
    const data = await result.json();
    res.writeHead(result.status,{'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  };
}
