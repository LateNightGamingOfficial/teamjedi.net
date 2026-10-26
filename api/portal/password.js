// POST /api/portal/password  { current, next }
// Lets any signed-in person (analytics or admin site) choose their own password.
// Ends their sessions on other devices and keeps this one signed in.
const auth = require('../_lib/auth');
const store = require('../_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!auth.sameOrigin(req)) return res.status(403).json({ error: 'Request blocked (wrong origin).' });

  let user;
  try { user = await auth.currentUser(req); } catch { user = null; }
  if (!user) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  if (!store.configured()) return res.status(409).json({ error: 'Password changes aren’t available until account storage is connected.' });

  const ip = auth.clientIp(req);
  try {
    if (await auth.isLockedOut(ip)) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });

    const b = auth.readBody(req);
    const current = String(b.current || '').slice(0, 200);
    const next = String(b.next || '');

    if (!auth.checkPassword(current, user.hash)) {
      await auth.noteFailure(ip);
      return res.status(400).json({ error: 'Your current password isn’t right.', field: 'current' });
    }
    const problem = auth.passwordProblem(next, user.email);
    if (problem) return res.status(400).json({ error: problem, field: 'next' });
    if (next === current) return res.status(400).json({ error: 'Choose a password different from your current one.', field: 'next' });

    const saved = await auth.saveUser(Object.assign({}, user, {
      hash: auth.hashPassword(next),
      ver: (Number(user.ver) || 0) + 1,       // signs out every other session
      mustChange: false,
      createdAt: user.createdAt || new Date().toISOString(),
      createdBy: user.createdBy || 'PORTAL_USERS',
    }));
    await auth.clearFailures(ip);
    await auth.audit(user.email, 'changed own password', user.email);

    const site = auth.siteFor(req);
    res.setHeader('Set-Cookie', auth.sessionCookie(req, auth.createSession(saved, site), auth.SESSION_HOURS[site] * 3600));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Couldn’t change the password right now. Please try again.' });
  }
};
