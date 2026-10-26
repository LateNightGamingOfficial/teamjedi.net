// POST /api/portal/login  { email, password }
// Signs in to whichever site the request came from: analytics.teamjedi.net
// (any active account) or admin.teamjedi.net (admin accounts only).
const auth = require('../_lib/auth');

const NO_MATCH = 'That email and password don’t match an account.';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!auth.sameOrigin(req)) return res.status(403).json({ error: 'Please sign in from the portal page.' });

  const site = auth.siteFor(req);
  const ip = auth.clientIp(req);
  try {
    if (await auth.isLockedOut(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
    }

    const body = auth.readBody(req);
    const email = String(body.email || '').slice(0, 200);
    const password = String(body.password || '').slice(0, 200);

    const user = await auth.getUser(email);
    const passwordOk = auth.checkPassword(password, user ? user.hash : auth.DUMMY_HASH);
    if (!user || !passwordOk) {
      await auth.noteFailure(ip);
      return res.status(401).json({ error: NO_MATCH });
    }
    if (user.disabled) return res.status(403).json({ error: 'This account has been switched off. Contact Team JEDI.' });
    if (site === 'admin' && !user.admin) return res.status(403).json({ error: 'This account doesn’t have admin access.' });

    await auth.clearFailures(ip);
    const token = auth.createSession(user, site);
    await auth.recordLogin(user.email);
    if (site === 'admin') await auth.audit(user.email, 'admin sign-in', user.email);
    res.setHeader('Set-Cookie', auth.sessionCookie(req, token, auth.SESSION_HOURS[site] * 3600));
    return res.status(200).json({ ok: true });
  } catch (err) {
    const setup = /PORTAL_SECRET/.test(err.message);
    return res.status(500).json({ error: setup ? 'The portal isn’t fully set up yet (missing PORTAL_SECRET).' : 'Sign-in is unavailable right now. Please try again shortly.' });
  }
};
