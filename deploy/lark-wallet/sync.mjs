import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const label = 'Kỳ / ghi chú', account = 'Tài khoản', limit = 'Hạn mức';
const used = 'Đã sử dụng', unit = 'Đơn vị', reset = 'Ngày reset', updated = 'Cập nhật gần nhất';
const names = [label, account, limit, used, unit, reset, updated];
const api = 'https://open.larksuite.com/open-apis';

function textValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(entry => entry?.text || '').join('');
  return '';
}

export function links(value) {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  const ids = entries.flatMap(entry => {
    if (typeof entry === 'string') return [entry];
    return entry.link_record_ids ?? entry.record_ids ?? (entry.record_id ? [entry.record_id] : []);
  });
  if (!ids.length && entries.length) throw Error('Unrecognized linked account format');
  return ids;
}

function key(a, title) { return JSON.stringify([a, title]); }

export function rowsFrom(providers, accounts, bindings) {
  const rows = new Map();
  let unmapped = 0, unavailable = 0;
  for (const p of providers) {
    if (!Array.isArray(p.progress) || !Number.isSafeInteger(p.updatedAt) || p.updatedAt <= 0) {
      unavailable++;
      continue;
    }
    const binding = bindings[p.id];
    const accountId = binding?.accountRecordId || accounts.byName.get(p.name);
    if (!accountId || !accounts.ids.has(accountId)) { unmapped++; continue; }
    for (const item of p.progress) {
      if (!item.name || !Number.isFinite(item.usedPercent) || item.usedPercent < 0) continue;
      const title = binding?.windows?.[item.name] || (p.provider + ' · ' + item.name);
      const id = key(accountId, title);
      if (rows.has(id)) throw Error('Two usage windows match the same target');
      rows.set(id, {
        [label]: title, [account]: [accountId], [limit]: 100, [used]: item.usedPercent,
        [unit]: '%', [reset]: item.resetsAt > 0 && Number.isSafeInteger(item.resetsAt) ? item.resetsAt * 1000 : null,
        [updated]: p.updatedAt * 1000
      });
    }
  }
  return {rows, unmapped, unavailable};
}

export function planWrites(rows, records) {
  const index = new Map();
  for (const record of records) {
    const fields = record.fields;
    const ids = links(fields[account]);
    for (const id of ids) {
      const k = key(id, textValue(fields[label]));
      if (!rows.has(k)) continue;
      if (ids.length !== 1 || index.has(k)) throw Error('Ambiguous existing Usage row');
      index.set(k, record);
    }
  }
  const creates = [], updates = [];
  for (const [k, fields] of rows) {
    const existing = index.get(k);
    if (!existing) { creates.push({fields}); continue; }
    const current = existing.fields;
    if (current[updated] > fields[updated]) continue;
    if (textValue(current[unit]) && textValue(current[unit]) !== '%') throw Error('Existing Usage row has another unit');
    const changes = {};
    for (const name of [limit, used, unit, reset, updated]) {
      const old = name === unit ? textValue(current[name]) : (current[name] ?? null);
      if (old !== fields[name]) changes[name] = fields[name];
    }
    if (Object.keys(changes).length) updates.push({record_id:existing.record_id, fields:changes});
  }
  return {creates, updates};
}

async function request(url, options = {}) {
  const res = await fetch(url, {...options, redirect:'error', signal:AbortSignal.timeout(20000)});
  if (!res.ok) throw Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.code !== undefined && data.code !== 0) throw Error('Lark API ' + data.code);
  return data;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw Error('Missing ' + name);
  return value;
}

