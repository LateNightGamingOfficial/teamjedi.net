// GET /api/portal/metrics?days=7|28|90
// Returns the signed-in user's dashboard data, limited to the sections their
// account is allowed to see. Until Google Analytics is connected it returns
// clearly labelled sample data so the portal can be previewed.

const auth = require('../_lib/auth');
const ga = require('../_lib/ga');
const sample = require('../_lib/sample');

const cache = new Map(); // `${days}` -> { at, data }
const CACHE_MS = 10 * 60 * 1000;

const ymd = (d) => d.toISOString().slice(0, 10);
function ranges(days) {
  const end = new Date(); // today
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - (days - 1));
  const pEnd = new Date(start); pEnd.setUTCDate(start.getUTCDate() - 1);
  const pStart = new Date(pEnd); pStart.setUTCDate(pEnd.getUTCDate() - (days - 1));
  return {
    current: { startDate: ymd(start), endDate: ymd(end), name: 'current' },
    previous: { startDate: ymd(pStart), endDate: ymd(pEnd), name: 'previous' },
  };
}

const eventIs = (name) => ({ filter: { fieldName: 'eventName', stringFilter: { value: name } } });
const notPortal = {
  notExpression: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/portal' } } },
};
const and = (...e) => ({ andGroup: { expressions: e } });

// Each section's queries run independently; one failing (for example a
// custom dimension not registered yet) shows as "not available" instead of
// breaking the whole dashboard.
async function settle(obj) {
  const keys = Object.keys(obj);
  const results = await Promise.allSettled(keys.map((k) => obj[k]));
  const out = {}, errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out[keys[i]] = r.value;
    else { out[keys[i]] = null; errors[keys[i]] = String(r.reason && r.reason.message || r.reason).slice(0, 200); }
  });
  if (Object.keys(errors).length) out._errors = errors;
  return out;
}

async function liveData(days) {
  const R = ranges(days);
  const cur = [R.current];
  const totalsMetrics = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'userEngagementDuration', 'engagementRate']
    .map((name) => ({ name }));

  const totals = ga.runReport({ dateRanges: [R.current, R.previous], metrics: totalsMetrics, dimensionFilter: notPortal })
    .then((rows) => {
      const pick = (n) => rows.find((r) => r.dateRange === n) || {};
      return { current: pick('current'), previous: pick('previous') };
    });

  const traffic = settle({
    totals,
    trend: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
      dimensionFilter: notPortal, orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
    pages: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
      dimensionFilter: notPortal, orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 12,
    }),
  });

  const engagement = settle({
    totals,
    sections: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'pagePath' }, { name: 'customEvent:section' }],
      metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
      dimensionFilter: and(eventIs('section_time'), notPortal),
      orderBys: [{ metric: { metricName: 'eventValue' }, desc: true }], limit: 40,
    }),
    scroll: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'pagePath' }, { name: 'customEvent:percent' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: and(eventIs('scroll_depth'), notPortal), limit: 200,
    }),
    pages: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: notPortal, limit: 50,
    }),
  });

  const sources = settle({
    countries: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }],
      dimensionFilter: notPortal, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 10,
    }),
    channels: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }],
      dimensionFilter: notPortal, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8,
    }),
    referrers: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }],
      dimensionFilter: notPortal, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8,
    }),
    devices: ga.runReport({
      dateRanges: cur, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }],
      dimensionFilter: notPortal, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    }),
  });

  const [t, e, s] = await Promise.all([traffic, engagement, sources]);
  return { range: { start: R.current.startDate, end: R.current.endDate, days }, traffic: t, engagement: e, sources: s };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  let user = null;
  try { user = await auth.currentUser(req); } catch { user = null; }
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  if (user.mustChange) return res.status(403).json({ error: 'Choose a new password first.', mustChange: true });

  const days = [7, 28, 90].includes(Number(req.query && req.query.days)) ? Number(req.query.days) : 28;
  const live = ga.isConfigured();

  let data;
  try {
    if (!live) {
      data = sample(days);
    } else {
      const hit = cache.get(String(days));
      if (hit && Date.now() - hit.at < CACHE_MS) data = hit.data;
      else {
        data = await liveData(days);
        cache.set(String(days), { at: Date.now(), data });
      }
    }
  } catch (err) {
    return res.status(502).json({ error: 'Couldn’t reach Google Analytics right now. Please try again shortly.' });
  }

  const out = {
    user: { name: user.name, org: user.org, sections: user.sections, admin: !!user.admin },
    sample: !live,
    // Clarity heatmaps need a Clarity login, so only your own team gets the link.
    clarityUrl: user.admin ? 'https://clarity.microsoft.com/projects/view/z30sll1b52/dashboard' : null,
    adminUrl: user.admin ? (process.env.ADMIN_URL || 'https://admin.teamjedi.net/') : null,
    range: data.range,
  };
  for (const s of user.sections) out[s] = data[s];
  return res.status(200).json(out);
};
