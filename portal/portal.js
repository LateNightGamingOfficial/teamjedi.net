/* JEDI Metrics Portal — turns Google Analytics data into a plain-English view. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var who = document.getElementById('who');
  var days = 28;
  try { days = Number(localStorage.getItem('jedi-portal-days')) || 28; } catch (e) {}
  if ([7, 28, 90].indexOf(days) < 0) days = 28;

  // ---------- formatting ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function pct(n, digits) { return ((n || 0) * 100).toFixed(digits || 0) + '%'; }
  function dur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + 's';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + 'h ' + m + 'm' : m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  }
  function ratio(a, b) { return b ? a / b : 0; }
  function change(cur, prev) {
    if (!prev) return '<span>New this period</span>';
    var c = (cur - prev) / prev;
    if (Math.abs(c) < 0.005) return '<span>No change</span> vs previous ' + days + ' days';
    var up = c > 0;
    return '<span class="' + (up ? 'up' : 'down') + '">' + (up ? '▲ ' : '▼ ') + pct(Math.abs(c)) + '</span> vs previous ' + days + ' days';
  }
  function changeWords(cur, prev) {
    if (!prev) return '';
    var c = (cur - prev) / prev;
    if (Math.abs(c) < 0.03) return ', about the same as the ' + days + ' days before';
    return ', ' + (c > 0 ? 'up ' : 'down ') + pct(Math.abs(c)) + ' on the ' + days + ' days before';
  }

  var PAGE_NAMES = {
    '': 'Home', 'index': 'Home', 'what': 'Meet JEDI', 'how': 'Capability', 'who': 'Track Record',
    'current-projects': 'Current Projects', 'about': 'About', 'contact': 'Contact',
    'ns26': 'Northern Strike 26', 'avt26': 'Avenger Triad 26',
  };
  function pageName(path) {
    var key = String(path || '').replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
    if (PAGE_NAMES.hasOwnProperty(key)) return PAGE_NAMES[key];
    return key.replace(/[-_/]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || 'Home';
  }
  var SECTION_NAMES = {
    stakes: 'Why it matters', products: 'Products', deploy: 'Call to action', overview: 'Overview',
    role: 'Team JEDI’s role', accomplishments: 'Key accomplishments', useraf: 'USAREUR-AF',
    'ns26-gallery': 'NS26 photo gallery', footer: 'Footer', ns26: 'Northern Strike 26',
  };
  function sectionName(raw) {
    if (!raw || raw === '(not set)') return 'Unnamed section';
    if (SECTION_NAMES[raw]) return SECTION_NAMES[raw];
    if (/^section-\d+$/.test(raw)) return 'Section ' + raw.split('-')[1];
    if (/^[a-z0-9-]+$/.test(raw)) return raw.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return raw.length > 48 ? raw.slice(0, 46) + '…' : raw;
  }
  var CHANNEL_NOTES = {
    'Direct': 'typed the address or used a bookmark', 'Organic Search': 'found it on Google or Bing',
    'Referral': 'followed a link from another site', 'Organic Social': 'came from social media',
    'Email': 'clicked a link in an email', 'Paid Search': 'clicked a search ad', 'Unassigned': 'source unknown',
  };

  // ---------- small builders ----------
  function tile(label, value, delta, hint, isText) {
    return '<div class="card tile"><div class="label">' + esc(label) + '</div><div class="value' + (isText ? ' text' : '') + '">' + value + '</div>' +
      (delta ? '<div class="delta">' + delta + '</div>' : '') + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function bars(items, max) {
    max = max || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return '<ul class="bars">' + items.map(function (i) {
      var w = Math.max(0.5, ratio(i.value, max) * 100);
      return '<li title="' + esc(i.title || '') + '"><span class="name">' + i.name + '</span><span class="num">' + i.label + '</span>' +
        '<span class="track"><span class="fill" style="display:block;width:' + w.toFixed(1) + '%"></span></span></li>';
    }).join('') + '</ul>';
  }
  function tableView(head, rows) {
    return '<details class="table-view"><summary>Show as table</summary><table><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></details>';
  }
  function unavailable(title, why) {
    return '<div class="card unavailable"><h3>' + esc(title) + '</h3><p class="sub">' + esc(why) + '</p></div>';
  }
  function section(id, tag, title, takeaway, body, extra) {
    return '<section class="p-section" id="' + id + '"><header><div><span class="tag mono">' + esc(tag) + '</span>' +
      '<h2 class="display">' + esc(title) + '</h2></div>' + (extra || '') + '</header>' +
      (takeaway ? '<p class="takeaway">' + takeaway + '</p>' : '') + body + '</section>';
  }

  // ---------- trend chart (single series, crosshair tooltip) ----------
  function drawTrend(el, rows) {
    var w = el.clientWidth || 600, h = 220, padL = 34, padR = 8, padT = 10, padB = 26;
    var vals = rows.map(function (r) { return r.activeUsers; });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var step = Math.pow(10, Math.floor(Math.log10(maxV)));
    var top = Math.ceil(maxV / step) * step; if (top / step > 6) step *= 2; top = Math.ceil(maxV / step) * step;
    var x = function (i) { return padL + (rows.length < 2 ? 0 : i * (w - padL - padR) / (rows.length - 1)); };
    var y = function (v) { return padT + (1 - v / top) * (h - padT - padB); };
    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(r.activeUsers).toFixed(1); }).join('');
    var area = d + 'L' + x(rows.length - 1).toFixed(1) + ',' + y(0) + 'L' + x(0).toFixed(1) + ',' + y(0) + 'Z';
    var g = '';
    for (var v = 0; v <= top; v += step) {
      g += '<line class="gridline" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis-label" x="' + (padL - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + num(v) + '</text>';
    }
    var labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor(w / 90)));
    rows.forEach(function (r, i) {
      if (i % labelEvery === 0 || i === rows.length - 1 && (rows.length - 1) % labelEvery > labelEvery / 2) {
        g += '<text class="axis-label" x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="middle">' + shortDate(r.date) + '</text>';
      }
    });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Daily visitors over the last ' + days + ' days">' + g +
      '<path class="area" d="' + area + '"/><path class="line" d="' + d + '"/>' +
      '<line class="cross" y1="' + padT + '" y2="' + (h - padB) + '" style="display:none"/><circle class="dot" r="4.5" style="display:none"/>' +
      '<rect x="' + padL + '" y="0" width="' + (w - padL - padR) + '" height="' + h + '" fill="transparent"/></svg><div class="tooltip"></div>';
    var svg = el.querySelector('svg'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot'), tip = el.querySelector('.tooltip');
    function show(evt) {
      var rect = svg.getBoundingClientRect();
      var px = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      var i = Math.round((px - padL) / ((w - padL - padR) / Math.max(1, rows.length - 1)));
      i = Math.max(0, Math.min(rows.length - 1, i));
      var r = rows[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(r.activeUsers)); dot.style.display = '';
      tip.innerHTML = '<span class="k">' + longDate(r.date) + '</span>' + num(r.activeUsers) + ' visitors · ' + num(r.screenPageViews) + ' page views';
      tip.style.left = Math.min(Math.max(x(i) * rect.width / w, 90), rect.width - 90) + 'px';
      tip.style.top = (y(r.activeUsers) * rect.height / h) + 'px';
      tip.classList.add('on');
    }
    function hide() { cross.style.display = dot.style.display = 'none'; tip.classList.remove('on'); }
    svg.addEventListener('mousemove', show); svg.addEventListener('touchstart', show, { passive: true });
    svg.addEventListener('touchmove', show, { passive: true }); svg.addEventListener('mouseleave', hide);
  }
  function toDate(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }
  function shortDate(s) { return toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function longDate(s) { return toDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }

  // ---------- sections ----------
  function renderTraffic(t) {
    var cur = (t.totals && t.totals.current) || {}, prev = (t.totals && t.totals.previous) || {};
    var tiles = !t.totals ? unavailable('Totals', 'Not available right now.') :
      '<div class="grid tiles">' +
      tile('Visitors', num(cur.activeUsers), change(cur.activeUsers, prev.activeUsers), num(cur.newUsers) + ' were first-time visitors') +
      tile('Page views', num(cur.screenPageViews), change(cur.screenPageViews, prev.screenPageViews)) +
      tile('Time per visitor', dur(ratio(cur.userEngagementDuration, cur.activeUsers)),
        change(ratio(cur.userEngagementDuration, cur.activeUsers), ratio(prev.userEngagementDuration, prev.activeUsers)), 'Active time on the site') +
      tile('Pages per visit', ratio(cur.screenPageViews, cur.sessions).toFixed(1), change(ratio(cur.screenPageViews, cur.sessions), ratio(prev.screenPageViews, prev.sessions))) +
      '</div>';

    var pages = (t.pages || []).slice(0, 8);
    var pagesCard = !t.pages ? unavailable('Most visited pages', 'Not available right now.') :
      '<div class="card"><h3>Most visited pages</h3><p class="sub">Page views, with the average time someone spends on that page</p>' +
      bars(pages.map(function (p) {
        return { name: esc(pageName(p.pagePath)), value: p.screenPageViews,
          label: num(p.screenPageViews) + '<em>' + dur(ratio(p.userEngagementDuration, p.screenPageViews)) + '</em>' };
      })) +
      tableView(['Page', 'Views', 'Visitors', 'Avg time'], pages.map(function (p) {
        return [pageName(p.pagePath), num(p.screenPageViews), num(p.activeUsers), dur(ratio(p.userEngagementDuration, p.screenPageViews))];
      })) + '</div>';

    var trendCard = !t.trend ? unavailable('Visitors per day', 'Not available right now.') :
      '<div class="card"><h3>Visitors per day</h3><p class="sub">Hover or tap the line for each day’s numbers</p><div class="chart" id="trend"></div>' +
      tableView(['Date', 'Visitors', 'Page views'], t.trend.map(function (r) { return [longDate(r.date), num(r.activeUsers), num(r.screenPageViews)]; })) + '</div>';

    var top = pages.slice(0, 3).map(function (p) { return '<b>' + esc(pageName(p.pagePath)) + '</b>'; });
    var take = top.length ? top[0] + ' gets the most views' + (top.length > 1 ? ', followed by ' + top.slice(1).join(' and ') : '') + '.' : '';
    return section('traffic', 'Traffic', 'Visitors & top pages', take, tiles + '<div class="grid two" style="margin-top:14px">' + trendCard + pagesCard + '</div>');
  }

  function renderEngagement(e, clarityUrl) {
    var cur = (e.totals && e.totals.current) || {};
    var views = {}; (e.pages || []).forEach(function (p) { views[p.pagePath] = p.screenPageViews; });
    var totalViews = (e.pages || []).reduce(function (a, p) { return a + p.screenPageViews; }, 0);

    // scroll depth
    var reach = { 25: 0, 50: 0, 75: 0, 100: 0 }, bottomByPage = {};
    (e.scroll || []).forEach(function (r) {
      var p = String(r['customEvent:percent']);
      if (reach.hasOwnProperty(p)) reach[p] += r.eventCount;
      if (p === '100') bottomByPage[r.pagePath] = r.eventCount;
    });
    var scrollOk = e.scroll && e.pages && totalViews > 0 && e.scroll.length > 0;
    var bottomRate = scrollOk ? Math.min(1, reach[100] / totalViews) : null;

    // sections
    var secs = (e.sections || []).filter(function (r) { return r.eventCount > 0; }).slice(0, 8);
    var secMax = Math.max.apply(null, secs.map(function (s) { return s.eventValue; }).concat([1]));

    var tiles = '<div class="grid tiles">' +
      tile('Engaged visits', e.totals ? pct(cur.engagementRate) : '—', '', 'Stayed 10s+, viewed 2+ pages or got in touch') +
      tile('Time per visitor', e.totals ? dur(ratio(cur.userEngagementDuration, cur.activeUsers)) : '—', '', 'Active time on the site') +
      tile('Read to the bottom', bottomRate == null ? '—' : pct(bottomRate), '', 'Share of page views that scrolled all the way down') +
      tile('Most-read section', secs.length ? esc(sectionName(secs[0]['customEvent:section'])) : '—', '',
        secs.length ? 'on ' + pageName(secs[0].pagePath) : '', true) +
      '</div>';

    var secCard = !e.sections ? unavailable('Where people spend their time',
        'Turns on once the “section” custom dimension is added in Google Analytics.') :
      '<div class="card"><h3>Where people spend their time</h3><p class="sub">Total reading time in each part of a page, with the average per reader</p>' +
      (secs.length ? bars(secs.map(function (s) {
        return { name: esc(sectionName(s['customEvent:section'])) + '<small>' + esc(pageName(s.pagePath)) + '</small>', value: s.eventValue,
          label: dur(s.eventValue) + '<em>' + dur(ratio(s.eventValue, s.eventCount)) + ' avg</em>' };
      }), secMax) + tableView(['Section', 'Page', 'Readers', 'Total time', 'Avg time'], secs.map(function (s) {
        return [sectionName(s['customEvent:section']), pageName(s.pagePath), num(s.eventCount), dur(s.eventValue), dur(ratio(s.eventValue, s.eventCount))];
      })) : '<p class="sub">No section reading time recorded yet.</p>') +
      (clarityUrl ? '<a class="link-out" href="' + esc(clarityUrl) + '" target="_blank" rel="noopener">Open heatmaps &amp; recordings in Clarity →</a>' : '') +
      '</div>';

    var scrollCard;
    if (!scrollOk) {
      scrollCard = unavailable('How far people scroll', e.scroll ? 'No scroll data recorded yet.' :
        'Turns on once the “percent” custom dimension is added in Google Analytics.');
    } else {
      var cols = [25, 50, 75, 100].map(function (p) {
        var r = Math.min(1, reach[p] / totalViews);
        return '<div class="col" title="' + pct(r) + ' of page views reached ' + p + '%"><div class="pct">' + pct(r) + '</div>' +
          '<div class="bar" style="height:' + Math.max(1, r * 100).toFixed(1) + '%"></div></div>';
      }).join('');
      var topPages = (e.pages || []).slice().sort(function (a, b) { return b.screenPageViews - a.screenPageViews; }).slice(0, 6);
      scrollCard = '<div class="card"><h3>How far people scroll</h3><p class="sub">Share of page views that reached each point of the page</p>' +
        '<div class="funnel">' + cols + '</div><div class="funnel-labels"><span>¼ down</span><span>Halfway</span><span>¾ down</span><span>Bottom</span></div>' +
        '<h3 style="margin-top:22px">Read to the bottom, by page</h3><p class="sub">Of each page’s views</p>' +
        bars(topPages.map(function (p) {
          var r = Math.min(1, ratio(bottomByPage[p.pagePath] || 0, p.screenPageViews));
          return { name: esc(pageName(p.pagePath)), value: r, label: pct(r) };
        }), 1) + '</div>';
    }

    var take = '';
    if (secs.length) take = 'People spend the most time on <b>' + esc(sectionName(secs[0]['customEvent:section'])) + '</b> (' + esc(pageName(secs[0].pagePath)) + ')';
    if (bottomRate != null) take += (take ? ', and ' : '') + '<b>' + pct(bottomRate) + '</b> of page views make it to the bottom of the page';
    if (take) take += '.';
    return section('engagement', 'Engagement', 'What people read', take, tiles + '<div class="grid halves" style="margin-top:14px">' + secCard + scrollCard + '</div>');
  }

  function renderSources(s) {
    var c = s.countries || [], ch = s.channels || [], rf = s.referrers || [], dv = s.devices || [];
    var users = c.reduce(function (a, r) { return a + r.activeUsers; }, 0);
    var sess = ch.reduce(function (a, r) { return a + r.sessions; }, 0);
    var devUsers = dv.reduce(function (a, r) { return a + r.activeUsers; }, 0);

    var countries = !s.countries ? unavailable('Countries', 'Not available right now.') :
      '<div class="card"><h3>Countries</h3><p class="sub">Visitors by country</p>' +
      bars(c.slice(0, 8).map(function (r) { return { name: esc(r.country), value: r.activeUsers, label: num(r.activeUsers) + '<em>' + pct(ratio(r.activeUsers, users)) + '</em>' }; })) + '</div>';
    var channels = !s.channels ? unavailable('How they found the site', 'Not available right now.') :
      '<div class="card"><h3>How they found the site</h3><p class="sub">Visits by how people arrived</p>' +
      bars(ch.map(function (r) {
        var n = r.sessionDefaultChannelGroup;
        return { name: esc(n) + (CHANNEL_NOTES[n] ? '<small>' + esc(CHANNEL_NOTES[n]) + '</small>' : ''), value: r.sessions, label: pct(ratio(r.sessions, sess)) };
      })) + '</div>';
    var referrers = !s.referrers ? unavailable('Top sources', 'Not available right now.') :
      '<div class="card"><h3>Top sources</h3><p class="sub">The specific sites and searches that sent visitors</p>' +
      bars(rf.map(function (r) {
        var n = r.sessionSource === '(direct)' ? 'Direct / bookmark' : r.sessionSource;
        return { name: esc(n), value: r.sessions, label: num(r.sessions) + ' visits' };
      })) + '</div>';
    var devices = !s.devices ? unavailable('Devices', 'Not available right now.') :
      '<div class="card"><h3>Devices</h3><p class="sub">What visitors use to view the site</p>' +
      bars(dv.map(function (r) {
        var n = r.deviceCategory.charAt(0).toUpperCase() + r.deviceCategory.slice(1);
        return { name: esc(n), value: r.activeUsers, label: pct(ratio(r.activeUsers, devUsers)) };
      }), devUsers || 1) + '</div>';

    var take = '';
    if (c.length) take = 'Most visitors are in <b>' + esc(c[0].country) + '</b> (' + pct(ratio(c[0].activeUsers, users)) + ')' +
      (c[1] ? ', then <b>' + esc(c[1].country) + '</b>' : '') + '.';
    if (ch.length) take += ' The most common way in: <b>' + esc(ch[0].sessionDefaultChannelGroup) + '</b>' +
      (CHANNEL_NOTES[ch[0].sessionDefaultChannelGroup] ? ' (' + esc(CHANNEL_NOTES[ch[0].sessionDefaultChannelGroup]) + ')' : '') + '.';
    return section('sources', 'Audience', 'Where visitors come from', take,
      '<div class="grid halves">' + countries + channels + referrers + devices + '</div>');
  }

  function renderSummary(d) {
    var parts = [];
    var t = d.traffic || d.engagement;
    var cur = t && t.totals && t.totals.current, prev = t && t.totals && t.totals.previous;
    var head = 'Last ' + days + ' days';
    if (cur) {
      parts.push('<b>' + num(cur.activeUsers) + ' people</b> visited teamjedi.net' + changeWords(cur.activeUsers, prev && prev.activeUsers) + '.');
      parts.push('On average each spent <b>' + dur(ratio(cur.userEngagementDuration, cur.activeUsers)) + '</b> actively on the site.');
    }
    if (d.traffic && d.traffic.pages && d.traffic.pages[0]) parts.push('<b>' + esc(pageName(d.traffic.pages[0].pagePath)) + '</b> was the most viewed page.');
    if (d.sources && d.sources.countries && d.sources.countries[0]) parts.push('The biggest audience is in <b>' + esc(d.sources.countries[0].country) + '</b>.');
    var range = d.range ? new Date(d.range.start + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
      ' – ' + new Date(d.range.end + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
    return '<div class="summary"><span class="eyebrow mono">' + esc(range) + '</span><h1 class="display">' + esc(head) + ' at a glance</h1>' +
      '<p>' + (parts.join(' ') || 'No data yet for this period.') + '</p></div>';
  }

  function render(d) {
    who.innerHTML = '<b>' + esc(d.user.name) + '</b>' + esc(d.user.org || '') +
      (d.adminUrl ? ' · <a href="' + esc(d.adminUrl) + '">Admin</a>' : '');
    var html = '';
    if (d.sample) html += '<div class="notice"><b>Sample data.</b> Google Analytics isn’t connected yet, so these numbers are made up to preview the layout.</div>';
    html += renderSummary(d);
    if (d.traffic) html += renderTraffic(d.traffic);
    if (d.engagement) html += renderEngagement(d.engagement, d.clarityUrl);
    if (d.sources) html += renderSources(d.sources);
    app.innerHTML = html;
    var tr = document.getElementById('trend');
    if (tr && d.traffic && d.traffic.trend) {
      drawTrend(tr, d.traffic.trend);
      var lastW = tr.clientWidth;
      window.onresize = function () { if (Math.abs(tr.clientWidth - lastW) > 20) { lastW = tr.clientWidth; drawTrend(tr, d.traffic.trend); } };
    }
  }

  function load() {
    document.querySelectorAll('.range button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
    });
    app.setAttribute('aria-busy', 'true');
    fetch('/api/portal/metrics?days=' + days, { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { location.replace('/login'); throw null; }
        return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || 'Something went wrong.'); return b; });
      })
      .then(render)
      .catch(function (err) {
        if (err) app.innerHTML = '<div class="error-box">' + esc(err.message || 'Couldn’t load metrics.') + '</div>';
      })
      .then(function () { app.removeAttribute('aria-busy'); });
  }

  document.querySelectorAll('.range button').forEach(function (b) {
    b.addEventListener('click', function () {
      days = Number(b.dataset.days);
      try { localStorage.setItem('jedi-portal-days', String(days)); } catch (e) {}
      load();
    });
  });
  document.getElementById('signOut').addEventListener('click', function () {
    fetch('/api/portal/logout', { method: 'POST', credentials: 'same-origin' }).then(function () { location.replace('/login'); });
  });

  load();
})();
