// /api/admin/users — account management for admin.teamjedi.net (admins only)
//   GET                                  → list accounts
//   POST { action: 'create', ... }       → new account (returns a generated password if none given)
//   POST { action: 'update', ... }       → change name / org / sections / admin / disabled
//   POST { action: 'reset-password', email, password? }
//   POST { action: 'signout', email }    → end all of that person's sessions
//   POST { action: 'delete', email }
const auth = require('../_lib/auth');
const store = require('../_lib/store');

const LABEL = { traffic: 'Visitors', engagement: 'Reading', sources: 'Audience' };
const labels = (secs) => secs.map((x) => LABEL[x] || x).join(', ');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function fail(res, code, error) { return res.status(code).json({ error }); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (auth.siteFor(req) !== 'admin') return fail(res, 404, 'Not found');

  let me;
  try { me = await auth.currentUser(req); } catch { me = null; }
  if (!me) return fail(res, 401, 'Not signed in');

  try {
    if (req.method === 'GET') {
      const users = (await auth.listUsers()).map(auth.publicUser);
      return res.status(200).json({ users, storage: store.configured() });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
    if (!auth.sameOrigin(req)) return fail(res, 403, 'Request blocked (wrong origin).');
    if (!store.configured()) return fail(res, 409, 'Connect storage in Vercel before making changes (see setup guide).');

    const b = auth.readBody(req);
    const action = String(b.action || '');
    const email = auth.normEmail(b.email);
    const isMe = email === me.email;

    if (action === 'create') {
      if (!isEmail(email)) return fail(res, 400, 'Enter a valid email address.');
      if (await auth.getUser(email)) return fail(res, 409, 'An account with that email already exists.');
      const name = clean(b.name, 80);
      if (!name) return fail(res, 400, 'Enter a name.');
      let password = String(b.password || '');
      const generated = !password;
      if (generated) password = auth.generatePassword();
      if (password.length < 12) return fail(res, 400, 'Passwords need at least 12 characters.');
      const user = await auth.saveUser({
        email, name, org: clean(b.org, 120), hash: auth.hashPassword(password), sections: b.sections,
        admin: b.admin === true, disabled: false, ver: 0, createdAt: new Date().toISOString(), createdBy: me.email,
      });
      await auth.audit(me.email, 'created account', email, (user.admin ? 'Admin; ' : '') + 'can see ' + labels(user.sections));
      return res.status(200).json({ user: auth.publicUser(user), password: generated ? password : undefined });
    }

    const existing = await auth.getUser(email);
    if (!existing) return fail(res, 404, 'No account with that email.');

    if (action === 'update') {
      const next = Object.assign({}, existing);
      if (b.name !== undefined) { next.name = clean(b.name, 80); if (!next.name) return fail(res, 400, 'Enter a name.'); }
      if (b.org !== undefined) next.org = clean(b.org, 120);
      if (b.sections !== undefined) {
        if (!Array.isArray(b.sections) || !b.sections.some((s) => auth.ALL_SECTIONS.includes(s))) return fail(res, 400, 'Pick at least one section.');
        next.sections = b.sections;
      }
      if (b.admin !== undefined) {
        if (isMe && b.admin !== true) return fail(res, 400, 'You can’t remove your own admin access.');
        next.admin = b.admin === true;
      }
      if (b.disabled !== undefined) {
        if (isMe && b.disabled === true) return fail(res, 400, 'You can’t switch off your own account.');
        if (b.disabled === true && !existing.disabled) next.ver = (Number(existing.ver) || 0) + 1;
        next.disabled = b.disabled === true;
      }
      if (existing.admin && !next.admin) next.ver = (Number(existing.ver) || 0) + 1; // drops their admin sessions
      if (!next.createdAt) { next.createdAt = new Date().toISOString(); next.createdBy = 'PORTAL_USERS'; }
      const saved = await auth.saveUser(next);
      const changes = [];
      if (existing.name !== saved.name) changes.push('name');
      if ((existing.org || '') !== saved.org) changes.push('organization');
      if (auth.cleanSections(existing.sections).join() !== saved.sections.join()) changes.push('can see ' + labels(saved.sections));
      if (!!existing.admin !== saved.admin) changes.push(saved.admin ? 'made admin' : 'removed admin');
      if (!!existing.disabled !== saved.disabled) changes.push(saved.disabled ? 'switched off' : 'switched on');
      await auth.audit(me.email, 'updated account', email, changes.join('; ') || 'no changes');
      return res.status(200).json({ user: auth.publicUser(saved) });
    }

    if (action === 'reset-password') {
      let password = String(b.password || '');
      const generated = !password;
      if (generated) password = auth.generatePassword();
      if (password.length < 12) return fail(res, 400, 'Passwords need at least 12 characters.');
      const saved = await auth.saveUser(Object.assign({}, existing, {
        hash: auth.hashPassword(password), ver: (Number(existing.ver) || 0) + 1,
        createdAt: existing.createdAt || new Date().toISOString(), createdBy: existing.createdBy || 'PORTAL_USERS',
      }));
      await auth.audit(me.email, 'reset password', email);
      return res.status(200).json({ user: auth.publicUser(saved), password: generated ? password : undefined, signedOutSelf: isMe });
    }

    if (action === 'signout') {
      await auth.saveUser(Object.assign({}, existing, { ver: (Number(existing.ver) || 0) + 1 }));
      await auth.audit(me.email, 'signed out everywhere', email);
      return res.status(200).json({ ok: true, signedOutSelf: isMe });
    }

    if (action === 'delete') {
      if (isMe) return fail(res, 400, 'You can’t delete your own account.');
      if (existing.source === 'env' || auth.envUsers().some((u) => u.email === email)) {
        return fail(res, 409, 'This account is also set in Vercel (PORTAL_USERS), so it would come back. Remove it there, or switch it off here.');
      }
      await auth.deleteUser(email);
      await auth.audit(me.email, 'deleted account', email);
      return res.status(200).json({ ok: true });
    }

    return fail(res, 400, 'Unknown action.');
  } catch (err) {
    return fail(res, 500, 'Something went wrong: ' + String(err.message || err).slice(0, 160));
  }
};
