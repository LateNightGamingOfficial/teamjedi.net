// POST /api/portal/logout → clears the session cookie
const auth = require('../_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', auth.sessionCookie(req, '', 0));
  return res.status(200).json({ ok: true });
};
