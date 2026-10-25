/* Team JEDI site analytics
 * ------------------------------------------------------------------
 * Google Analytics 4  → visitors, page views, most visited pages,
 *                       time on page, scroll depth, time per section,
 *                       contact form submissions (contacts per visitor)
 * Microsoft Clarity   → heatmaps and session recordings showing where
 *                       on each page people click, scroll and linger
 *
 * SETUP: paste your two IDs below. Until they're filled in, nothing loads.
 *   GA4:     analytics.google.com → Admin → Data streams → Web → "Measurement ID" (G-XXXXXXXXXX)
 *   Clarity: clarity.microsoft.com → New project → Settings → Overview → "Project ID"
 */
(function () {
  var GA4_ID = 'G-E5Q1QE8N8Q';
  var CLARITY_ID = 'z30sll1b52';

  var gaReady = /^G-[A-Z0-9]{6,}$/.test(GA4_ID) && GA4_ID !== 'G-XXXXXXXXXX';
  var clarityReady = /^[a-z0-9]{6,}$/i.test(CLARITY_ID) && CLARITY_ID !== 'XXXXXXXXXX';

  // Never count local testing.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:') {
    gaReady = clarityReady = false;
  }

  // ---- Google Analytics 4 ------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  if (gaReady) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA4_ID);
  }

  // ---- Microsoft Clarity -------------------------------------------------
  if (clarityReady) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  // Public helper so script.js (contact form) can report events.
  window.jediTrack = function (name, params) {
    if (gaReady) gtag('event', name, params || {});
    if (clarityReady && window.clarity) window.clarity('event', name);
  };

  if (!gaReady) return; // the custom measurements below only feed GA4

  var page = location.pathname.replace(/\/$/, '/index.html').split('/').pop() || 'index.html';

  document.addEventListener('DOMContentLoaded', function () {

    // ---- Scroll depth: 25 / 50 / 75 / 100% --------------------------------
    var marks = [25, 50, 75, 100], sent = {};
    function onScroll() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var pct = max <= 0 ? 100 : Math.round((window.scrollY / max) * 100);
      marks.forEach(function (m) {
        if (pct >= m && !sent[m]) { sent[m] = true; jediTrack('scroll_depth', { percent: m, page: page }); }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // ---- Time spent in each section of the page ---------------------------
    // A section is "being read" while at least 40% of it is on screen and the
    // tab is visible. Totals are sent once when the visitor leaves the page.
    var sections = document.querySelectorAll('header.hero, section, footer');
    var timers = [];
    sections.forEach(function (el, i) {
      var heading = el.querySelector('h1, h2');
      var label = el.id || (heading ? heading.textContent.trim().slice(0, 60) : (el.tagName === 'FOOTER' ? 'footer' : 'section-' + i));
      timers.push({ el: el, label: label, ms: 0, since: null });
    });

    function start(t) { if (t.since === null && !document.hidden) t.since = Date.now(); }
    function stop(t) { if (t.since !== null) { t.ms += Date.now() - t.since; t.since = null; } }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var t = timers.filter(function (x) { return x.el === e.target; })[0];
          if (!t) return;
          t.visible = e.intersectionRatio >= 0.4 ||
            (e.isIntersecting && e.intersectionRect.height >= window.innerHeight * 0.6);
          t.visible ? start(t) : stop(t);
        });
      }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
      timers.forEach(function (t) { io.observe(t.el); });
    }

    document.addEventListener('visibilitychange', function () {
      timers.forEach(function (t) { document.hidden ? stop(t) : (t.visible && start(t)); });
      if (document.hidden) flush();
    });

    var flushed = false;
    function flush() {
      if (flushed) return;
      flushed = true;
      timers.forEach(function (t) {
        stop(t);
        var secs = Math.round(t.ms / 1000);
        if (secs >= 2) {
          gtag('event', 'section_time', {
            page: page, section: t.label, seconds: secs, value: secs, transport_type: 'beacon'
          });
        }
      });
    }
    window.addEventListener('pagehide', flush);

    // ---- Clicks on calls to action -----------------------------------------
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a, button');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var text = (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 80);
      if (/^mailto:/i.test(href)) jediTrack('contact_email_click', { page: page, link_text: text });
      else if (/^tel:/i.test(href)) jediTrack('contact_phone_click', { page: page, link_text: text });
      else if (a.matches('.nav-cta, .btn, .top-banner, .teaser-link, .news-popup a')) {
        jediTrack('cta_click', { page: page, link_text: text, link_url: href });
      }
    });

    // ---- Expanding the accomplishment / benefit cards ----------------------
    document.querySelectorAll('.benefit-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var h = card.querySelector('h4');
        jediTrack('card_expand', { page: page, card: h ? h.textContent.trim() : '' });
      });
    });
  });
})();
