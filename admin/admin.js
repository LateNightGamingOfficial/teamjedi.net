/* JEDI admin site: accounts, setup status and activity. */
(function () {
  'use strict';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var SECTION_LABEL = { traffic: 'Visitors', engagement: 'Reading', sources: 'Audience' };

  var state = { users: [], storage: true, me: null, filter: 'all', q: '', editing: null, status: null };

  // ---------- api ----------
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { location.replace('/login'); throw { silent: true }; }
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 403 && b.mustChange && window.JediPassword) {
          if (!api._forced) { api._forced = true; window.JediPassword.open({ forced: true, done: function () { location.reload(); } }); }
          throw { silent: true };
        }
        if (!r.ok) throw new Error(b.error || 'Something went wrong.');
        return b;
      });
    });
  }
  function post(body) { return api('/api/admin/users', { method: 'POST', body: body }); }

  function toast(msg) {
    var t = $('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast', role: 'status' }));
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function when(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso), diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' d ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function stamp(iso) {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---------- tabs ----------
  function showTab(name) {
    $$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    $$('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    if (name !== 'accounts') loadStatus();
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  // ---------- accounts ----------
  function loadUsers() {
    return api('/api/admin/users').then(function (d) {
      state.users = d.users; state.storage = d.storage;
      renderBanner(); renderUsers();
    }).catch(showError);
  }
  function renderBanner() {
    $('#banner').innerHTML = state.storage ? '' :
      '<div class="notice"><b>Account storage isn’t connected.</b> You can see accounts from Vercel’s PORTAL_USERS setting, but can’t add or change any until storage is set up. See the Setup tab.</div>';
    $('#addBtn').disabled = !state.storage;
  }
  function matches(u) {
    if (state.filter === 'admin' && !u.admin) return false;
    if (state.filter === 'client' && u.admin) return false;
    if (state.filter === 'off' && !u.disabled) return false;
    if (!state.q) return true;
    return (u.name + ' ' + u.email + ' ' + u.org).toLowerCase().indexOf(state.q) > -1;
  }
  function renderUsers() {
    var all = state.users, list = all.filter(matches);
    var admins = all.filter(function (u) { return u.admin; }).length, off = all.filter(function (u) { return u.disabled; }).length;
    $('#acctSummary').innerHTML = '<b>' + all.length + '</b> account' + (all.length === 1 ? '' : 's') + ': ' +
      admins + ' admin' + (admins === 1 ? '' : 's') + ', ' + (all.length - admins) + ' client' + (all.length - admins === 1 ? '' : 's') +
      (off ? ', ' + off + ' switched off' : '') + '.';
    var rows = list.map(function (u) {
      var sections = u.sections.map(function (s) { return '<span class="chip">' + esc(SECTION_LABEL[s] || s) + '</span>'; }).join('');
      return '<tr data-email="' + esc(u.email) + '" tabindex="0">' +
        '<td class="who"><b>' + esc(u.name) + '</b><span>' + esc(u.org || '—') + '</span></td>' +
        '<td class="mono-cell" data-label="Email">' + esc(u.email) + '</td>' +
        '<td data-label="Can see">' + sections + '</td>' +
        '<td data-label="Role">' + (u.admin ? '<span class="chip admin">Admin</span>' : '<span class="chip">Client</span>') +
          (u.source === 'env' ? '<span class="chip env" title="Set in Vercel PORTAL_USERS">Vercel</span>' : '') + '</td>' +
        '<td data-label="Status">' + (u.disabled ? '<span class="chip off">Off</span>' : '<span class="chip on">Active</span>') +
          (u.mustChange && !u.disabled ? '<span class="chip env" title="Signed in with a temporary password; will choose their own next time">New password due</span>' : '') + '</td>' +
        '<td class="muted" data-label="Last sign-in">' + esc(when(u.lastLogin)) + '</td>' +
        '<td><button type="button" class="edit-link">Edit</button></td></tr>';
    }).join('');
    $('#acctTable').innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Can see</th><th>Role</th><th>Status</th><th>Last sign-in</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      (rows || '<tr><td class="empty" colspan="7">' + (all.length ? 'No accounts match.' : 'No accounts yet. Add the first one.') + '</td></tr>') + '</tbody>';
    $$('#acctTable tbody tr[data-email]').forEach(function (tr) {
      var open = function () { openEditor(tr.dataset.email); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
    });
  }
  $('#search').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); renderUsers(); });
  $$('.filter-row .range button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filter = b.dataset.filter;
      $$('.filter-row .range button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      renderUsers();
    });
  });

  // ---------- editor dialog ----------
  var dlg = $('#acctDialog'), form = $('#acctForm'), msg = $('#dlgMsg');
  function setMsg(t, ok) { msg.textContent = t || ''; msg.className = 'form-msg' + (ok ? ' ok' : ''); }
  function openEditor(email) {
    var u = email ? state.users.find(function (x) { return x.email === email; }) : null;
    state.editing = u;
    form.reset(); setMsg(''); hideConfirm();
    $('#dlgTitle').textContent = u ? 'Edit account' : 'Add account';
    $('#saveBtn').textContent = u ? 'Save changes' : 'Create account';
    $('#fEmail').readOnly = !!u;
    $('#pwField').hidden = !!u;
    $('#fPassword').hidden = true;
    $('#manage').hidden = !u;
    $('#envNote').hidden = !(u && u.source === 'env');
    if (u) {
      form.name.value = u.name; form.org.value = u.org || ''; form.email.value = u.email;
      $$('input[name="sections"]', form).forEach(function (c) { c.checked = u.sections.indexOf(c.value) > -1; });
      $('#fAdmin').checked = !!u.admin;
      var isMe = state.me && u.email === state.me.email;
      $('#fAdmin').disabled = isMe;
      $('#lastInfo').textContent = 'Last sign-in: ' + when(u.lastLogin) + (u.createdAt ? ' · Added ' + when(u.createdAt) + (u.createdBy ? ' by ' + u.createdBy : '') : '');
      var tgl = $('[data-act="toggle"]', form);
      tgl.textContent = u.disabled ? 'Switch on' : 'Switch off';
      tgl.disabled = isMe; $('[data-act="delete"]', form).disabled = isMe;
    } else {
      $('#fAdmin').disabled = false;
    }
    $$('button, input', form).forEach(function (el) { if (!state.storage && el.type !== 'button' || !state.storage && el.dataset.act) el.disabled = true; });
    $('#saveBtn').disabled = !state.storage;
    dlg.showModal();
    (u ? form.name : form.name).focus();
  }
  $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
  $$('input[name="pwMode"]', form).forEach(function (r) {
    r.addEventListener('change', function () { $('#fPassword').hidden = form.pwMode.value !== 'set'; if (!$('#fPassword').hidden) $('#fPassword').focus(); });
  });
  $('#addBtn').addEventListener('click', function () { openEditor(null); });

  function chosenSections() { return $$('input[name="sections"]:checked', form).map(function (c) { return c.value; }); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var u = state.editing, sections = chosenSections();
    if (!form.name.value.trim()) return setMsg('Enter a name.');
    if (!u && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) return setMsg('Enter a valid email address.');
    if (!sections.length) return setMsg('Pick at least one thing they can see.');
    var body = { action: u ? 'update' : 'create', email: u ? u.email : form.email.value.trim(), name: form.name.value.trim(),
      org: form.org.value.trim(), sections: sections, admin: $('#fAdmin').checked };
    if (!u && form.pwMode.value === 'set') {
      if (form.password.value.length < 12) return setMsg('Passwords need at least 12 characters.');
      body.password = form.password.value;
    }
    $('#saveBtn').disabled = true; setMsg('Saving…', true);
    post(body).then(function (r) {
      dlg.close();
      return loadUsers().then(function () {
        if (r.password) showPassword(r.user, r.password, 'Account created for ' + r.user.name + '. Temporary password:');
        else toast(u ? 'Changes saved' : 'Account created');
      });
    }).catch(function (err) { if (!err.silent) setMsg(err.message); })
      .then(function () { $('#saveBtn').disabled = !state.storage; });
  });

  // manage actions with an inline confirm step
  var pending = null;
  function hideConfirm() { $('#confirmBox').hidden = true; pending = null; }
  $('#confirmNo').addEventListener('click', hideConfirm);
  $$('[data-act]', form).forEach(function (b) {
    b.addEventListener('click', function () {
      var u = state.editing; if (!u) return;
      var act = b.dataset.act, text;
      if (act === 'reset-password') text = (state.me && u.email === state.me.email)
        ? 'Reset your own password? You’ll get a new one and sign in again with it. (To pick your own, use the Password button at the top instead.)'
        : 'Reset ' + u.name + '’s password? They’ll be signed out, get a temporary password from you, and choose their own when they next sign in.';
      if (act === 'signout') text = 'Sign ' + u.name + ' out on every device?';
      if (act === 'toggle') text = u.disabled ? 'Switch ' + u.name + '’s account back on?' : 'Switch off ' + u.name + '’s account? They’ll be signed out and can’t sign in until it’s switched back on.';
      if (act === 'delete') text = 'Delete ' + u.name + '’s account for good? This can’t be undone.';
      pending = act; $('#confirmText').textContent = text; $('#confirmBox').hidden = false; $('#confirmYes').focus();
    });
  });
  $('#confirmYes').addEventListener('click', function () {
    var u = state.editing, act = pending; if (!u || !act) return;
    var body = act === 'toggle' ? { action: 'update', email: u.email, disabled: !u.disabled } : { action: act, email: u.email };
    $('#confirmYes').disabled = true;
    post(body).then(function (r) {
      dlg.close(); hideConfirm();
      if (r.signedOutSelf) {
        if (r.password) { pwDlg.dataset.thenLogin = '1'; showPassword(u, r.password, 'Your new password. You’ll sign in again with it after closing this.'); }
        else location.replace('/login');
        return;
      }
      return loadUsers().then(function () {
        if (r.password) showPassword(u, r.password, 'Temporary password for ' + u.name + '.');
        else toast({ signout: 'Signed out everywhere', toggle: u.disabled ? 'Account switched on' : 'Account switched off', delete: 'Account deleted' }[act] || 'Done');
      });
    }).catch(function (err) { if (!err.silent) setMsg(err.message); })
      .then(function () { $('#confirmYes').disabled = false; });
  });

  // one-time password reveal
  var pwDlg = $('#pwDialog');
  function showPassword(user, pw, intro) {
    $('#pwIntro').textContent = intro + ' Their sign-in email is ' + user.email + '.';
    $('#pwValue').textContent = pw;
    pwDlg.showModal();
  }
  $('#copyPw').addEventListener('click', function () {
    var v = $('#pwValue').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Password copied'); }, function () {
      var r = document.createRange(); r.selectNodeContents($('#pwValue')); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      toast('Press Ctrl/Cmd+C to copy');
    });
  });
  $('#pwDone').addEventListener('click', function () {
    $('#pwValue').textContent = ''; pwDlg.close();
    if (pwDlg.dataset.thenLogin) location.replace('/login');
  });
  pwDlg.addEventListener('cancel', function (e) { if (pwDlg.dataset.thenLogin) { e.preventDefault(); return; } $('#pwValue').textContent = ''; });

  // ---------- setup & activity ----------
  function loadStatus(testGa) {
    return api('/api/admin/status' + (testGa ? '?test=ga' : '')).then(function (d) {
      state.status = d; state.me = d.me;
      renderWho(); renderSetup(d); renderActivity(d.activity);
      return d;
    }).catch(showError);
  }
  function renderWho() {
    if (state.me) $('#who').innerHTML = '<b>' + esc(state.me.name) + '</b>' + esc(state.me.email);
  }
  function item(ok, title, desc, extra, kind) {
    var cls = kind || (ok ? 'ok' : 'no');
    return '<li class="' + cls + '"><span class="ico" aria-hidden="true">' + (cls === 'ok' ? '✓' : cls === 'info' ? 'i' : '!') + '</span>' +
      '<div><b>' + esc(title) + '</b>' + (kind ? '' : '<span class="state">' + (ok ? 'Done' : 'Needs setup') + '</span>') + '</div>' +
      '<p>' + desc + '</p>' + (extra || '') + '</li>';
  }
  function renderSetup(d) {
    var c = d.checks;
    var gaTest = '<div class="test"><button type="button" class="btn-ghost" id="testGa"' + (c.gaApi ? '' : ' disabled') + '>Test connection</button>' +
      '<span class="test-msg" id="gaTestMsg">' + (d.gaTest ? esc(d.gaTest.message) : '') + '</span></div>';
    $('#checklist').innerHTML =
      item(c.secret, 'Sign-in secret', c.secret ? 'PORTAL_SECRET is set, so sign-ins are protected.' : 'Add <code>PORTAL_SECRET</code> (32+ random characters) in Vercel → Settings → Environment Variables.') +
      item(c.storage, 'Account storage', c.storage ? 'Upstash Redis is connected. Accounts you add here are saved.' : 'In Vercel → Storage, create an <b>Upstash for Redis</b> database and connect it to this project, then redeploy.') +
      item(c.gaApi, 'Google Analytics data', c.gaApi ? 'Service account connected to property ' + esc(c.gaProperty) + '.' : 'Add <code>GA4_PROPERTY_ID</code> and <code>GA_SERVICE_ACCOUNT_JSON</code> in Vercel. Until then the analytics site shows sample data.', gaTest) +
      item(false, 'Custom dimensions in Google Analytics', 'One-time: in GA → Admin → Custom definitions, add event-scoped dimensions <code>section</code> and <code>percent</code>. They power “What people read”. (This can’t be checked from here.)', '', 'info');
    $('#tracking').innerHTML = '<dt>Google Analytics</dt><dd>' + esc(d.tracking.ga4) + '</dd><dt>Clarity</dt><dd>' + esc(d.tracking.clarity) + '</dd>' +
      '<dt>Analytics site</dt><dd><a href="' + esc(d.analyticsUrl) + '">' + esc(d.analyticsUrl.replace(/^https?:\/\//, '')) + '</a></dd>';
    $('#links').innerHTML = '<a class="btn-ghost" target="_blank" rel="noopener" href="' + esc(d.links.ga) + '">Google Analytics</a>' +
      '<a class="btn-ghost" target="_blank" rel="noopener" href="' + esc(d.links.clarity) + '">Clarity</a>' +
      '<a class="btn-ghost" target="_blank" rel="noopener" href="' + esc(d.links.vercel) + '">Vercel</a>';
    var t = $('#testGa');
    if (t) t.addEventListener('click', function () {
      t.disabled = true; $('#gaTestMsg').textContent = 'Testing…';
      loadStatus(true).then(function () { var b = $('#testGa'); if (b) b.disabled = false; });
    });
  }
  function renderActivity(list) {
    $('#activity').innerHTML = (list || []).length ? list.map(function (a) {
      return '<li><time datetime="' + esc(a.at) + '">' + esc(stamp(a.at)) + '</time><div><b>' + esc(a.actor) + '</b> ' + esc(a.action) +
        (a.target && a.target !== a.actor ? ' <span class="mono-cell">' + esc(a.target) + '</span>' : '') + '</div>' +
        (a.detail ? '<div class="detail">' + esc(a.detail) + '</div>' : '') + '</li>';
    }).join('') : '<li class="muted">No activity recorded yet' + (state.storage ? '.' : ' (needs account storage).') + '</li>';
  }

  function showError(err) {
    if (err && err.silent) return;
    $('#banner').innerHTML = '<div class="error-box">' + esc((err && err.message) || 'Something went wrong.') + '</div>';
  }

  $('#signOut').addEventListener('click', function () {
    fetch('/api/portal/logout', { method: 'POST', credentials: 'same-origin' }).then(function () { location.replace('/login'); });
  });

  // ---------- start ----------
  var start = (location.hash || '').replace('#', '');
  Promise.all([loadStatus(), loadUsers()]).then(function () {
    if (['setup', 'activity'].indexOf(start) > -1) showTab(start);
  });
})();
