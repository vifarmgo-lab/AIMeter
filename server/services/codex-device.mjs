import { spawn } from 'node:child_process';
import { chown, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

function profile(handle) {
  const base = process.env.AIMETER_CODEX_DEVICE_DIR;
  if (!base || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(handle)) throw Error('Invalid device profile');
  return join(base, handle);
}

export async function newProfile() {
  const id = randomUUID();
  const dir = profile(id);
  await mkdir(dir, { mode: 0o700 });
  if (process.getuid?.() === 0) await chown(dir, 1000, 1000);
  return id;
}

export async function removeProfile(id) {
  await rm(profile(id), { recursive:true, force:true });
}

export async function openClient(id, onNotice = () => {}) {
  const dir = profile(id);
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    cwd: dir, stdio: ['pipe','pipe','ignore'], detached:true,
    env: { PATH:process.env.PATH, HOME:dir, CODEX_HOME:dir, LANG:'C.UTF-8' },
    ...(process.getuid?.() === 0 ? {uid:1000, gid:1000} : {}),
  });
  const lines = createInterface({input:child.stdout});
  const pending = new Map();
  let next = 0, closed = false;
  function close() {
    if (closed) return;
    closed = true;
    lines.close();
    for (const item of pending.values()) item.reject(Error('Codex disconnected'));
    pending.clear();
    child.stdin.destroy();
    if (child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
  }
  child.once('error', close); child.once('close', close); child.stdin.on('error', close);
  lines.on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const item = pending.get(msg.id);
    if (item) {
      pending.delete(msg.id);
      if (msg.error) item.reject(Error('Codex request failed')); else item.resolve(msg.result);
    } else if (msg.method === 'account/login/completed') onNotice(msg.params);
  });
  function call(method, params) {
    if (closed) return Promise.reject(Error('Codex disconnected'));
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Codex timed out')); }, 20000);
      pending.set(id, {resolve:value => {clearTimeout(timer); resolve(value);}, reject:err => {clearTimeout(timer); reject(err);}});
      child.stdin.write(JSON.stringify({id, method, params})+'\n');
    });
  }
  try {
    await call('initialize', {clientInfo:{name:'aimeter_wallet',version:'1.0.0'},capabilities:{experimentalApi:false}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  } catch (e) { close(); throw e; }
  return {
    login: () => call('account/login/start', {type:'chatgptDeviceCode'}),
    limits: () => call('account/rateLimits/read', {}),
    close,
  };
}

export function usageSnapshot(response) {
  const limits = response?.rateLimitsByLimitId?.codex || response?.rateLimits;
  const progress = [];
  for (const [name, item] of [['Session', limits?.primary], ['Weekly', limits?.secondary]]) {
    if (!Number.isFinite(item?.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100) continue;
    progress.push({name, usedPercent:item.usedPercent, remainingPercent:100-item.usedPercent,
      ...(item.windowDurationMins > 0 ? {windowMinutes:item.windowDurationMins} : {}),
      ...(item.resetsAt > 0 ? {resetsAt:new Date(item.resetsAt*1000)} : {})});
  }
  if (!progress.length) throw Error('Codex chưa cung cấp hạn mức cho tài khoản này.');
  return {provider:'codex', progress, identity:{plan:limits.planType || undefined}, updatedAt:new Date()};
}

export async function readCodexUsage(handle) {
  const client = await openClient(handle);
  try { return usageSnapshot(await client.limits()); } finally { client.close(); }
}
