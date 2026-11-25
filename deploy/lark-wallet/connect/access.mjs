import { createPublicKey, verify } from 'node:crypto';

export function cloudflareAccess({ issuer, audience, email, fetchImpl = fetch, now = Date.now }) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !/^[a-fA-F0-9]{64}$/.test(audience) || !email) {
    throw new Error('Configure the exact Access team issuer, application audience and allowed email.');
  }
  let keys = new Map();
  let lastLoad = -Infinity;
  let pending;
  async function loadKeys() {
    const response = await fetchImpl(issuer + '/cdn-cgi/access/certs', {redirect:'error',signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('certificates unavailable');
    const bundle = await response.json();
    const updated = new Map();
    for (const jwk of bundle.keys) {
      if (jwk.kty === 'RSA' && typeof jwk.kid === 'string' && (!jwk.alg || jwk.alg === 'RS256')) {
        updated.set(jwk.kid, createPublicKey({key:jwk,format:'jwk'}));
      }
    }
    if (!updated.size) throw new Error('empty key set');
    keys = updated;
    lastLoad = now();
  }
  return async function permitted(req) {
    try {
      const raw = req.headers['cf-access-jwt-assertion'];
      if (typeof raw !== 'string' || raw.length > 16384) return false;
      const parts = raw.split('.');
      if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
      const [header, claims] = parts.slice(0,2).map(p => JSON.parse(Buffer.from(p,'base64url').toString()));
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
      const age = now() - lastLoad;
      if (age >= 300000 || (!keys.has(header.kid) && age >= 30000)) {
        pending ??= loadKeys().finally(() => { pending = undefined; });
        await pending;
      }
      const key = keys.get(header.kid);
      if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2],'base64url'))) return false;
      const t = Math.floor(now()/1000);
      return claims.iss === issuer && Array.isArray(claims.aud) && claims.aud.includes(audience)
        && typeof claims.email === 'string' && claims.email.toLowerCase() === email.toLowerCase()
        && Number.isSafeInteger(claims.exp) && claims.exp > t
        && (claims.nbf === undefined || (Number.isSafeInteger(claims.nbf) && claims.nbf <= t));
    } catch { return false; }
  };
}
