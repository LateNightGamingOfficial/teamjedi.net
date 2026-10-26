/* Change-password dialog shared by analytics.teamjedi.net and admin.teamjedi.net.
 *
 *   JediPassword.open()                                   – normal "Change password"
 *   JediPassword.open({ forced: true, current, done })    – first sign-in: must choose one
 *
 * Any element with id="changePw" opens the normal dialog.
 */
(function () {
  'use strict';

  var html =
    '<dialog id="pwChange" class="pw-change" aria-labelledby="pwcTitle">' +
    '<form novalidate>' +
    '<header class="dlg-head"><h2 class="display" id="pwcTitle">Change password</h2>' +
    '<button type="button" class="dlg-x" data-pwc-close aria-label="Close">×</button></header>' +
    '<div class="dlg-body">' +
    '<p class="pwc-intro" id="pwcIntro">Choose a new password. You’ll stay signed in here and be signed out everywhere else.</p>' +
    '<div class="field" id="pwcCurrentWrap"><label for="pwcCurrent">Current password</label>' +
    '<input id="pwcCurrent" type="password" autocomplete="current-password" /></div>' +
    '<div class="field"><label for="pwcNext">New password</label>' +
    '<input id="pwcNext" type="password" autocomplete="new-password" minlength="12" aria-describedby="pwcHint" />' +
    '<div class="pwc-meter" aria-hidden="true"><span></span></div>' +
    '<div class="pwc-hint" id="pwcHint">At least 12 characters. A short phrase of a few unrelated words works well.</div></div>' +
    '<div class="field"><label for="pwcConfirm">Type it again</label>' +
    '<input id="pwcConfirm" type="password" autocomplete="new-password" /></div>' +
    '<label class="pwc-show"><input type="checkbox" id="pwcShow" /> Show passwords</label>' +
    '<div class="form-msg" id="pwcMsg" role="alert" aria-live="polite"></div>' +
    '</div>' +
    '<footer class="dlg-foot"><button type="button" class="btn-ghost" data-pwc-close>Cancel</button>' +
    '<button type="submit" class="btn btn-inline" id="pwcSave">Save password</button></footer>' +
    '</form></dialog>';

  var dlg, form, opts = {};

  function el(id) { return document.getElementById(id); }

  function strength(pw) {
    var score = 0;
    if (pw.length >= 12) score++;
    if (pw.length >= 16) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
    if (/\s|-/.test(pw) && pw.length >= 16) score++;
    return Math.min(score, 4);
  }

  function build() {
    if (dlg) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    dlg = wrap.firstChild;
    document.body.appendChild(dlg);
    form = dlg.querySelector('form');

    dlg.querySelectorAll('[data-pwc-close]').forEach(function (b) {
      b.addEventListener('click', function () { if (!opts.forced) dlg.close(); });
    });
    dlg.addEventListener('cancel', function (e) { if (opts.forced) e.preventDefault(); });

    el('pwcShow').addEventListener('change', function (e) {
      ['pwcCurrent', 'pwcNext', 'pwcConfirm'].forEach(function (id) { el(id).type = e.target.checked ? 'text' : 'password'; });
    });
    el('pwcNext').addEventListener('input', function (e) {
      var s = strength(e.target.value), bar = dlg.querySelector('.pwc-meter span');
      bar.style.width = (e.target.value ? (s + 1) * 20 : 0) + '%';
      bar.className = 's' + s;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = el('pwcMsg');
      var current = opts.current != null ? opts.current : el('pwcCurrent').value;
      var next = el('pwcNext').value, confirm = el('pwcConfirm').value;
      if (!current) { msg.textContent = 'Enter your current password.'; el('pwcCurrent').focus(); return; }
      if (next.length < 12) { msg.textContent = 'Passwords need at least 12 characters.'; el('pwcNext').focus(); return; }
      if (next !== confirm) { msg.textContent = 'The two new passwords don’t match.'; el('pwcConfirm').focus(); return; }
      var btn = el('pwcSave'); btn.disabled = true; msg.textContent = '';
      fetch('/api/portal/password', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: current, next: next }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (r.status === 401) { location.replace('/login'); return; }
          if (!r.ok) {
            msg.textContent = b.error || 'Couldn’t change the password.';
            if (b.field === 'current' && opts.current != null) { // pre-filled one was wrong: ask for it
              opts.current = null; el('pwcCurrentWrap').hidden = false; el('pwcCurrent').focus();
            } else if (b.field) (b.field === 'current' ? el('pwcCurrent') : el('pwcNext')).focus();
            return;
          }
          form.reset(); dlg.close();
          var done = opts.done; opts = {};
          if (done) done(); else toast('Password changed');
        });
      }).catch(function () { msg.textContent = 'Couldn’t reach the server. Please try again.'; })
        .then(function () { btn.disabled = false; });
    });
  }

  function toast(text) {
    var t = document.createElement('div');
    t.className = 'pwc-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('on'); });
    setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  function open(o) {
    build();
    opts = o || {};
    form.reset(); el('pwcMsg').textContent = '';
    dlg.querySelector('.pwc-meter span').style.width = '0';
    ['pwcCurrent', 'pwcNext', 'pwcConfirm'].forEach(function (id) { el(id).type = 'password'; });
    el('pwcTitle').textContent = opts.forced ? 'Choose your password' : 'Change password';
    el('pwcIntro').textContent = opts.forced
      ? 'You signed in with a password someone else set. Choose your own to continue. Only you will know it.'
      : 'Choose a new password. You’ll stay signed in here and be signed out everywhere else.';
    el('pwcCurrentWrap').hidden = opts.current != null;
    dlg.querySelectorAll('[data-pwc-close]').forEach(function (b) { b.hidden = !!opts.forced; });
    el('pwcSave').textContent = opts.forced ? 'Save and continue' : 'Save password';
    if (!dlg.open) dlg.showModal();
    (opts.current != null ? el('pwcNext') : el('pwcCurrent')).focus();
  }

  window.JediPassword = { open: open };

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#changePw')) open();
  });
})();
