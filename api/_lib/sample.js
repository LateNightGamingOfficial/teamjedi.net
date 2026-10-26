// Sample data in the same shape as the live Google Analytics responses.
// Used only while GA isn't connected; the portal labels it "Sample data".

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const PAGES = [
  ['/', 1.0, 48], ['/current-projects.html', 0.46, 95], ['/what.html', 0.38, 71],
  ['/how.html', 0.31, 88], ['/avt26.html', 0.27, 104], ['/who.html', 0.22, 64],
  ['/about.html', 0.17, 52], ['/ns26.html', 0.14, 77], ['/contact.html', 0.11, 39],
];
const SECTIONS = {
  '/': ['Bad data doesn’t warn you', 'stakes', 'products', 'deploy'],
  '/current-projects.html': ['Current Projects', 'useraf', 'ns26-gallery'],
  '/what.html': ['What does Team JEDI do?', 'modules', 'benefits'],
  '/how.html': ['How it works', 'architecture', 'integrations', 'security'],
  '/avt26.html': ['Team JEDI at Avenger Triad 26', 'overview', 'role', 'accomplishments'],
  '/who.html': ['Track Record', 'ns26', 'partners'],
};

module.exports = function sample(days) {
  const r = rng(days * 7919);
  const end = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - (days - 1));

  const trend = [];
  let usersTotal = 0, viewsTotal = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
    const weekday = d.getUTCDay() % 6 !== 0;
    const users = Math.round((weekday ? 26 : 11) * (0.75 + r() * 0.5) * (1 + i / days * 0.25));
    const views = Math.round(users * (2.1 + r() * 0.8));
    usersTotal += users; viewsTotal += views;
    trend.push({ date: ymd(d).replace(/-/g, ''), activeUsers: users, screenPageViews: views });
  }
  const uniqueUsers = Math.round(usersTotal * 0.78);
  const engagement = Math.round(uniqueUsers * 112);
  const current = {
    activeUsers: uniqueUsers, newUsers: Math.round(uniqueUsers * 0.81), sessions: Math.round(usersTotal * 1.07),
    screenPageViews: viewsTotal, userEngagementDuration: engagement, engagementRate: 0.62,
  };
  const previous = {
    activeUsers: Math.round(uniqueUsers * 0.86), newUsers: Math.round(uniqueUsers * 0.72), sessions: Math.round(usersTotal * 0.93),
    screenPageViews: Math.round(viewsTotal * 0.84), userEngagementDuration: Math.round(engagement * 0.8), engagementRate: 0.57,
  };
  const totals = { current, previous };

  const weight = PAGES.reduce((a, p) => a + p[1], 0);
  const pages = PAGES.map(([pagePath, w, secs]) => {
    const v = Math.round(viewsTotal * w / weight);
    return { pagePath, screenPageViews: v, activeUsers: Math.round(v * 0.7), userEngagementDuration: Math.round(v * secs * (0.85 + r() * 0.3)) };
  });

  const sections = [];
  for (const [path, list] of Object.entries(SECTIONS)) {
    const views = pages.find((p) => p.pagePath === path).screenPageViews;
    list.forEach((s, i) => {
      const count = Math.round(views * (0.95 - i * 0.18));
      const avg = 6 + r() * 30;
      sections.push({ pagePath: path, 'customEvent:section': s, eventCount: count, eventValue: Math.round(count * avg) });
    });
  }
  sections.sort((a, b) => b.eventValue - a.eventValue);

  const scroll = [];
  pages.forEach((p) => {
    const reach = { 25: 0.86, 50: 0.63, 75: 0.44, 100: 0.29 };
    for (const [pct, f] of Object.entries(reach)) {
      scroll.push({ pagePath: p.pagePath, 'customEvent:percent': pct, eventCount: Math.round(p.screenPageViews * f * (0.85 + r() * 0.3)) });
    }
  });

  const split = (total, list) => list.map(([k, f]) => [k, Math.round(total * f)]);
  const countries = split(uniqueUsers, [['United States', 0.52], ['Germany', 0.17], ['Poland', 0.08], ['United Kingdom', 0.06],
    ['Netherlands', 0.05], ['France', 0.04], ['Belgium', 0.03], ['Italy', 0.02]]).map(([country, activeUsers]) => ({ country, activeUsers }));
  const sessions = current.sessions;
  const channels = split(sessions, [['Direct', 0.44], ['Organic Search', 0.27], ['Referral', 0.16], ['Organic Social', 0.08], ['Email', 0.05]])
    .map(([sessionDefaultChannelGroup, s]) => ({ sessionDefaultChannelGroup, sessions: s }));
  const referrers = split(sessions, [['(direct)', 0.44], ['google', 0.25], ['linkedin.com', 0.09], ['army.mil', 0.05], ['nexuslcm.com', 0.04], ['bing', 0.02]])
    .map(([sessionSource, s]) => ({ sessionSource, sessions: s }));
  const devices = split(uniqueUsers, [['desktop', 0.71], ['mobile', 0.26], ['tablet', 0.03]])
    .map(([deviceCategory, activeUsers]) => ({ deviceCategory, activeUsers }));

  return {
    range: { start: ymd(start), end: ymd(end), days },
    traffic: { totals, trend, pages },
    engagement: { totals, sections, scroll, pages: pages.map(({ pagePath, screenPageViews }) => ({ pagePath, screenPageViews })) },
    sources: { countries, channels, referrers, devices },
  };
};
