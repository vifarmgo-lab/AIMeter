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
