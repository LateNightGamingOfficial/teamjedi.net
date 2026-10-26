// Accounts, sessions and security helpers shared by /api/portal/* and /api/admin/*.
//
// Where accounts live
//   1. Storage (Upstash Redis, see store.js): accounts created in the admin site
//      at admin.teamjedi.net. Editable there.
//   2. PORTAL_USERS environment variable: "bootstrap" accounts, e.g. the first
//      admin. Read-only in the admin site (edit them in Vercel). An account in
//      storage with the same email takes precedence.
//   Generate a bootstrap entry with: node scripts/portal-add-user.js
//
// Sessions
//   Signed cookie (HMAC-SHA256 with PORTAL_SECRET), HttpOnly, Secure,
//   SameSite=Strict, scoped to the host that issued it. A session records which
//   site it's for ("analytics" or "admin") and the account's version number;
//   resetting a password, disabling or deleting an account bumps the version
//   and signs that person out everywhere.

const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'jedi_session';
const SESSION_HOURS = { analytics: 12, admin: 4 };
const ALL_SECTIONS = ['traffic', 'engagement', 'sources'];
const USERS_KEY = 'portal:users';
const LOGIN_KEY = 'portal:lastlogin';
const AUDIT_KEY = 'portal:audit';

// ---------- hosts ----------
const ADMIN_HOST = () => (process.env.ADMIN_HOST || 'admin.teamjedi.net').toLowerCase();
function hostOf(req) { return String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0]; }
function siteFor(req) {
  const h = hostOf(req);
  return h === ADMIN_HOST() || h === 'admin.localhost' ? 'admin' : 'analytics';
}
function isLocal(req) { const h = hostOf(req); return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1'; }

// Blocks cross-site form posts: state-changing requests must come from a page
// on the same host (browsers always send Origin on POST/PATCH/DELETE fetches).
function sameOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  try { return new URL(origin).hostname.toLowerCase() === hostOf(req); } catch { return false; }
}

// ---------- passwords ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}
function checkPassword(password, stored) {
  const [kind, salt, key] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const real = Buffer.from(key, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));
function generatePassword() {
  // 4 groups of 4 from an unambiguous alphabet, e.g. "k7Qm-9xTb-Wd3r-Hp2n"
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += abc[bytes[i] % abc.length] + (i % 4 === 3 && i < 15 ? '-' : '');
  return s;
}

// ---------- accounts ----------
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function cleanSections(s) {
  return Array.isArray(s) && s.length ? ALL_SECTIONS.filter((x) => s.includes(x)) : ALL_SECTIONS.slice();
}
function envUsers() {
  try {
    const list = JSON.parse(process.env.PORTAL_USERS || '[]');
    return (Array.isArray(list) ? list : []).filter((u) => u && u.email).map((u) => ({
      email: normEmail(u.email), name: u.name || u.email, org: u.org || '', hash: u.hash,
      sections: cleanSections(u.sections), admin: u.admin === true, disabled: u.disabled === true,
      ver: 0, source: 'env',
    }));
  } catch { return []; }
}
function parse(json) { try { return JSON.parse(json); } catch { return null; } }

async function getUser(email) {
  const e = normEmail(email);
  if (!e) return null;
  if (store.configured()) {
    const raw = await store.cmd('HGET', USERS_KEY, e);
    const u = raw && parse(raw);
    if (u) return Object.assign({ ver: 0, sections: ALL_SECTIONS, source: 'admin' }, u, { email: e, source: 'admin' });
  }
  return envUsers().find((u) => u.email === e) || null;
}

async function listUsers() {
  const byEmail = new Map(envUsers().map((u) => [u.email, u]));
  let logins = {};
  if (store.configured()) {
    const flat = (await store.cmd('HGETALL', USERS_KEY)) || [];
    for (let i = 0; i < flat.length; i += 2) {
      const u = parse(flat[i + 1]);
      if (u) byEmail.set(flat[i], Object.assign({ ver: 0 }, u, { email: flat[i], source: 'admin' }));
    }
    const lf = (await store.cmd('HGETALL', LOGIN_KEY)) || [];
    for (let i = 0; i < lf.length; i += 2) logins[lf[i]] = lf[i + 1];
  }
  return [...byEmail.values()]
    .map((u) => Object.assign({}, u, { lastLogin: logins[u.email] || null }))
    .sort((a, b) => (b.admin - a.admin) || a.name.localeCompare(b.name));
}