class Wallet {
  constructor() {
    this.base = api + '/bitable/v1/apps/' + encodeURIComponent(required('LARK_BASE_TOKEN'));
    this.table = required('LARK_USAGE_TABLE_ID');
    this.bindings = JSON.parse(process.env.WALLET_BINDINGS_JSON || '{}');
  }
  async call(url, method = 'GET', body) {
    if (!this.token || this.expires <= Date.now()) {
      const auth = await request(api + '/auth/v3/tenant_access_token/internal', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({app_id:required('LARK_APP_ID'), app_secret:required('LARK_APP_SECRET')})
      });
      if (!auth.tenant_access_token || !(auth.expire > 60)) throw Error('No valid Lark authorization');
      this.token = auth.tenant_access_token;
      this.expires = Date.now() + (auth.expire - 60) * 1000;
    }
    const result = await request(url, {method, headers:{authorization:'Bearer ' + this.token, 'content-type':'application/json'}, body:body && JSON.stringify(body)});
    if (!result.data) throw Error('Unexpected Lark response');
    return result.data;
  }
  async list(table, type, fields) {
    const url = new URL(this.base + '/tables/' + encodeURIComponent(table) + '/' + type);
    url.searchParams.set('page_size','100');
    if (fields) url.searchParams.set('field_names', JSON.stringify(fields));
    const all = [], seen = new Set();
    while (true) {
      const page = await this.call(url);
      all.push(...(page.items || []));
      if (!page.has_more) return all;
      if (!page.page_token || seen.has(page.page_token)) throw Error('Invalid Lark pagination');
      seen.add(page.page_token);
      url.searchParams.set('page_token', page.page_token);
    }
  }
  async schema() {
    const fields = await this.list(this.table, 'fields');
    const byName = new Map(fields.map(f => [f.field_name, f]));
    const expected = [[label,[1]],[account,[18,21]],[limit,[2]],[used,[2]],[unit,[1]],[reset,[5]],[updated,[5]]];
    for (const [name,types] of expected) {
      if (!types.includes(byName.get(name)?.type)) throw Error('Usage field mismatch: ' + name);
    }
    const table = byName.get(account).property?.table_id;
    if (!table) throw Error('Cannot identify linked accounts table');
    const primary = (await this.list(table,'fields')).find(f=>f.is_primary);
    if (!primary) throw Error('No primary account field');
    return {table, primary:primary.field_name};
  }
  async accounts(schema) {
    const records = await this.list(schema.table, 'records', [schema.primary]);
    const ids = new Set(), byName = new Map();
    for (const r of records) {
      ids.add(r.record_id);
      const name = textValue(r.fields[schema.primary]);
      if (name) byName.set(name, byName.has(name) ? null : r.record_id);
    }
    return {ids, byName};
  }
  async write({creates,updates}) {
    const url = this.base + '/tables/' + encodeURIComponent(this.table) + '/records';
    for (const record of creates) {
      // Repeat the same logical create after a lost response without duplicating it.
      const digest = createHash('sha256').update(JSON.stringify([this.base,this.table,record.fields[account],record.fields[label]])).digest('hex');
      const token = [digest.slice(0,8),digest.slice(8,12),'4'+digest.slice(13,16),'8'+digest.slice(17,20),digest.slice(20,32)].join('-');
      await this.call(url + '?client_token=' + token, 'POST', record);
    }
    for (let i=0; i<updates.length; i+=100) {
      await this.call(url + '/batch_update','POST',{records:updates.slice(i,i+100)});
    }
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const dry = process.argv.includes('--dry-run');
  const wallet = new Wallet();
  const secret = required('AIMETER_ENDPOINT_SECRET');
  const interval = Number(process.env.WALLET_SYNC_SECONDS || 60);
  if (!Number.isSafeInteger(interval) || interval < 10) throw Error('Invalid WALLET_SYNC_SECONDS');
  let previous, reconcileAt = 0, schema, failures = 0;
  do {
    try {
      const result = await request('http://aimeter:3000/api/endpoint/subscriptions?format=json&pretty=false', {
        headers:{'x-aimeter-endpoint-secret':secret}
      });
      if (!result.success || !Array.isArray(result.providers)) throw Error('Invalid AIMeter export');
      const signature = JSON.stringify(result.providers.map(p=>[p.id,p.name,p.provider,p.updatedAt,p.progress,p.code]));
      if (signature !== previous || Date.now() >= reconcileAt) {
        schema ??= await wallet.schema();
        const {rows,unmapped,unavailable} = rowsFrom(result.providers, await wallet.accounts(schema), wallet.bindings);
        const changes = planWrites(rows, rows.size ? await wallet.list(wallet.table,'records',names) : []);
        if (!dry) await wallet.write(changes);
        console.log(JSON.stringify({dry,providers:result.providers.length,windows:rows.size,unmapped,unavailable,creates:changes.creates.length,updates:changes.updates.length}));
        previous = signature;
        reconcileAt = Date.now() + 30*60*1000;
      }
      failures = 0;
    } catch (err) {
      if (once) throw err;
      failures++;
      console.error('Sync failed:',err.message);
    }
    if (!once) await delay(Math.min(interval * 2**Math.min(failures,4), Math.max(interval,900))*1000);
  } while (!once);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(err=>{console.error(err.message); process.exitCode=1;});
}
