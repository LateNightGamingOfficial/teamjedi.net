// Nav scroll-collapse + hamburger menu toggle

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-brand');
  const mobileMenu = document.querySelector('.nav-mobile-menu');

  if (!nav || !toggle || !mobileMenu) return;

  const SCROLL_THRESHOLD = 60; // pixels scrolled before the nav collapses

  function handleScroll() {
    if (window.scrollY > SCROLL_THRESHOLD) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
      closeMobileMenu();
    }
  }

  function closeMobileMenu() {
    mobileMenu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileMenu() {
    const isOpen = mobileMenu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  }

  window.addEventListener('scroll', handleScroll);
  toggle.addEventListener('click', toggleMobileMenu);

  // Close the menu after clicking a link inside it
  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMobileMenu);
  });

  // Run once on load in case the page is already scrolled (e.g. anchor link reload)
  handleScroll();

  // News popup: shown once per visit (sessionStorage-backed — reappears
  // next time the visitor opens the site in a new session/tab), links to
  // the Current Projects page. Only present on index.html.
  const newsOverlay = document.getElementById('newsPopupOverlay');
  if (newsOverlay) {
    const NEWS_POPUP_KEY = 'jedi-news-popup-seen';
    const closeBtn = document.getElementById('newsPopupClose');

    const closeNewsPopup = () => {
      newsOverlay.classList.remove('is-open');
    };

    let alreadySeen = false;
    try {
      alreadySeen = window.sessionStorage.getItem(NEWS_POPUP_KEY) === '1';
    } catch (e) {
      alreadySeen = false; // sessionStorage unavailable (e.g. private mode) — fail open
    }

    if (!alreadySeen) {
      newsOverlay.classList.add('is-open');
      try { window.sessionStorage.setItem(NEWS_POPUP_KEY, '1'); } catch (e) {}
    }

    closeBtn.addEventListener('click', closeNewsPopup);
    newsOverlay.addEventListener('click', (e) => {
      if (e.target === newsOverlay) closeNewsPopup();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNewsPopup();
    });
  }

  // Footer copyright year
  const yearEl = document.getElementById('copyright-year');
  if (yearEl) {
    yearEl.textContent = `© ${new Date().getFullYear()} JEDI`;
  }

  // Benefit cards: click (or Enter/Space) to expand and reveal more detail
  const benefitCards = document.querySelectorAll('.benefit-card');
  benefitCards.forEach((card) => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-expanded', 'false');

    const toggle = () => {
      const isOpen = card.classList.toggle('is-open');
      card.setAttribute('aria-expanded', String(isOpen));
    };

    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });

  // Scroll-reveal: content blocks fade/slide in as they enter the viewport.
  // Guarded behind a feature check so unsupported browsers just show
  // everything normally instead of risking content stuck invisible.
  if ('IntersectionObserver' in window) {
    const revealEls = document.querySelectorAll(
      '.card, .benefit-card, .deployment-card, .process-step, .callout-box, ' +
      '.stat-cell, .stat-feature, .showcase-row, .log-line, .partner-strip, ' +
      '.contact-card, .teaser-card'
    );
    revealEls.forEach((el) => el.classList.add('reveal'));

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach((el) => revealObserver.observe(el));
  }

  // Smooth page-to-page transitions: fade out before navigating to another
  // page on this site, so it doesn't feel like an abrupt jump-cut. Falls
  // back to normal instant navigation if anything here doesn't apply.
  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    const isSamePageAnchor = href.startsWith('#');
    const isExternal = /^https?:\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
    const opensNewTab = link.target === '_blank';
    if (isSamePageAnchor || isExternal || opensNewTab) return;

    link.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      document.body.classList.add('page-exit');
      setTimeout(() => { window.location.href = href; }, 200);
    });
  });
});

// If the page is restored from the back/forward cache mid-fade, make sure
// it's not left stuck invisible.
window.addEventListener('pageshow', () => {
  document.body.classList.remove('page-exit');
});