async function saveUser(u) {
  const rec = {
    email: normEmail(u.email), name: u.name, org: u.org || '', hash: u.hash,
    sections: cleanSections(u.sections), admin: u.admin === true, disabled: u.disabled === true,
    ver: Number(u.ver) || 0, createdAt: u.createdAt, createdBy: u.createdBy, updatedAt: new Date().toISOString(),
  };
  await store.cmd('HSET', USERS_KEY, rec.email, JSON.stringify(rec));
  return rec;
}
async function deleteUser(email) { await store.cmd('HDEL', USERS_KEY, normEmail(email)); }

function publicUser(u) {
  return {
    email: u.email, name: u.name, org: u.org || '', sections: u.sections, admin: !!u.admin,
    disabled: !!u.disabled, source: u.source, lastLogin: u.lastLogin || null,
    createdAt: u.createdAt || null, createdBy: u.createdBy || null, updatedAt: u.updatedAt || null,
  };
}

async function recordLogin(email) {
  if (!store.configured()) return;
  try { await store.cmd('HSET', LOGIN_KEY, normEmail(email), new Date().toISOString()); } catch {}
}
async function audit(actor, action, target, detail) {
  if (!store.configured()) return;
  const entry = JSON.stringify({ at: new Date().toISOString(), actor, action, target: target || '', detail: detail || '' });
  try { await store.cmd('LPUSH', AUDIT_KEY, entry); await store.cmd('LTRIM', AUDIT_KEY, 0, 199); } catch {}
}
async function auditLog(n = 50) {
  if (!store.configured()) return [];
  return ((await store.cmd('LRANGE', AUDIT_KEY, 0, n - 1)) || []).map(parse).filter(Boolean);
}

// ---------- failed-login brake ----------
const memAttempts = new Map();
const MAX_TRIES = 8, LOCK_SECONDS = 15 * 60;
async function isLockedOut(ip) {
  if (store.configured()) return Number(await store.cmd('GET', `portal:fail:${ip}`)) >= MAX_TRIES;
  const r = memAttempts.get(ip); return !!(r && r.n >= MAX_TRIES && r.until > Date.now());
}
async function noteFailure(ip) {
  if (store.configured()) {
    const n = await store.cmd('INCR', `portal:fail:${ip}`);
    if (Number(n) === 1) await store.cmd('EXPIRE', `portal:fail:${ip}`, LOCK_SECONDS);
    return;
  }
  const r = memAttempts.get(ip);
  const n = r && r.until > Date.now() ? r.n + 1 : 1;
  memAttempts.set(ip, { n, until: Date.now() + LOCK_SECONDS * 1000 });
}
async function clearFailures(ip) {
  if (store.configured()) { try { await store.cmd('DEL', `portal:fail:${ip}`); } catch {} return; }
  memAttempts.delete(ip);
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'; }

// ---------- sessions ----------
function secret() {
  const s = process.env.PORTAL_SECRET || '';
  if (s.length < 32) throw new Error('PORTAL_SECRET must be set (32+ characters).');
  return s;
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => b64(crypto.createHmac('sha256', secret()).update(data).digest());

function createSession(user, site) {
  const payload = b64(JSON.stringify({ e: user.email, s: site, v: Number(user.ver) || 0, x: Date.now() + SESSION_HOURS[site] * 3600 * 1000 }));
  return `${payload}.${sign(payload)}`;
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

// The signed-in account for this host's site, or null.
async function currentUser(req) {
  const site = siteFor(req);
  const [payload, sig] = readCookie(req, COOKIE).split('.');
  if (!payload || !sig) return null;
  let expected;
  try { expected = sign(payload); } catch { return null; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const data = parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data || Date.now() > data.x || data.s !== site) return null;
  const user = await getUser(data.e);
  if (!user || user.disabled || (Number(user.ver) || 0) !== data.v) return null;
  if (site === 'admin' && !user.admin) return null;
  return Object.assign({}, user, { sections: cleanSections(user.sections) });
}

function sessionCookie(req, value, maxAgeSeconds) {
  return [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', isLocal(req) ? '' : 'Secure', `Max-Age=${maxAgeSeconds}`]
    .filter(Boolean).join('; ');
}

function readBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') body = parse(body) || {};
  return body;
}

module.exports = {
  ALL_SECTIONS, SESSION_HOURS, siteFor, sameOrigin, hashPassword, checkPassword, DUMMY_HASH, generatePassword,
  normEmail, cleanSections, envUsers, getUser, listUsers, saveUser, deleteUser, publicUser, recordLogin, audit, auditLog,
  isLockedOut, noteFailure, clearFailures, clientIp, createSession, currentUser, sessionCookie, readBody,
};
