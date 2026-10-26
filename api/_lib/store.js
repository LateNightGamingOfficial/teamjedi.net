// Tiny key-value store on Upstash Redis (REST API, no dependencies).
//
// In Vercel: Storage → Create Database → Upstash for Redis → connect it to
// this project. That adds KV_REST_API_URL and KV_REST_API_TOKEN automatically
// (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also work).
//
// Without it, the store reports configured() === false: the portal still works
// with accounts from PORTAL_USERS, but the admin site can't save changes.
// PORTAL_DEV_MEMORY_STORE=1 uses an in-memory store (local testing only).

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const memoryMode = () => process.env.PORTAL_DEV_MEMORY_STORE === '1';

function configured() {
  return memoryMode() || !!(URL_() && TOKEN());
}

// --- in-memory stand-in (dev only) ---
const mem = { h: new Map(), l: new Map(), k: new Map() };
function memCmd([cmd, key, ...a]) {
  const H = () => { if (!mem.h.has(key)) mem.h.set(key, new Map()); return mem.h.get(key); };
  const L = () => { if (!mem.l.has(key)) mem.l.set(key, []); return mem.l.get(key); };
  switch (cmd) {
    case 'HGET': return H().has(a[0]) ? H().get(a[0]) : null;
    case 'HSET': H().set(a[0], a[1]); return 1;
    case 'HDEL': return H().delete(a[0]) ? 1 : 0;
    case 'HGETALL': return [...H().entries()].flat();
    case 'LPUSH': L().unshift(a[0]); return L().length;
    case 'LTRIM': mem.l.set(key, L().slice(Number(a[0]), Number(a[1]) + 1)); return 'OK';
    case 'LRANGE': return L().slice(Number(a[0]), Number(a[1]) + 1);
    case 'INCR': { const v = (Number(mem.k.get(key)) || 0) + 1; mem.k.set(key, v); return v; }
    case 'EXPIRE': setTimeout(() => mem.k.delete(key), Number(a[0]) * 1000).unref(); return 1;
    case 'GET': return mem.k.has(key) ? String(mem.k.get(key)) : null;
    case 'DEL': mem.k.delete(key); return 1;
    default: throw new Error('memory store: unsupported ' + cmd);
  }
}

async function cmd(...args) {
  if (memoryMode()) return memCmd(args.map(String));
  if (!configured()) throw new Error('Storage is not connected.');
  const r = await fetch(URL_(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error('Storage error: ' + (data.error || r.status));
  return data.result;
}

module.exports = { configured, cmd };
