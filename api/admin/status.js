// GET /api/admin/status            → who's signed in, setup checklist, recent activity
// GET /api/admin/status?test=ga    → also runs a tiny live Google Analytics query
const auth = require('../_lib/auth');
const store = require('../_lib/store');
const ga = require('../_lib/ga');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (auth.siteFor(req) !== 'admin') return res.status(404).json({ error: 'Not found' });
  let me;
  try { me = await auth.currentUser(req); } catch { me = null; }
  if (!me) return res.status(401).json({ error: 'Not signed in' });
  if (me.mustChange) return res.status(403).json({ error: 'Choose a new password first.', mustChange: true });

  const secretOk = String(process.env.PORTAL_SECRET || '').length >= 32;
  const out = {
    me: { email: me.email, name: me.name },
    analyticsUrl: process.env.ANALYTICS_URL || 'https://analytics.teamjedi.net/',
    checks: {
      secret: secretOk,
      storage: store.configured(),
      gaApi: ga.isConfigured(),
      gaProperty: String(process.env.GA4_PROPERTY_ID || '') || null,
    },
    tracking: { ga4: 'G-E5Q1QE8N8Q', clarity: 'z30sll1b52' },
    links: {
      ga: 'https://analytics.google.com/',
      clarity: 'https://clarity.microsoft.com/projects/view/z30sll1b52/dashboard',
      vercel: 'https://vercel.com/dashboard',
    },
    activity: [],
  };
  try { out.activity = await auth.auditLog(60); } catch { out.activity = []; }

  if (req.query && req.query.test === 'ga') {
    if (!ga.isConfigured()) out.gaTest = { ok: false, message: 'Google Analytics isn’t connected yet.' };
    else {
      try {
        const rows = await ga.runReport({ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'activeUsers' }] });
        out.gaTest = { ok: true, message: `Connected. ${rows[0] ? rows[0].activeUsers : 0} visitors in the last 7 days.` };
      } catch (err) {
        out.gaTest = { ok: false, message: String(err.message || err).slice(0, 200) };
      }
    }
  }
  return res.status(200).json(out);
};
