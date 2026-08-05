/* ============================================================
   BENLEO VERLAG — shared site runtime
   nav/footer injection · DE/EN i18n · API client · auth ·
   products/events from API · submission form (upload) · profile
   Backend: same-origin /api (Express local, later API Gateway/Lambda)
============================================================ */
(function () {
  'use strict';

  const API = location.origin + '/api';
  const state = {
    lang: 'de',
    token: localStorage.getItem('benleo_token') || '',
    user: null,
    content: {},
    products: [],
    events: [],
    plugins: {},
  };

  /* ---------------- helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tr = obj => (obj && typeof obj === 'object') ? (obj[state.lang] || obj.de || obj.en || '') : (obj || '');
  function hash(str) { let h = 5381; str = String(str); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); }
  function snippet(html, n = 48) { const t = String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }

  async function api(path, { method = 'GET', body, form } = {}) {
    const opt = { method, headers: {} };
    if (state.token) opt.headers.Authorization = 'Bearer ' + state.token;
    if (form) opt.body = form;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(API + path, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Fehler ' + res.status));
    return data;
  }

  // Direct upload to a presigned URL (S3 in prod, local endpoint in dev) with progress.
  function putWithProgress(url, file, bar) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = ev => { if (bar && ev.lengthComputable) bar.style.width = Math.round(ev.loaded / ev.total * 100) + '%'; };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('Upload fehlgeschlagen (' + xhr.status + ')'));
      xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
      xhr.send(file);
    });
  }

  function toast(msg, isErr) {
    let host = $('#toast'); if (!host) { host = document.createElement('div'); host.id = 'toast'; document.body.appendChild(host); }
    const t = document.createElement('div'); t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg;
    host.appendChild(t); setTimeout(() => t.remove(), 3400);
  }

  /* ---------------- i18n dictionary ---------------- */
  const T = {
    'nav.start':   { de: 'Start', en: 'Home' },
    'nav.about':   { de: 'Über uns', en: 'About' },
    'nav.programm':{ de: 'Programm & Projekte', en: 'Programme & Projects' },
    'nav.events':  { de: 'Kulturveranstaltungen', en: 'Cultural Events' },
    'nav.join':    { de: 'Teil werden', en: 'Get Involved' },
    'nav.press':   { de: 'Presse', en: 'Press' },
    'nav.account': { de: 'Konto', en: 'Account' },

    'footer.brand': { de: 'Wo Worte zu Welten werden. 2026 gehen wir mit unserem seit 1996 existierenden Verlag mit einem vollständig neuen Konzept an den Start und verlegen und produzieren Literatur, Musik und Kunst mit Leidenschaft und Haltung.', en: 'Where words become worlds. In 2026 our publishing house — in existence since 1996 — launches with a completely new concept, publishing and producing literature, music and art with passion and conviction.' },
    'footer.col.verlag': { de: 'Verlag', en: 'Publisher' },
    'footer.col.programm': { de: 'Bereiche', en: 'Areas' },
    'footer.col.contact': { de: 'Kontakt', en: 'Contact' },
    'footer.imprint': { de: 'Impressum', en: 'Imprint' },
    'footer.privacy': { de: 'Datenschutz', en: 'Privacy' },
    'footer.terms': { de: 'AGB', en: 'Terms' },
    'footer.copyright': { de: '© 2026 BENLEO VERLAG. Alle Rechte vorbehalten.', en: '© 2026 BENLEO VERLAG. All rights reserved.' },
    'footer.made': { de: 'Gestaltet mit Sorgfalt und Leidenschaft.', en: 'Designed with care and passion.' },

    'auth.login': { de: 'Anmelden', en: 'Sign in' },
    'auth.register': { de: 'Registrieren', en: 'Register' },
    'auth.email': { de: 'E-Mail', en: 'Email' },
    'auth.password': { de: 'Passwort', en: 'Password' },
    'auth.name': { de: 'Name', en: 'Name' },
    'auth.loginTitle': { de: 'Willkommen zurück', en: 'Welcome back' },
    'auth.registerTitle': { de: 'Konto erstellen', en: 'Create account' },
    'auth.loginSub': { de: 'Melde dich an, um deine Einreichungen zu sehen.', en: 'Sign in to see your submissions.' },
    'auth.registerSub': { de: 'Erstelle ein Konto beim Benleo Verlag.', en: 'Create an account with Benleo Verlag.' },
    'auth.toRegister': { de: 'Noch kein Konto? Registrieren', en: 'No account yet? Register' },
    'auth.toLogin': { de: 'Schon ein Konto? Anmelden', en: 'Already have an account? Sign in' },
    'auth.logout': { de: 'Abmelden', en: 'Sign out' },

    'common.comingSoon': { de: 'Coming soon', en: 'Coming soon' },
    'common.readMore': { de: 'Mehr erfahren', en: 'Learn more' },
  };
  function t(key) { return T[key] ? tr(T[key]) : key; }

  /* ---------------- language ---------------- */
  function detectLang() {
    const saved = localStorage.getItem('benleo-lang');
    if (saved === 'de' || saved === 'en') return saved;
    return (navigator.language || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
  }
  function applyLang(lang) {
    state.lang = lang;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('data-lang', lang);
    localStorage.setItem('benleo-lang', lang);
    // static data-i18n nodes (dictionary keys)
    $$('[data-i18n]').forEach(el => {
      const v = T[el.dataset.i18n]; if (v) el.innerHTML = tr(v);
    });
    $$('[data-i18n-ph]').forEach(el => { const v = T[el.dataset.i18nPh]; if (v) el.setAttribute('placeholder', tr(v)); });
    // Editable text: every [data-en] / [data-cms] element is a CMS field.
    // Key = explicit data-cms, else a stable page+hash key. Admin override wins.
    const pageId = document.body.dataset.page || (location.pathname.split('/').pop() || 'index').replace('.html', '') || 'index';
    $$('[data-en],[data-cms]').forEach(el => {
      if (el.dataset.cmsDe === undefined) { el.dataset.cmsDe = el.innerHTML; el.dataset.cmsEn = el.dataset.en != null ? el.dataset.en : el.innerHTML; }
      if (!el.dataset.cmsKey) el.dataset.cmsKey = el.dataset.cms || (pageId + '.' + hash(el.dataset.cmsDe));
      const ov = state.content[el.dataset.cmsKey];
      const de = (ov && ov.de) ? ov.de : el.dataset.cmsDe;
      const en = (ov && ov.en) ? ov.en : el.dataset.cmsEn;
      el.innerHTML = lang === 'en' ? en : de;
    });
    // CMS images: admin-uploaded override wins
    $$('[data-cms-img]').forEach(el => {
      if (el.dataset.cmsImgDefault === undefined) el.dataset.cmsImgDefault = el.getAttribute('src') || '';
      const ov = state.content[el.dataset.cmsImg];
      el.setAttribute('src', (ov && ov.img) ? ov.img : el.dataset.cmsImgDefault);
    });
    // CMS background images (hero etc.)
    $$('[data-cms-bg]').forEach(el => {
      if (el.dataset.cmsBgDefault === undefined) {
        const m = (getComputedStyle(el).backgroundImage || '').match(/url\(["']?(.*?)["']?\)/);
        el.dataset.cmsBgDefault = m ? m[1] : '';
      }
      const ov = state.content[el.dataset.cmsBg];
      const url = (ov && ov.img) ? ov.img : el.dataset.cmsBgDefault;
      if (url) el.style.backgroundImage = `url("${url}")`;
    });
    // page-local placeholders: German authored, English via data-en-ph
    $$('[data-en-ph]').forEach(el => {
      if (el.dataset.dePh === undefined) el.dataset.dePh = el.getAttribute('placeholder') || '';
      el.setAttribute('placeholder', lang === 'en' ? el.dataset.enPh : el.dataset.dePh);
    });
    // CMS content bindings
    $$('[data-content]').forEach(el => { const c = state.content[el.dataset.content]; if (c) el.innerHTML = esc(tr(c)); });
    // lang buttons
    $$('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.langSet === lang));
    // dynamic re-render
    renderProducts(); renderEvents(); renderProfile(); activatePlugins();
    if (window.lucide) lucide.createIcons();
  }

  /* ---------------- nav + footer ---------------- */
  const NAVLINKS = [
    { page: 'start', href: 'index.html', key: 'nav.start' },
    { page: 'about', href: 'ueber-uns.html', key: 'nav.about' },
    { page: 'programm', href: 'programm.html', key: 'nav.programm' },
    { page: 'events', href: 'veranstaltungen.html', key: 'nav.events' },
    { page: 'press', href: 'presse.html', key: 'nav.press' },
  ];
  function buildNav() {
    const host = $('[data-site-nav]'); if (!host) return;
    const current = document.body.dataset.page || '';
    const links = NAVLINKS.map(l => `<li><a href="${l.href}" data-i18n="${l.key}" class="${l.page === current ? 'current' : ''}">${t(l.key)}</a></li>`).join('');
    const langToggle = `<div class="lang-toggle" role="group" aria-label="Sprache / Language">
        <button type="button" class="lang-btn" data-lang-set="de">DE</button>
        <button type="button" class="lang-btn" data-lang-set="en">EN</button></div>`;
    host.innerHTML = `
      <nav id="nav">
        <a href="index.html" class="nav-logo"><img src="logo-wide.png" alt="BENLEO VERLAG"></a>
        <ul class="nav-links">
          ${links}
          <li><a href="teil-werden.html" class="nav-cta ${current === 'join' ? 'current' : ''}" data-i18n="nav.join">${t('nav.join')}</a></li>
        </ul>
        <div class="nav-right">
          <button class="icon-btn" id="acctBtn" aria-label="Konto"><i data-lucide="user"></i></button>
          ${langToggle}
          <button class="nav-burger" id="navBurger" aria-label="Menü"><span></span><span></span><span></span></button>
        </div>
      </nav>
      <div class="nav-mobile" id="navMobile">
        ${NAVLINKS.map(l => `<a href="${l.href}" data-i18n="${l.key}">${t(l.key)}</a>`).join('')}
        <a href="teil-werden.html" data-i18n="nav.join">${t('nav.join')}</a>
        <a href="#" id="acctBtnM" data-i18n="nav.account">${t('nav.account')}</a>
        ${langToggle}
      </div>`;
    // wire
    $$('.lang-btn').forEach(b => b.addEventListener('click', () => applyLang(b.dataset.langSet)));
    const burger = $('#navBurger'), mob = $('#navMobile');
    burger.addEventListener('click', () => {
      const open = mob.classList.toggle('open'); burger.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $$('#navMobile a').forEach(a => a.addEventListener('click', () => { mob.classList.remove('open'); burger.classList.remove('open'); document.body.style.overflow = ''; }));
    $('#acctBtn').addEventListener('click', onAccountClick);
    const am = $('#acctBtnM'); if (am) am.addEventListener('click', e => { e.preventDefault(); onAccountClick(); });
    // scroll pin
    const nav = $('#nav');
    const onScroll = () => nav.classList.toggle('pinned', window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  function buildFooter() {
    const host = $('[data-site-footer]'); if (!host) return;
    host.innerHTML = `
      <footer>
        <div class="footer-grid">
          <div class="footer-brand">
            <img src="PHOTO-2026-05-22-11-46-06.jpg" data-cms-img="footer.logo" data-cms-page="global" data-cms-label="Footer-Logo" alt="BENLEO VERLAG">
            <p data-cms="footer.brand" data-cms-page="global" data-cms-label="Footer-Text" data-en="Where words become worlds. In 2026 our publishing house — in existence since 1996 — launches with a completely new concept, publishing and producing literature, music and art with passion and conviction.">Wo Worte zu Welten werden. 2026 gehen wir mit unserem seit 1996 existierenden Verlag mit einem vollständig neuen Konzept an den Start und verlegen und produzieren Literatur, Musik und Kunst mit Leidenschaft und Haltung.</p>
          </div>
          <div class="footer-col">
            <h4 data-cms="footer.col.verlag" data-cms-page="global" data-cms-label="Footer-Spalte 1" data-en="Publisher">Verlag</h4>
            <ul>
              <li><a href="ueber-uns.html" data-i18n="nav.about">${t('nav.about')}</a></li>
              <li><a href="team.html">Team</a></li>
              <li><a href="presse.html" data-i18n="nav.press">${t('nav.press')}</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4 data-cms="footer.col.programm" data-cms-page="global" data-cms-label="Footer-Spalte 2" data-en="Areas">Bereiche</h4>
            <ul>
              <li><a href="programm.html" data-i18n="nav.programm">${t('nav.programm')}</a></li>
              <li><a href="veranstaltungen.html" data-i18n="nav.events">${t('nav.events')}</a></li>
              <li><a href="teil-werden.html" data-i18n="nav.join">${t('nav.join')}</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4 data-cms="footer.col.contact" data-cms-page="global" data-cms-label="Footer-Spalte 3" data-en="Contact">Kontakt</h4>
            <ul>
              <li><a href="mailto:post@benleo-verlag.de">post@benleo-verlag.de</a></li>
              <li><a href="impressum.html" data-i18n="footer.imprint">${t('footer.imprint')}</a></li>
              <li><a href="datenschutz.html" data-i18n="footer.privacy">${t('footer.privacy')}</a></li>
              <li><a href="agb.html" data-i18n="footer.terms">${t('footer.terms')}</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p data-cms="footer.copyright" data-cms-page="global" data-cms-label="Copyright" data-en="© 2026 BENLEO VERLAG. All rights reserved.">© 2026 BENLEO VERLAG. Alle Rechte vorbehalten.</p>
          <p data-cms="footer.made" data-cms-page="global" data-cms-label="Footer-Claim" data-en="Designed with care and passion.">Gestaltet mit Sorgfalt und Leidenschaft.</p>
        </div>
      </footer>`;
  }

  /* ---------------- auth ---------------- */
  function onAccountClick() {
    if (state.user) { location.href = 'profil.html'; }
    else openAuth('login');
  }
  function ensureModal() {
    if ($('#authModalBg')) return;
    const bg = document.createElement('div');
    bg.className = 'modal-bg'; bg.id = 'authModalBg';
    bg.innerHTML = `<div class="modal" id="authModal" style="position:relative"></div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target.id === 'authModalBg') closeAuth(); });
  }
  function openAuth(mode) {
    ensureModal();
    const m = $('#authModal');
    const isLogin = mode !== 'register';
    m.innerHTML = `
      <button class="modal-close" id="authClose">&times;</button>
      <h3>${isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}</h3>
      <p class="msub">${isLogin ? t('auth.loginSub') : t('auth.registerSub')}</p>
      <form id="authForm">
        ${isLogin ? '' : `<div class="fg"><label>${t('auth.name')}</label><input id="au_name" autocomplete="name"></div>`}
        <div class="fg"><label>${t('auth.email')}</label><input type="email" id="au_email" required autocomplete="email"></div>
        <div class="fg"><label>${t('auth.password')}</label><input type="password" id="au_pass" required autocomplete="${isLogin ? 'current-password' : 'new-password'}"></div>
        <button class="btn btn-gold" type="submit">${isLogin ? t('auth.login') : t('auth.register')}</button>
      </form>
      <p class="modal-switch"><a id="authSwitch">${isLogin ? t('auth.toRegister') : t('auth.toLogin')}</a></p>`;
    $('#authModalBg').classList.add('open');
    $('#authClose').addEventListener('click', closeAuth);
    $('#authSwitch').addEventListener('click', () => openAuth(isLogin ? 'register' : 'login'));
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const payload = { email: $('#au_email').value, password: $('#au_pass').value };
        let r;
        if (isLogin) r = await api('/auth/login', { method: 'POST', body: payload });
        else { payload.name = ($('#au_name') || {}).value || ''; r = await api('/auth/register', { method: 'POST', body: payload }); }
        state.token = r.token; state.user = r.user; localStorage.setItem('benleo_token', state.token);
        closeAuth(); updateAccountUI(); renderProfile();
        toast(isLogin ? 'Angemeldet.' : 'Konto erstellt.');
      } catch (err) { toast(err.message, true); }
    });
    if (window.lucide) lucide.createIcons();
  }
  function closeAuth() { const bg = $('#authModalBg'); if (bg) bg.classList.remove('open'); }
  function logout() { state.token = ''; state.user = null; localStorage.removeItem('benleo_token'); updateAccountUI(); renderProfile(); toast('Abgemeldet.'); }
  async function refreshMe() {
    if (!state.token) return;
    try { const r = await api('/auth/me'); state.user = r.user; } catch (e) { state.token = ''; localStorage.removeItem('benleo_token'); }
  }
  function updateAccountUI() {
    const btn = $('#acctBtn'); if (btn) btn.innerHTML = state.user ? '<i data-lucide="user-check"></i>' : '<i data-lucide="user"></i>';
    if (window.lucide) lucide.createIcons();
  }

  /* ---------------- products / events ---------------- */
  async function loadData() {
    try { state.products = await api('/products'); } catch (e) {}
    try { state.events = await api('/events'); } catch (e) {}
    try { state.content = await api('/content'); } catch (e) {}
    try { state.plugins = await api('/plugins'); } catch (e) { state.plugins = {}; }
  }
  function productCard(p) {
    const soon = p.status === 'coming_soon';
    const cover = p.coverKey ? `<img src="${API}/media/${p.coverKey}" alt="">` : `<span class="ph">${esc((tr(p.title) || '?').slice(0, 1))}</span>`;
    return `<article class="prod-card">
      <div class="prod-cover">${cover}${soon ? `<span class="prod-soon">${t('common.comingSoon')}</span>` : ''}</div>
      <div class="prod-body">
        <span class="prod-type">${esc(p.type)}</span>
        <h3 class="prod-title ${p.blurName ? 'blur' : ''}">${esc(tr(p.title))}</h3>
        ${p.author ? `<span class="prod-author">${esc(p.author)}</span>` : ''}
        <p class="prod-desc">${esc(tr(p.description))}</p>
        ${p.amazonUrl ? `<div class="prod-foot"><a class="btn btn-ghost btn-sm" href="${esc(p.amazonUrl)}" target="_blank" rel="noopener">Amazon <i data-lucide="arrow-up-right"></i></a></div>` : ''}
      </div></article>`;
  }
  function renderProducts() {
    $$('[data-products]').forEach(host => {
      const list = state.products;
      host.innerHTML = list.length ? list.map(productCard).join('') : `<p class="muted center">—</p>`;
    });
    if (window.lucide) lucide.createIcons();
  }
  function eventCard(e) {
    const soon = e.status === 'coming_soon';
    return `<article class="ev-card">
      <div class="ev-kind">${esc(e.kind)}</div>
      <h3 class="ev-title">${esc(tr(e.title))}</h3>
      <div class="ev-meta">${e.location ? `<span><i data-lucide="map-pin"></i> ${esc(e.location)}</span>` : ''}${e.date ? `<span><i data-lucide="calendar"></i> ${esc(e.date)}</span>` : ''}${soon ? `<span class="badge-soon">${t('common.comingSoon')}</span>` : ''}</div>
      <p class="ev-desc">${esc(tr(e.description))}</p>
    </article>`;
  }
  function renderEvents() {
    $$('[data-events]').forEach(host => {
      const filter = host.dataset.events;
      const list = state.events.filter(e => !filter || filter === 'all' || e.kind === filter);
      host.innerHTML = list.length ? list.map(eventCard).join('') : `<p class="muted center">—</p>`;
    });
    if (window.lucide) lucide.createIcons();
  }

  /* ---------------- submission form ---------------- */
  function initForms() {
    const form = $('[data-submission-form]'); if (!form) return;
    const drop = $('.filedrop', form), fileInput = drop ? $('input[type=file]', drop) : null;
    const dropLabel = drop ? $('.filedrop-label', drop) : null;
    if (drop && fileInput) {
      drop.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        drop.classList.toggle('has', !!f);
        if (dropLabel) dropLabel.textContent = f ? `${f.name} — ${Math.round(f.size / 1024 / 1024 * 10) / 10} MB` : (state.lang === 'en' ? 'Choose a file (up to 200 MB)' : 'Datei wählen (bis 200 MB)');
      });
    }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('.form-msg', form), prog = $('.progress', form), bar = prog ? $('i', prog) : null;
      msg.className = 'form-msg';
      const data = {
        name: (form.querySelector('[name=name]') || {}).value || '',
        email: (form.querySelector('[name=email]') || {}).value || '',
        category: (form.querySelector('[name=category]') || {}).value || '',
        subject: (form.querySelector('[name=subject]') || {}).value || '',
        message: (form.querySelector('[name=message]') || {}).value || '',
      };
      const file = fileInput && fileInput.files[0];
      try {
        if (file) {
          // 1) get a presigned URL, 2) upload the file directly (progress), 3) submit metadata
          const pre = await api('/uploads/presign', { method: 'POST', body: { filename: file.name, contentType: file.type || 'application/octet-stream', kind: 'submission' } });
          if (prog) prog.classList.add('show');
          await putWithProgress(pre.url, file, bar);
          data.fileKey = pre.key; data.fileName = file.name; data.fileSize = file.size;
        }
        await api('/submissions', { method: 'POST', body: data });
        if (prog) prog.classList.remove('show');
        form.reset();
        if (drop) { drop.classList.remove('has'); if (dropLabel) dropLabel.textContent = state.lang === 'en' ? 'Choose a file (up to 200 MB)' : 'Datei wählen (bis 200 MB)'; }
        msg.className = 'form-msg ok show';
        msg.textContent = state.lang === 'en' ? 'Thank you! Your submission has arrived — we\'ll get back to you within 10 business days.' : 'Danke! Deine Einreichung ist angekommen — wir melden uns innerhalb von 10 Werktagen.';
      } catch (err) {
        if (prog) prog.classList.remove('show');
        msg.className = 'form-msg err show'; msg.textContent = err.message || 'Fehler';
      }
    });
  }

  /* ---------------- profile ("meine Einreichungen") ---------------- */
  async function renderProfile() {
    const host = $('[data-profile]'); if (!host) return;
    if (!state.user) {
      host.innerHTML = `<div class="acct-card center">
        <h3 class="serif" style="font-size:1.6rem;margin-bottom:.5rem">${state.lang === 'en' ? 'Your account' : 'Dein Konto'}</h3>
        <p class="muted" style="margin-bottom:1.5rem">${state.lang === 'en' ? 'Sign in to see your submissions.' : 'Melde dich an, um deine Einreichungen zu sehen.'}</p>
        <button class="btn btn-gold" id="pfLogin">${t('auth.login')}</button>
        <button class="btn btn-ghost" id="pfReg" style="margin-left:.5rem">${t('auth.register')}</button>
      </div>`;
      $('#pfLogin').addEventListener('click', () => openAuth('login'));
      $('#pfReg').addEventListener('click', () => openAuth('register'));
      return;
    }
    let mine = [];
    try { mine = await api('/submissions/mine'); } catch (e) {}
    host.innerHTML = `<div class="acct-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:.5rem">
        <div><h3 class="serif" style="font-size:1.6rem">${esc(state.user.name || state.user.email)}</h3><p class="muted" style="font-size:.8rem">${esc(state.user.email)}</p></div>
        <button class="btn btn-ghost btn-sm" id="pfLogout"><i data-lucide="log-out"></i> ${t('auth.logout')}</button>
      </div>
      <h4 class="label" style="margin-bottom:1rem">${state.lang === 'en' ? 'My submissions' : 'Meine Einreichungen'}</h4>
      ${mine.length ? mine.map(s => `<div class="sub-item">
        <div class="si-main"><div style="font-weight:600">${esc(s.subject || s.category)}</div>
          <div class="muted" style="font-size:.75rem">${esc(s.category)} · ${new Date(s.createdAt).toLocaleDateString('de-DE')}${s.fileName ? ' · 📎 ' + esc(s.fileName) : ''}</div></div>
        <span class="sub-status">${esc(s.status)}</span></div>`).join('')
        : `<p class="muted">${state.lang === 'en' ? 'No submissions yet.' : 'Noch keine Einreichungen.'}</p>`}
    </div>`;
    $('#pfLogout').addEventListener('click', logout);
    if (window.lucide) lucide.createIcons();
  }

  /* ---------------- plugins ---------------- */
  let analyticsInjected = false;
  function activatePlugins() {
    const p = state.plugins || {};
    renderAnnouncement(p.announcement);
    renderNewsletter(p.newsletter);
    renderCookie(p.cookie);
    injectAnalytics(p.analytics);
  }

  function renderAnnouncement(cfg) {
    const existing = $('#announceBar');
    if (!cfg || localStorage.getItem('benleo-announce-dismissed') === '1') {
      if (existing) existing.remove();
      document.documentElement.style.setProperty('--announce-h', '0px');
      return;
    }
    const msg = tr(cfg.message); if (!msg) { if (existing) existing.remove(); return; }
    const linkLabel = tr(cfg.linkLabel);
    const linkHtml = cfg.link ? ` <a href="${esc(cfg.link)}">${esc(linkLabel || 'Mehr')} <i data-lucide="arrow-right"></i></a>` : '';
    let bar = existing;
    if (!bar) { bar = document.createElement('div'); bar.id = 'announceBar'; document.body.prepend(bar); }
    bar.innerHTML = `<span>${esc(msg)}${linkHtml}</span><button class="ann-close" aria-label="schließen">&times;</button>`;
    bar.querySelector('.ann-close').addEventListener('click', () => {
      localStorage.setItem('benleo-announce-dismissed', '1'); bar.remove();
      document.documentElement.style.setProperty('--announce-h', '0px');
    });
    document.documentElement.style.setProperty('--announce-h', bar.offsetHeight + 'px');
    if (window.lucide) lucide.createIcons();
  }

  function renderCookie(cfg) {
    const existing = $('#cookieBar');
    if (!cfg || localStorage.getItem('benleo-cookie-ok') === '1') { if (existing) existing.remove(); return; }
    let bar = existing;
    if (!bar) { bar = document.createElement('div'); bar.id = 'cookieBar'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>${esc(tr(cfg.text))}</span><button class="btn btn-gold btn-sm" id="cookieOk">${esc(tr(cfg.acceptLabel) || 'OK')}</button>`;
    bar.querySelector('#cookieOk').addEventListener('click', () => { localStorage.setItem('benleo-cookie-ok', '1'); bar.remove(); });
  }

  function renderNewsletter(cfg) {
    const foot = $('[data-site-footer]');
    const existing = $('#newsletterBlock');
    if (!cfg) { if (existing) existing.remove(); return; }
    let block = existing;
    if (!block) { block = document.createElement('section'); block.id = 'newsletterBlock'; block.className = 'block bg-deep'; if (foot) foot.parentNode.insertBefore(block, foot); else document.body.appendChild(block); }
    block.innerHTML = `<div class="narrow center nl-inner">
        <p class="label">Newsletter</p>
        <h2 class="serif" style="font-size:2rem;margin:.5rem 0 .75rem;color:var(--white)">${esc(tr(cfg.heading))}</h2>
        <p class="muted" style="font-weight:300;line-height:1.8;margin-bottom:1.5rem">${esc(tr(cfg.text))}</p>
        <form class="nl-form" id="nlForm">
          <input type="email" required placeholder="${state.lang === 'en' ? 'your@email.com' : 'deine@email.de'}" id="nlEmail">
          <button class="btn btn-gold" type="submit">${state.lang === 'en' ? 'Subscribe' : 'Anmelden'}</button>
        </form>
        <p class="nl-msg muted" style="margin-top:.75rem;font-size:.8rem"></p>
      </div>`;
    block.querySelector('#nlForm').addEventListener('submit', async e => {
      e.preventDefault();
      const m = block.querySelector('.nl-msg');
      try {
        await api('/plugins/newsletter/subscribe', { method: 'POST', body: { email: block.querySelector('#nlEmail').value } });
        block.querySelector('#nlForm').reset();
        m.textContent = state.lang === 'en' ? 'Thanks — you\'re subscribed!' : 'Danke — du bist angemeldet!';
      } catch (err) { m.textContent = err.message; }
    });
  }

  function injectAnalytics(cfg) {
    if (analyticsInjected || !cfg || !cfg.siteId) return;
    analyticsInjected = true;
    if (cfg.provider === 'google') {
      const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.siteId); document.head.appendChild(s);
      const i = document.createElement('script'); i.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${cfg.siteId}');`; document.head.appendChild(i);
    } else {
      const s = document.createElement('script'); s.async = true; s.defer = true; s.src = cfg.scriptUrl || 'https://analytics.umami.is/script.js'; s.setAttribute('data-website-id', cfg.siteId); document.head.appendChild(s);
    }
  }

  /* ---------------- CMS field registration ---------------- */
  async function registerFields() {
    const page = document.body.dataset.page || (location.pathname.split('/').pop() || 'index').replace('.html', '') || 'index';
    const fields = [];
    $$('[data-en],[data-cms]').forEach(el => {
      if (!el.dataset.cmsKey) return; // set during applyLang
      fields.push({
        key: el.dataset.cmsKey, page: el.dataset.cmsPage || page, label: el.dataset.cmsLabel || snippet(el.dataset.cmsDe || el.innerHTML), type: 'text',
        default: { de: el.dataset.cmsDe || '', en: el.dataset.cmsEn || '' },
      });
    });
    $$('[data-cms-img]').forEach(el => fields.push({
      key: el.dataset.cmsImg, page: el.dataset.cmsPage || page, label: el.dataset.cmsLabel || ('Bild: ' + el.dataset.cmsImg), type: 'image',
      default: { de: el.dataset.cmsImgDefault != null ? el.dataset.cmsImgDefault : (el.getAttribute('src') || ''), en: '' },
    }));
    $$('[data-cms-bg]').forEach(el => fields.push({
      key: el.dataset.cmsBg, page: el.dataset.cmsPage || page, label: el.dataset.cmsLabel || ('Hintergrundbild: ' + el.dataset.cmsBg), type: 'image',
      default: { de: el.dataset.cmsBgDefault || '', en: '' },
    }));
    if (fields.length) { try { await api('/content/register', { method: 'POST', body: { fields } }); } catch (e) {} }
  }

  /* ---------------- reveal ---------------- */
  function initReveal() {
    const obs = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } }), { threshold: .12 });
    $$('.reveal').forEach(el => obs.observe(el));
  }

  /* ---------------- boot ---------------- */
  async function init() {
    state.lang = detectLang();
    buildNav(); buildFooter();
    await refreshMe();
    updateAccountUI();
    await loadData();
    applyLang(state.lang);       // fills nav/footer/[data-i18n] + renders products/events/profile
    registerFields();            // self-register editable fields for the admin CMS
    initForms();
    initReveal();
    if (window.lucide) lucide.createIcons();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // expose a tiny API for pages if needed
  window.Benleo = { openAuth, applyLang, state };
})();
