/*
 * Journalism Writer — frontend application (vanilla JS, GitHub Pages).
 *
 * Files: config.js (API URL) → api.js (window.JWApi, the only backend client) → app.js (this file).
 *
 * Safety rules followed throughout this file:
 *  - Lesson content (AI-generated) is only ever inserted with textContent / createTextNode.
 *    The only innerHTML in this file sets static SVG icon markup defined below.
 *  - No lesson content is stored in the browser. localStorage keeps only small preferences:
 *    chosen age, last role, reading speed, voice, install-banner choice, and device bookmarks
 *    (lesson id + title + role + date). api.js keeps the random session token (never the password).
 *  - Accounts ask only for a nickname, a password and an age (no names, emails or phone numbers).
 *  - Lessons and the Library open only for signed-in pupils with an active subscription; the server
 *    checks this on every request, the browser only decides which page to show.
 */
(function () {
  'use strict';

  var Api = window.JWApi;
  var CONFIG = {
    POLL_INTERVAL_MS: 6000,
    MAX_POLLS: 30,
    LIBRARY_PAGE_SIZE: 12,
    MIN_AGE: 9,
    MAX_AGE: 18,
    TZ: 'Asia/Manila',
    MAX_BOOKMARKS: 100
  };
  var LOGO_SRC = 'assets/logo.webp';

  // ---------------------------------------------------------------------------
  // DOM helpers (safe construction only)
  // ---------------------------------------------------------------------------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      });
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { appendChildren(node, c); return; }
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }

  function $(sel) { return document.querySelector(sel); }

  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }

  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* optional */ } }

  function manilaParts(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(date || new Date());
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return { ymd: o.year + '-' + o.month + '-' + o.day, hour: parseInt(o.hour, 10) % 24 };
  }

  function formatLongDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
    return new Date(ymd + 'T12:00:00+08:00').toLocaleDateString('en-PH', { timeZone: CONFIG.TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatShortDate(ymd) {
    ymd = String(ymd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
    return new Date(ymd + 'T12:00:00+08:00').toLocaleDateString('en-PH', { timeZone: CONFIG.TZ, month: 'short', day: 'numeric', year: 'numeric' });
  }

  function greeting() {
    var h = manilaParts().hour;
    return h < 12 ? 'Magandang umaga' : (h < 18 ? 'Magandang hapon' : 'Magandang gabi');
  }

  function toast(message) {
    var t = $('#toast');
    t.textContent = message;
    t.classList.add('toast--show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('toast--show'); }, 4000);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Text where [bracketed reporter notes] are visually marked. Safe: text nodes only. */
  function richText(text) {
    var frag = document.createDocumentFragment();
    String(text || '').split(/(\[[^\]]+\])/g).forEach(function (part) {
      if (!part) return;
      if (/^\[[^\]]+\]$/.test(part)) frag.appendChild(el('span', { class: 'reporter-note', title: 'A real reporter would add verified information here.' }, part));
      else frag.appendChild(document.createTextNode(part));
    });
    return frag;
  }

  // ---------------------------------------------------------------------------
  // SVG icons (static markup defined here; never content from the server)
  // ---------------------------------------------------------------------------

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
    newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8Z"/>',
    ball: '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c4.08 4.08 4.08 10.06 0 14.14"/><path d="M19.07 4.93c-4.08 4.08-4.08 10.06 0 14.14"/><path d="M2 12h20"/><path d="M12 2v20"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.8A2 2 0 0 0 6.3 22h11.4a2 2 0 0 0 1.7-3.2L14 9.5V3"/><path d="M7.5 15h9"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3.5"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    volumeOff: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    play: '<path d="M6 3.5v17l14-8.5Z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    resume: '<path d="M4 5v14"/><path d="M9 5v14l11-7Z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    bookOpen: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    logIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    plusSquare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 3v4"/><path d="M21 5h-4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>'
  };

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.innerHTML = ICONS[name] || ICONS.newspaper; // static markup from ICONS only
    return svg;
  }

  function roleIcon(role, cls) { return icon(role && ICONS[role.icon] ? role.icon : 'newspaper', cls); }

  function decorateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach(function (node) {
      if (!node.querySelector('svg.icon')) node.insertBefore(icon(node.getAttribute('data-icon')), node.firstChild);
    });
  }

  // ---------------------------------------------------------------------------
  // App state (in memory) and small device preferences
  // ---------------------------------------------------------------------------

  var State = {
    roles: [], rolesById: {}, ages: [], categories: [],
    age: null,
    library: { filters: { role: 'all', age: 'all', category: 'all', from: '', to: '', q: '', saved: false }, items: [], page: 0, hasMore: false, total: 0 },
    account: null,          // { username, age, subscription, payment } from the server (memory only)
    accountChecked: false,
    adminKey: '' // memory only, never stored
  };
  var renderToken = 0;

  function loadRoles() {
    if (State.roles.length) return Promise.resolve();
    return Api.getRoles().then(function (data) {
      State.roles = data.roles || [];
      State.ages = data.ages || [];
      State.categories = data.categories || [];
      State.rolesById = {};
      State.roles.forEach(function (r) { State.rolesById[r.id] = r; });
    });
  }

  function validAge(v) {
    var n = Number(v);
    return Number.isInteger(n) && n >= CONFIG.MIN_AGE && n <= CONFIG.MAX_AGE ? n : null;
  }
  function setAge(age) { State.age = age; storageSet('jw.age', String(age)); }
  function agesList() { var out = []; for (var a = CONFIG.MIN_AGE; a <= CONFIG.MAX_AGE; a++) out.push(a); return out; }
  function gradeFor(age) { var f = State.ages.filter(function (x) { return x.age === age; })[0]; return f ? f.grade : ''; }
  function lessonHref(roleId, age) { return '#/lesson/' + encodeURIComponent(roleId) + (age ? '?age=' + age : ''); }

  // ---------------------------------------------------------------------------
  // Device bookmarks: ids + titles only (never lesson content, never personal data)
  // ---------------------------------------------------------------------------

  var Bookmarks = {
    list: function () {
      try {
        var v = JSON.parse(storageGet('jw.bookmarks') || '[]');
        return Array.isArray(v) ? v.filter(function (b) { return b && /^jw-[a-z0-9-]+$/.test(b.id); }) : [];
      } catch (e) { return []; }
    },
    has: function (id) { return Bookmarks.list().some(function (b) { return b.id === id; }); },
    toggle: function (record) {
      var list = Bookmarks.list();
      var i = -1;
      list.forEach(function (b, j) { if (b.id === record.lessonId) i = j; });
      if (i >= 0) list.splice(i, 1);
      else list.unshift({ id: record.lessonId, title: String(record.title || '').slice(0, 140), role: record.role, date: record.date, age: record.age || null, savedAt: new Date().toISOString().slice(0, 10) });
      storageSet('jw.bookmarks', JSON.stringify(list.slice(0, CONFIG.MAX_BOOKMARKS)));
      return i < 0;
    }
  };

  // ---------------------------------------------------------------------------
  // Read aloud (Web Speech API)
  //
  // One active session at a time. Each section has its own controls; starting a different section
  // cancels the current speech first. Text is spoken in sentence-sized chunks (avoids the Chrome
  // ~15-second cut-off). Pause/resume restart the current chunk, which is reliable across Chrome,
  // Edge, Safari and Android (native pause() is not). The paragraph being read is highlighted only
  // when the browser fires the utterance "start" event; no word-by-word highlighting is attempted.
  // ---------------------------------------------------------------------------

  var Speech = {
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function',
    rate: 1,
    voices: [],
    voiceURI: '',
    noVoices: false,
    session: null,          // { id, label, queue: [{ text, el }], index, state, message }
    token: 0,
    listeners: [],
    highlighted: null,
    RATES: [{ v: 0.75, t: 'Slow' }, { v: 0.9, t: 'A bit slow' }, { v: 1, t: 'Normal' }, { v: 1.15, t: 'A bit fast' }, { v: 1.3, t: 'Fast' }],

    init: function () {
      var saved = parseFloat(storageGet('jw.rate'));
      if (Speech.RATES.some(function (r) { return r.v === saved; })) Speech.rate = saved;
      Speech.voiceURI = storageGet('jw.voice') || '';
      $('#nr-pause').addEventListener('click', function () { Speech.pause(); });
      $('#nr-resume').addEventListener('click', function () { Speech.resume(); });
      $('#nr-stop').addEventListener('click', function () { Speech.stop(); });
      Speech.subscribe(Speech.updateNowReading);
      if (!Speech.supported) return;
      Speech.loadVoices();
      var ss = window.speechSynthesis;
      if (typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', Speech.loadVoices);
      else ss.onvoiceschanged = Speech.loadVoices;
      setTimeout(function () { if (!Speech.voices.length) { Speech.noVoices = true; Speech.notify(); } }, 2500);
      window.addEventListener('pagehide', function () { Speech.stop(); });
    },

    loadVoices: function () {
      var all = [];
      try { all = window.speechSynthesis.getVoices() || []; } catch (e) { all = []; }
      var rank = function (v) {
        var l = String(v.lang || '').toLowerCase().replace('_', '-');
        if (l === 'en-ph') return 0;
        if (l === 'fil-ph' || l === 'tl-ph') return 1;
        if (l === 'en-us' || l === 'en-gb' || l === 'en-au') return 2;
        if (l.indexOf('en') === 0) return 3;
        return 9;
      };
      Speech.voices = all.filter(function (v) { return rank(v) < 9; }).sort(function (a, b) { return rank(a) - rank(b); });
      if (Speech.voices.length) {
        Speech.noVoices = false;
        if (!Speech.voices.some(function (v) { return v.voiceURI === Speech.voiceURI; })) Speech.voiceURI = Speech.voices[0].voiceURI;
      }
      Speech.notify();
    },

    subscribe: function (fn) { Speech.listeners.push(fn); },
    resetListeners: function () { Speech.listeners = [Speech.updateNowReading]; },
    notify: function () { Speech.listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* a removed bar */ } }); },
    stateFor: function (id) { return Speech.session && Speech.session.id === id ? Speech.session.state : 'idle'; },

    chunk: function (text) {
      var clean = String(text || '').replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim();
      var sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
      var out = [];
      var buf = '';
      sentences.forEach(function (s) {
        s = s.trim();
        if (!s) return;
        while (s.length > 220) {
          var cut = s.lastIndexOf(', ', 200);
          if (cut < 80) cut = s.lastIndexOf(' ', 200);
          if (cut < 40) cut = 200;
          out.push(s.slice(0, cut + 1).trim());
          s = s.slice(cut + 1).trim();
        }
        if ((buf + ' ' + s).trim().length <= 200) buf = (buf + ' ' + s).trim();
        else { if (buf) out.push(buf); buf = s; }
      });
      if (buf) out.push(buf);
      return out;
    },

    /** items: [{ el, text }] in reading order. Cancels anything currently being read. */
    start: function (id, label, items) {
      if (!Speech.supported) { toast('Read aloud is not available in this browser.'); return; }
      Speech.halt();
      Speech.clearHighlight();
      var queue = [];
      items.forEach(function (it) { Speech.chunk(it.text).forEach(function (c) { queue.push({ text: c, el: it.el || null }); }); });
      Speech.session = { id: id, label: label, queue: queue, index: 0, state: queue.length ? 'playing' : 'ended', message: '' };
      Speech.notify();
      if (queue.length) Speech.speakCurrent();
    },

    halt: function () {
      Speech.token++;
      if (Speech.supported) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    },

    speakCurrent: function () {
      Speech.halt();
      var tok = Speech.token;
      var s = Speech.session;
      Speech.notify();
      // Small delay: Chrome can drop an utterance queued in the same tick as cancel().
      setTimeout(function () {
        if (tok !== Speech.token || !s || s !== Speech.session || s.state !== 'playing') return;
        var item = s.queue[s.index];
        var u = new window.SpeechSynthesisUtterance(item.text);
        u.rate = Speech.rate;
        var voice = Speech.voices.filter(function (v) { return v.voiceURI === Speech.voiceURI; })[0];
        if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-PH'; }
        u.onstart = function () {
          if (tok !== Speech.token) return;
          Speech.highlight(item.el); // only when the browser reports the utterance really started
        };
        u.onend = function () {
          if (tok !== Speech.token) return;
          s.index++;
          if (s.index < s.queue.length) Speech.speakCurrent();
          else { s.state = 'ended'; s.index = 0; Speech.clearHighlight(); Speech.notify(); }
        };
        u.onerror = function (ev) {
          if (tok !== Speech.token) return;
          var code = ev && ev.error;
          if (code === 'interrupted' || code === 'canceled') return;
          s.state = 'idle';
          s.message = code === 'not-allowed'
            ? 'Your browser blocked reading aloud. Tap Play again.'
            : 'Read aloud stopped because this device could not play the voice' + (code ? ' (' + code + ')' : '') + '.';
          Speech.clearHighlight();
          Speech.notify();
        };
        try { window.speechSynthesis.speak(u); }
        catch (e) { s.state = 'idle'; s.message = 'Read aloud is not available right now on this device.'; Speech.notify(); }
      }, 60);
    },

    highlight: function (node) {
      if (Speech.highlighted === node) return;
      Speech.clearHighlight();
      if (!node || !node.isConnected) return;
      node.classList.add('is-reading');
      Speech.highlighted = node;
      if (Speech.session && Speech.session.id === 'full' && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    },
    clearHighlight: function () {
      if (Speech.highlighted) Speech.highlighted.classList.remove('is-reading');
      Speech.highlighted = null;
    },

    pause: function () {
      var s = Speech.session;
      if (!s || s.state !== 'playing') return;
      Speech.halt();
      s.state = 'paused';
      Speech.notify();
    },
    resume: function () {
      var s = Speech.session;
      if (!s || s.state !== 'paused') return;
      s.state = 'playing';
      s.message = '';
      Speech.speakCurrent();
    },
    stop: function () {
      Speech.halt();
      Speech.clearHighlight();
      if (Speech.session) { Speech.session.state = 'idle'; Speech.session.index = 0; }
      Speech.notify();
    },
    /** Called when the page changes: the old elements are gone, so forget the session. */
    reset: function () {
      Speech.stop();
      Speech.session = null;
      Speech.resetListeners();
      Speech.notify();
    },
    setRate: function (r) {
      if (!Speech.RATES.some(function (x) { return x.v === r; })) return;
      Speech.rate = r;
      storageSet('jw.rate', String(r));
      if (Speech.session && Speech.session.state === 'playing') Speech.speakCurrent(); // restart current sentence at the new speed
      else Speech.notify();
    },

    updateNowReading: function () {
      var bar = $('#now-reading');
      var s = Speech.session;
      var active = !!(s && (s.state === 'playing' || s.state === 'paused'));
      bar.hidden = !active;
      document.body.classList.toggle('has-now-reading', active);
      if (!active) return;
      $('#now-reading-label').textContent = (s.state === 'paused' ? 'Paused: ' : 'Reading: ') + s.label;
      $('#now-reading-progress').textContent = 'part ' + (s.index + 1) + ' of ' + s.queue.length;
      $('#nr-pause').disabled = s.state !== 'playing';
      $('#nr-resume').disabled = s.state !== 'paused';
    }
  };

  /**
   * Read-aloud controls for one section: Play, Pause, Resume, Stop, Replay and a speed selector.
   * getItems() returns [{ el, text }] at the moment Play is pressed.
   */
  function speechBar(id, label, getItems) {
    var wrap = el('section', { class: 'speech', 'aria-label': 'Read aloud: ' + label, 'data-speech': id });
    var title = el('p', { class: 'speech__title' }, [icon('volume'), 'Listen: ' + label]);
    if (!Speech.supported) {
      appendChildren(wrap, [title, el('p', { class: 'speech__status' }, [icon('volumeOff'), 'Read aloud is not available in this browser. Try Chrome, Edge or Safari.'])]);
      return wrap;
    }
    var btn = function (name, text, ic, fn) {
      return el('button', { type: 'button', class: 'btn btn--small btn--speech', 'data-act': name, 'aria-label': text + ' ' + label, onclick: fn }, [icon(ic), text]);
    };
    var play = btn('play', 'Play', 'play', function () {
      if (Speech.stateFor(id) === 'paused') Speech.resume();
      else Speech.start(id, label, getItems());
    });
    var pause = btn('pause', 'Pause', 'pause', function () { Speech.pause(); });
    var resume = btn('resume', 'Resume', 'resume', function () { Speech.resume(); });
    var stop = btn('stop', 'Stop', 'stop', function () { Speech.stop(); });
    var replay = btn('replay', 'Replay', 'replay', function () { Speech.start(id, label, getItems()); });
    var selId = 'rate-' + id;
    var rate = el('select', { id: selId, class: 'speech__rate', onchange: function (e) { Speech.setRate(parseFloat(e.target.value)); } },
      Speech.RATES.map(function (r) { return el('option', { value: String(r.v), text: r.t + ' (' + r.v + '×)' }); }));
    var status = el('p', { class: 'speech__status', 'aria-live': 'polite' });

    appendChildren(wrap, [
      title,
      el('div', { class: 'speech__buttons', role: 'group', 'aria-label': label + ' controls' }, [play, pause, resume, stop, replay]),
      el('div', { class: 'speech__speed' }, [el('label', { for: selId, text: 'Speed' }), rate]),
      status
    ]);

    var update = function () {
      var st = Speech.stateFor(id);
      var s = Speech.session;
      play.disabled = st === 'playing';
      pause.disabled = st !== 'playing';
      resume.disabled = st !== 'paused';
      stop.disabled = st !== 'playing' && st !== 'paused';
      rate.value = String(Speech.rate);
      wrap.dataset.state = st;
      var msg = '';
      if (s && s.id === id && s.message) msg = s.message;
      else if (st === 'playing') msg = 'Reading part ' + (s.index + 1) + ' of ' + s.queue.length + '.';
      else if (st === 'paused') msg = 'Paused. Press Resume to continue.';
      else if (st === 'ended') msg = 'Finished.';
      else if (Speech.noVoices) msg = 'No English voice was found on this device, so the default voice will be used.';
      if (status.textContent !== msg) status.textContent = msg;
    };
    Speech.subscribe(update);
    update();
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Motion: page-enter animation and scroll reveal (both switched off for "reduce motion")
  // ---------------------------------------------------------------------------

  var Motion = {
    enter: function (node) {
      if (!node || prefersReducedMotion()) return;
      node.classList.remove('view--enter');
      void node.offsetWidth; // restart the CSS animation
      node.classList.add('view--enter');
    },
    observer: null,
    reveal: function (root) {
      var items = Array.prototype.slice.call((root || document).querySelectorAll('.reveal'));
      if (!items.length) return;
      if (prefersReducedMotion() || typeof window.IntersectionObserver !== 'function') {
        items.forEach(function (n) { n.classList.add('is-visible'); });
        return;
      }
      if (Motion.observer) Motion.observer.disconnect();
      Motion.observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-visible'); Motion.observer.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
      items.forEach(function (n) { Motion.observer.observe(n); });
    }
  };

  // ---------------------------------------------------------------------------
  // Modal dialogs (focus kept inside, Esc closes, focus returns to the opener)
  // ---------------------------------------------------------------------------

  var Modal = {
    current: null,
    seq: 0,
    open: function (opts) {
      Modal.close(true);
      var prev = document.activeElement;
      var titleId = 'modal-title-' + (++Modal.seq);
      var closeBtn = el('button', { type: 'button', class: 'modal__close', 'aria-label': 'Close', onclick: function () { Modal.close(); } }, icon('close'));
      var dialog = el('div', { class: 'modal__dialog' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, [
        closeBtn,
        opts.badge || null,
        el('h2', { id: titleId, class: 'modal__title', text: opts.title }),
        el('div', { class: 'modal__body' }, opts.body)
      ]);
      var root = el('div', { class: 'modal', 'data-modal': opts.name || '' }, [
        el('div', { class: 'modal__backdrop', onclick: function () { Modal.close(); } }),
        dialog
      ]);
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); Modal.close(); return; }
        if (e.key !== 'Tab') return;
        var f = Modal.focusables(dialog);
        if (!f.length) { e.preventDefault(); dialog.focus(); return; }
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKey);
      ['.topbar', '#view', '.site-footer'].forEach(function (s) { var n = $(s); if (n) n.setAttribute('inert', ''); });
      document.body.appendChild(root);
      document.body.classList.add('has-modal');
      Modal.current = { root: root, dialog: dialog, prev: prev, onKey: onKey, onClose: opts.onClose, name: opts.name || '' };
      var focusFirst = function () {
        var target = dialog.querySelector('[autofocus]') || dialog.querySelector('input, select, textarea') || closeBtn;
        try { target.focus(); } catch (e) { /* ignore */ }
      };
      focusFirst();
      if (prefersReducedMotion()) root.classList.add('is-open');
      else window.requestAnimationFrame(function () { root.classList.add('is-open'); });
      return Modal.current;
    },
    /** Replace the dialog's title and body (for multi-step dialogs). */
    replace: function (title, body) {
      var c = Modal.current;
      if (!c) return;
      c.dialog.querySelector('.modal__title').textContent = title;
      var b = c.dialog.querySelector('.modal__body');
      b.textContent = '';
      appendChildren(b, body);
      b.classList.remove('modal__body--swap'); void b.offsetWidth; b.classList.add('modal__body--swap');
      var target = b.querySelector('[autofocus]') || b.querySelector('input, select, textarea, button');
      if (target) { try { target.focus(); } catch (e) { /* ignore */ } }
    },
    focusables: function (root) {
      return Array.prototype.slice.call(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(function (n) { return !n.hidden && !n.closest('[hidden]'); });
    },
    close: function (silent) {
      var c = Modal.current;
      if (!c) return;
      Modal.current = null;
      document.removeEventListener('keydown', c.onKey);
      if (c.root.parentNode) c.root.parentNode.removeChild(c.root);
      document.body.classList.remove('has-modal');
      ['.topbar', '#view', '.site-footer'].forEach(function (s) { var n = $(s); if (n) n.removeAttribute('inert'); });
      if (c.prev && typeof c.prev.focus === 'function' && c.prev.isConnected) { try { c.prev.focus(); } catch (e) { /* ignore */ } }
      if (!silent && typeof c.onClose === 'function') c.onClose();
    },
    isOpen: function (name) { return !!(Modal.current && (!name || Modal.current.name === name)); }
  };

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  function formField(id, label, input, hint) {
    var hintId = hint ? id + '-hint' : null;
    var control = /^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName) ? input : input.querySelector('input, select, textarea');
    if (hintId && control) control.setAttribute('aria-describedby', hintId);
    return el('div', { class: 'form-field' }, [
      el('label', { for: id, text: label }),
      input,
      hint ? el('p', { id: hintId, class: 'form-hint', text: hint }) : null
    ]);
  }

  function passwordField(id, label, hint, autocomplete) {
    var input = el('input', { type: 'password', id: id, autocomplete: autocomplete || 'current-password', maxlength: 64, required: true, spellcheck: 'false' });
    var toggle = el('button', { type: 'button', class: 'pw-toggle', 'aria-pressed': 'false', 'aria-label': 'Show password', 'aria-controls': id });
    var paint = function (shown) {
      toggle.textContent = '';
      appendChildren(toggle, [icon(shown ? 'eyeOff' : 'eye'), shown ? 'Hide' : 'Show']);
      toggle.setAttribute('aria-pressed', shown ? 'true' : 'false');
      toggle.setAttribute('aria-label', (shown ? 'Hide' : 'Show') + ' password');
    };
    paint(false);
    toggle.addEventListener('click', function () { var show = input.type === 'password'; input.type = show ? 'text' : 'password'; paint(show); input.focus(); });
    var wrap = el('div', { class: 'pw-wrap' }, [input, toggle]);
    return { field: formField(id, label, wrap, hint), input: input };
  }

  function checkField(id, text, checked) {
    var input = el('input', { type: 'checkbox', id: id, checked: !!checked });
    return { field: el('label', { for: id, class: 'check-field' }, [input, el('span', { text: text })]), input: input };
  }

  function formError() { return el('p', { class: 'form-error', role: 'alert', hidden: true }); }
  function showFormError(node, message) { node.textContent = message; node.hidden = !message; }

  function submitButton(text, ic) { return el('button', { type: 'submit', class: 'btn btn--block' }, [ic ? icon(ic) : null, text]); }
  function setBusy(btn, busy, text) {
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = ''; appendChildren(btn, [el('span', { class: 'spinner spinner--sm', 'aria-hidden': 'true' }), text || 'Please wait…']); }
    else if (btn.dataset.label !== undefined) { var label = btn.dataset.label; btn.textContent = ''; appendChildren(btn, label); delete btn.dataset.label; }
  }

  function formatPeso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function formatIsoDate(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? '' : formatLongDate(manilaParts(new Date(t)).ymd); }

  function copyButton(value, label) {
    return el('button', { type: 'button', class: 'btn btn--small btn--ghost copy-btn', 'aria-label': 'Copy ' + label, onclick: function () {
      var done = function () { toast(label + ' copied.'); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, function () { toast('Copy did not work. Please type it instead.'); });
        else toast('Copy is not available. Please type it instead.');
      } catch (e) { toast('Copy is not available. Please type it instead.'); }
    } }, [icon('copy'), 'Copy']);
  }

  // ---------------------------------------------------------------------------
  // Accounts: sign in, sign up, GCash payment
  // ---------------------------------------------------------------------------

  function signedIn() { return !!State.account; }
  function isSubscriber() { return !!(State.account && State.account.subscription && State.account.subscription.state === 'ACTIVE'); }

  function setAccount(account) {
    State.account = account || null;
    State.accountChecked = true;
    if (account && account.age && !State.age) setAge(account.age);
    renderNav();
  }

  /** Loads the account once per page load (or when forced). Never throws. */
  function ensureAccount(force) {
    if (State.accountChecked && !force) return Promise.resolve(State.account);
    if (!Api.session.has()) { setAccount(null); return Promise.resolve(null); }
    return Api.getAccount().then(function (a) { setAccount(a); return a; }, function (err) {
      if (err && err.code === 'AUTH_REQUIRED') { setAccount(null); return null; }
      State.accountChecked = false; // offline: try again on the next page
      throw err;
    });
  }

  function afterSignIn(account, next) {
    setAccount(account);
    Modal.close(true);
    toast('Welcome, ' + account.username + '!');
    var target = next && /^#\//.test(next) ? next : (isSubscriber() ? '#/dashboard' : '#/account');
    if (!isSubscriber() && target !== '#/account') target = '#/account';
    if (location.hash === target) route(); else location.hash = target;
  }

  function openSignIn(opts) {
    opts = opts || {};
    var name = el('input', { type: 'text', id: 'si-name', autocomplete: 'username', maxlength: 20, required: true, autocapitalize: 'none', spellcheck: 'false', autofocus: true });
    var pw = passwordField('si-pass', 'Password', null, 'current-password');
    var remember = checkField('si-remember', 'Keep me signed in on this device (not on a shared computer)', false);
    var err = formError();
    var btn = submitButton('Sign in', 'logIn');
    var form = el('form', { class: 'auth-form', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      showFormError(err, '');
      if (!name.value.trim() || !pw.input.value) { showFormError(err, 'Type your nickname and password.'); (name.value.trim() ? pw.input : name).focus(); return; }
      setBusy(btn, true, 'Signing in…');
      Api.signIn({ username: name.value.trim(), password: pw.input.value, remember: remember.input.checked }).then(function (account) {
        afterSignIn(account, opts.next);
      }, function (e2) {
        setBusy(btn, false);
        showFormError(err, friendlyError(e2));
        pw.input.value = '';
        pw.input.focus();
      });
    } }, [
      opts.notice ? el('p', { class: 'notice notice--info', text: opts.notice }) : null,
      formField('si-name', 'Nickname', name),
      pw.field,
      remember.field,
      err,
      btn,
      el('p', { class: 'auth-switch' }, ['New here? ', el('button', { type: 'button', class: 'linklike', onclick: function () { openSignUp(); } }, 'Create an account')]),
      el('p', { class: 'form-hint center', text: 'Forgot your password? Ask your teacher to reset it.' })
    ]);
    Modal.open({ name: 'signin', title: 'Sign in', body: form, cls: 'modal__dialog--auth', badge: el('span', { class: 'modal__badge' }, icon('user')) });
  }

  function openSignUp() {
    var name = el('input', { type: 'text', id: 'su-name', autocomplete: 'username', maxlength: 20, required: true, autocapitalize: 'none', spellcheck: 'false', autofocus: true, pattern: '[A-Za-z][A-Za-z0-9_]{2,19}' });
    var pw = passwordField('su-pass', 'Make a password', '8 or more characters, with at least one letter and one number.', 'new-password');
    var age = el('select', { id: 'su-age', required: true }, [el('option', { value: '', text: 'Choose your age' })].concat(agesList().map(function (a) {
      return el('option', { value: String(a), selected: a === State.age, text: a + ' years old' });
    })));
    var consent = checkField('su-consent', 'My parent or guardian says I can join, and will help me pay ₱1,500 a year with GCash.', false);
    var remember = checkField('su-remember', 'Keep me signed in on this device (not on a shared computer)', false);
    var err = formError();
    var btn = submitButton('Create my account', 'sparkle');
    var form = el('form', { class: 'auth-form', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      showFormError(err, '');
      var n = name.value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(n)) { showFormError(err, 'Your nickname needs 3 to 20 letters, numbers or _ and must start with a letter.'); name.focus(); return; }
      if (pw.input.value.length < 8 || !/[A-Za-z]/.test(pw.input.value) || !/\d/.test(pw.input.value)) { showFormError(err, 'Your password needs 8 or more characters, with at least one letter and one number.'); pw.input.focus(); return; }
      if (!validAge(age.value)) { showFormError(err, 'Please choose your age.'); age.focus(); return; }
      if (!consent.input.checked) { showFormError(err, 'Please ask your parent or guardian first, then tick the box.'); consent.input.focus(); return; }
      setBusy(btn, true, 'Creating your account…');
      Api.signUp({ username: n, password: pw.input.value, age: Number(age.value), guardianOk: true, remember: remember.input.checked }).then(function (account) {
        setAccount(account);
        setAge(Number(age.value));
        openPayment({ welcome: true });
      }, function (e2) {
        setBusy(btn, false);
        showFormError(err, friendlyError(e2));
      });
    } }, [
      el('div', { class: 'price-strip' }, [icon('wallet'), el('span', null, [el('strong', { text: '₱1,500 a year' }), ' · pay once with GCash · all lessons for 365 days'])]),
      formField('su-name', 'Nickname', name, 'Make up a nickname, like "inkwriter_7". Do not use your real full name, phone number or email.'),
      pw.field,
      formField('su-age', 'Your age', age, 'Lessons are written for your age.'),
      consent.field,
      remember.field,
      err,
      btn,
      el('p', { class: 'privacy-note' }, [icon('shield'), 'We only keep your nickname, your password (scrambled so nobody can read it) and your age. No names, emails or phone numbers.']),
      el('p', { class: 'auth-switch' }, ['Already have an account? ', el('button', { type: 'button', class: 'linklike', onclick: function () { openSignIn(); } }, 'Sign in')])
    ]);
    Modal.open({ name: 'signup', title: 'Create your account', body: form, cls: 'modal__dialog--auth', badge: el('span', { class: 'modal__badge' }, icon('pen')) });
  }

  /** The GCash payment window: steps, QR/number, and the 13-digit reference number. */
  function openPayment(opts) {
    opts = opts || {};
    var onClose = function () { if (location.hash !== '#/account') location.hash = '#/account'; else route(); };
    Modal.open({ name: 'gcash', title: 'Pay with GCash', cls: 'modal__dialog--gcash', onClose: onClose, badge: el('span', { class: 'modal__badge modal__badge--gcash' }, icon('wallet')), body: loadingState('Getting the payment details…') });
    Api.getPaymentInfo().then(function (info) {
      if (!Modal.isOpen('gcash')) return;
      Modal.replace('Pay with GCash', paymentBody(info, opts));
    }, function (err) {
      if (!Modal.isOpen('gcash')) return;
      Modal.replace('Pay with GCash', errorState(friendlyError(err), function () { openPayment(opts); }));
    });
  }

  function paymentBody(info, opts) {
    var acct = State.account || {};
    var pay = acct.payment;
    var welcome = opts.welcome ? el('p', { class: 'notice notice--success' }, [icon('checkCircle'), el('span', null, [el('strong', { text: 'Account created! ' }), 'One last step: pay for your year of lessons.'])]) : null;
    if (!info.configured) {
      return [welcome, el('p', { class: 'notice notice--warn', text: 'Payments are not set up yet. Please tell your teacher. You can sign in again later to pay.' }),
        el('button', { type: 'button', class: 'btn btn--ghost btn--block', onclick: function () { Modal.close(); } }, 'Close')];
    }
    var ref = el('input', { type: 'text', id: 'gc-ref', inputmode: 'numeric', autocomplete: 'off', maxlength: 17, required: true, placeholder: '13 digits', spellcheck: 'false',
      value: pay && pay.status === 'PENDING' ? pay.referenceNo : '' });
    ref.addEventListener('input', function () {
      var d = ref.value.replace(/\D/g, '').slice(0, 13);
      var pretty = d.replace(/^(\d{4})(\d{0,3})(\d{0,6}).*$/, function (m, a, b, c) { return [a, b, c].filter(Boolean).join(' '); });
      if (ref.value !== pretty) ref.value = pretty;
    });
    var err = formError();
    var btn = submitButton('Send reference number for checking', 'send');
    var amountText = formatPeso(info.amount);
    var form = el('form', { class: 'gcash-form', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      showFormError(err, '');
      var digits = ref.value.replace(/\D/g, '');
      if (digits.length !== 13) { showFormError(err, 'A GCash reference number has 13 digits. Please copy it from your GCash receipt.'); ref.focus(); return; }
      setBusy(btn, true, 'Sending…');
      Api.submitPayment(digits).then(function (account) {
        setAccount(account);
        Modal.replace('Thank you!', paymentSent(account));
      }, function (e2) {
        setBusy(btn, false);
        showFormError(err, friendlyError(e2));
      });
    } }, [
      formField('gc-ref', 'GCash Reference No.', ref, 'Find it on your GCash receipt after paying, for example 1012 345 678901.'),
      err,
      btn
    ]);

    return [
      welcome,
      el('div', { class: 'gcash-amount' }, [
        el('span', { class: 'gcash-amount__label', text: 'Yearly subscription' }),
        el('span', { class: 'gcash-amount__value', text: amountText }),
        el('span', { class: 'gcash-amount__sub', text: info.planDays + ' days of daily lessons, the Writers Library and read aloud' })
      ]),
      pay && pay.status === 'REJECTED' && pay.note ? el('p', { class: 'notice notice--warn' }, [el('strong', { text: 'Last time: ' }), pay.note]) : null,
      el('ol', { class: 'gcash-steps' }, [
        el('li', null, [
          el('h3', { text: 'Open your GCash app' }),
          el('p', { text: info.qrUrl ? 'Tap "Scan QR" and scan this code, or tap "Send" and use the number below.' : 'Tap "Send", then "Express Send", and use the number below.' }),
          info.qrUrl ? el('img', { class: 'gcash-qr', src: info.qrUrl, alt: 'GCash QR code for paying Journalism Writer', width: 220, height: 220, loading: 'lazy', referrerpolicy: 'no-referrer' }) : null
        ]),
        el('li', null, [
          el('h3', { text: 'Send exactly ' + amountText }),
          el('dl', { class: 'gcash-details' }, [
            el('div', null, [el('dt', { text: 'Account name' }), el('dd', { text: info.accountName })]),
            el('div', null, [el('dt', { text: 'GCash number' }), el('dd', null, [el('span', { class: 'mono', text: info.number }), copyButton(info.number.replace(/\s/g, ''), 'GCash number')])]),
            el('div', null, [el('dt', { text: 'Amount' }), el('dd', null, [el('span', { class: 'mono', text: amountText }), copyButton(String(info.amount), 'Amount')])])
          ])
        ]),
        el('li', null, [
          el('h3', { text: 'Type the reference number' }),
          form
        ])
      ]),
      el('p', { class: 'privacy-note privacy-note--warn' }, [icon('shield'), el('span', null, [el('strong', { text: 'Stay safe: ' }), 'never share your GCash MPIN or the 6-digit code (OTP) with anyone. Journalism Writer will never ask for them. Ask a parent or guardian to help you pay.'])]),
      el('p', { class: 'form-hint center', text: 'A teacher checks each payment in GCash, usually within one day. Your lessons open as soon as it is approved.' }),
      el('button', { type: 'button', class: 'btn btn--ghost btn--block', onclick: function () { Modal.close(); } }, 'I will pay later')
    ];
  }

  function paymentSent(account) {
    var p = account && account.payment;
    return [
      el('div', { class: 'sent-illustration', 'aria-hidden': 'true' }, [icon('checkCircle')]),
      el('p', { class: 'lead-text center', text: 'We received your reference number' + (p && p.referenceNo ? ' ending in ' + p.referenceNo.slice(-4) : '') + '.' }),
      el('p', { class: 'center', text: 'A teacher will check the payment in GCash, usually within one day. Sign in any time to see if your lessons are open.' }),
      el('button', { type: 'button', class: 'btn btn--block', autofocus: true, onclick: function () { Modal.close(); } }, [icon('user'), 'See my account'])
    ];
  }

  function signOut() {
    Api.signOut().then(function () {
      setAccount(null);
      toast('You are signed out.');
      redirect('#/welcome');
    });
  }

  // ---------------------------------------------------------------------------
  // Header navigation (depends on sign-in state)
  // ---------------------------------------------------------------------------

  function renderNav() {
    var nav = $('#mainnav');
    if (!nav) return;
    nav.textContent = '';
    var section = parseHash().parts[0] || '';
    var link = function (href, key, text, ic) {
      var current = section === key || (key === 'dashboard' && section === 'lesson');
      return el('a', { href: href, 'data-nav': key, 'aria-current': current ? 'page' : null }, [icon(ic), el('span', { class: 'mainnav__text', text: text })]);
    };
    if (State.account) {
      if (isSubscriber()) appendChildren(nav, [link('#/dashboard', 'dashboard', 'Today', 'calendar'), link('#/library', 'library', 'Library', 'book')]);
      nav.appendChild(link('#/account', 'account', State.account.username, 'user'));
    } else {
      appendChildren(nav, [
        el('button', { type: 'button', class: 'btn btn--small btn--ghost nav-btn', 'data-auth': 'signin', onclick: function () { openSignIn(); } }, [icon('logIn'), 'Sign in']),
        el('button', { type: 'button', class: 'btn btn--small nav-btn', 'data-auth': 'signup', onclick: function () { openSignUp(); } }, [icon('sparkle'), 'Sign up'])
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // "Install the app" banner (first opening) + service worker
  // ---------------------------------------------------------------------------

  var Install = {
    deferred: null,
    node: null,
    SEEN_KEY: 'jw.installSeen',
    isStandalone: function () {
      return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
    },
    platform: function () {
      var ua = String(window.navigator.userAgent || '');
      if (/iphone|ipad|ipod/i.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)) return 'ios';
      if (/android/i.test(ua)) return 'android';
      return 'desktop';
    },
    init: function () {
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();          // we show our own banner instead of the browser's mini-bar
        Install.deferred = e;
        if (Install.node) Install.paint();
      });
      window.addEventListener('appinstalled', function () {
        Install.deferred = null;
        storageSet(Install.SEEN_KEY, 'installed');
        Install.hide();
        toast('Journalism Writer was added to your device.');
      });
      Install.registerWorker();
      var link = $('#install-link');
      if (link) link.addEventListener('click', function (e) { e.preventDefault(); Install.show(true); });
      if (!Install.isStandalone() && !storageGet(Install.SEEN_KEY)) {
        setTimeout(function () { if (!Install.isStandalone()) Install.show(false); }, prefersReducedMotion() ? 300 : 1400);
      }
    },
    registerWorker: function () {
      // Only when the site ships its manifest + sw.js (GitHub Pages / any https host).
      if (!('serviceWorker' in window.navigator) || !$('link[rel="manifest"]')) return;
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
      try { window.navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ }); } catch (e) { /* ignore */ }
    },
    show: function (manual) {
      if (Install.isStandalone()) { if (manual) toast('Journalism Writer is already installed on this device.'); return; }
      if (!Install.node) {
        Install.node = el('section', { class: 'install-banner', role: 'region', 'aria-label': 'Install Journalism Writer', tabindex: '-1' });
        document.body.appendChild(Install.node);
      }
      Install.paint();
      if (prefersReducedMotion()) Install.node.classList.add('is-open');
      else window.requestAnimationFrame(function () { if (Install.node) Install.node.classList.add('is-open'); });
      if (manual) Install.node.focus();
    },
    paint: function () {
      var n = Install.node;
      if (!n) return;
      n.textContent = '';
      var p = Install.platform();
      var steps;
      if (Install.deferred) steps = el('p', { class: 'install-banner__text', text: 'Open it from your home screen like an app. It is quick to open, even on slow internet.' });
      else if (p === 'ios') steps = el('ol', { class: 'install-banner__steps' }, [
        el('li', null, ['Tap the Share button ', icon('share', 'icon--inline'), ' at the bottom or top of Safari.']),
        el('li', null, ['Choose ', el('strong', { text: 'Add to Home Screen' }), ' ', icon('plusSquare', 'icon--inline'), '.'])
      ]);
      else steps = el('ol', { class: 'install-banner__steps' }, [
        el('li', null, ['Open your browser menu (', el('strong', { text: '⋮' }), ' or ', el('strong', { text: '☰' }), ').']),
        el('li', null, ['Choose ', el('strong', { text: p === 'android' ? 'Add to Home screen' : 'Install Journalism Writer' }), ' (or "Install app").'])
      ]);
      appendChildren(n, [
        el('img', { class: 'install-banner__icon', src: LOGO_SRC, alt: '', width: 56, height: 56 }),
        el('div', { class: 'install-banner__body' }, [
          el('p', { class: 'install-banner__title', text: 'Add Journalism Writer to your home screen' }),
          steps
        ]),
        el('div', { class: 'install-banner__actions' }, [
          Install.deferred ? el('button', { type: 'button', class: 'btn btn--small', 'data-install': 'go', onclick: Install.prompt }, [icon('download'), 'Install']) : null,
          el('button', { type: 'button', class: 'btn btn--small btn--light', 'data-install': 'later', onclick: function () { storageSet(Install.SEEN_KEY, 'dismissed'); Install.hide(); } }, 'Not now')
        ])
      ]);
    },
    prompt: function () {
      var e = Install.deferred;
      if (!e) return;
      Install.deferred = null;
      try {
        e.prompt();
        Promise.resolve(e.userChoice).then(function (choice) {
          storageSet(Install.SEEN_KEY, choice && choice.outcome === 'accepted' ? 'installed' : 'dismissed');
          Install.hide();
        });
      } catch (err) { Install.paint(); }
    },
    hide: function () {
      var n = Install.node;
      if (!n) return;
      Install.node = null;
      n.classList.remove('is-open');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, prefersReducedMotion() ? 0 : 320);
    }
  };

  // ---------------------------------------------------------------------------
  // Landing page (public): animated hero, sign in / sign up, what you get, price
  // ---------------------------------------------------------------------------

  var FALLBACK_ROLES = [
    { id: 'editorial', name: 'Editorial Writer', icon: 'message', short: 'Take a stand and persuade with reasons.' },
    { id: 'feature', name: 'Feature Writer', icon: 'star', short: 'Tell a human-interest story with colour.' },
    { id: 'column', name: 'Columnist', icon: 'pen', short: 'Share a personal view in your own voice.' },
    { id: 'news', name: 'News Writer', icon: 'newspaper', short: 'Report the facts: who, what, when, where.' },
    { id: 'sports', name: 'Sports Writer', icon: 'ball', short: 'Cover games with energy and fairness.' },
    { id: 'scitech', name: 'Science and Technology Writer', icon: 'flask', short: 'Explain science clearly and carefully.' },
    { id: 'caption', name: 'Caption Writer', icon: 'camera', short: 'Write short, exact words for photos.' }
  ];

  var ROTATING = ['news writer.', 'editorial writer.', 'feature writer.', 'columnist.', 'sports writer.', 'science writer.', 'caption writer.'];

  function startTypewriter(node, token) {
    if (prefersReducedMotion()) { node.textContent = 'campus journalist.'; return; }
    var w = 0, i = 0, deleting = false;
    var tick = function () {
      if (token !== renderToken || !node.isConnected) return;
      var word = ROTATING[w];
      i += deleting ? -1 : 1;
      node.textContent = word.slice(0, i);
      var wait = deleting ? 45 : 85;
      if (!deleting && i === word.length) { deleting = true; wait = 1600; }
      else if (deleting && i === 0) { deleting = false; w = (w + 1) % ROTATING.length; wait = 350; }
      setTimeout(tick, wait);
    };
    setTimeout(tick, 900);
  }

  function renderLanding(token) {
    setDateline(manilaParts().ymd);
    var rolesReady = loadRoles().then(function () { return State.roles; }, function () { return []; });
    return rolesReady.then(function (roles) {
      if (token !== renderToken) return;
      var list = roles && roles.length ? roles : FALLBACK_ROLES;
      var acct = State.account;
      var rotator = el('span', { class: 'rotator', 'aria-hidden': 'true' });
      var ctas = acct
        ? [el('a', { class: 'btn btn--lg', href: isSubscriber() ? '#/dashboard' : '#/account' }, [icon(isSubscriber() ? 'bookOpen' : 'wallet'), isSubscriber() ? 'Open today\'s lessons' : 'Finish my subscription']),
           el('a', { class: 'btn btn--lg btn--ghost', href: '#/account' }, [icon('user'), 'My account'])]
        : [el('button', { type: 'button', class: 'btn btn--lg btn--glow', 'data-auth': 'signup', onclick: function () { openSignUp(); } }, [icon('sparkle'), 'Sign up · ₱1,500 a year']),
           el('button', { type: 'button', class: 'btn btn--lg btn--ghost', 'data-auth': 'signin', onclick: function () { openSignIn(); } }, [icon('logIn'), 'Sign in'])];

      var floaters = ['pen', 'newspaper', 'camera', 'message', 'flask', 'ball', 'star', 'bookOpen'].map(function (n, i) {
        return el('span', { class: 'floater floater--' + (i + 1), 'aria-hidden': 'true' }, icon(n));
      });

      var feature = function (ic, title, text, i) {
        return el('li', { class: 'feature reveal', style: '--d:' + (i * 90) + 'ms' }, [
          el('span', { class: 'feature__icon' }, icon(ic)),
          el('h3', { text: title }),
          el('p', { text: text })
        ]);
      };

      setView([
        el('section', { class: 'landing-hero', 'aria-labelledby': 'landing-h' }, [
          el('div', { class: 'landing-hero__bg', 'aria-hidden': 'true' }, floaters),
          el('div', { class: 'landing-hero__grid' }, [
            el('div', { class: 'landing-hero__copy' }, [
              el('p', { class: 'eyebrow anim-rise', style: '--d:80ms', text: 'For Filipino campus journalists aged 9 to 18' }),
              el('h1', { id: 'landing-h', class: 'landing-hero__title anim-rise', style: '--d:160ms' }, [
                el('span', { class: 'sr-only', text: 'Write like a real campus journalist.' }),
                el('span', { 'aria-hidden': 'true' }, ['Write like a real ', el('br'), rotator, el('span', { class: 'caret' })])
              ]),
              el('p', { class: 'landing-hero__lead anim-rise', style: '--d:260ms', text: acct
                ? 'Welcome back, ' + acct.username + '! A new topic, the writing rules and a model article are waiting for every kind of writing.'
                : 'Every day: a new topic, the writing rules, and a model article with notes under every paragraph. Learn it, listen to it, then write your own.' }),
              el('div', { class: 'landing-hero__cta anim-rise', style: '--d:360ms' }, ctas),
              acct ? null : el('p', { class: 'muted small anim-rise', style: '--d:440ms', text: 'Already subscribed? Sign in to open today\'s lessons.' })
            ]),
            el('div', { class: 'landing-hero__art anim-pop', style: '--d:200ms' }, [
              el('div', { class: 'paper paper--back', 'aria-hidden': 'true' }),
              el('div', { class: 'paper', 'aria-hidden': 'true' }, [
                el('span', { class: 'paper__mast', text: 'THE YOUNG JOURNALIST' }),
                el('span', { class: 'paper__line paper__line--h' }),
                el('span', { class: 'paper__line' }), el('span', { class: 'paper__line' }), el('span', { class: 'paper__line paper__line--short' }),
                el('span', { class: 'paper__photo' }, icon('camera')),
                el('span', { class: 'paper__line' }), el('span', { class: 'paper__line paper__line--short' })
              ]),
              el('img', { class: 'landing-hero__logo', src: LOGO_SRC, alt: 'Journalism Writer logo', width: 384, height: 384 })
            ])
          ])
        ]),

        el('section', { class: 'landing-section', 'aria-labelledby': 'what-h' }, [
          el('h2', { id: 'what-h', class: 'landing-section__title reveal', text: 'Everything a young journalist needs' }),
          el('ul', { class: 'feature-grid' }, [
            feature('calendar', 'A fresh lesson every day', 'New topics each morning, written for your age, for all seven kinds of school paper writing.', 0),
            feature('list', 'Rules you can follow', 'A paragraph-by-paragraph guide, common mistakes and a checklist for your own article.', 1),
            feature('newspaper', 'Model articles explained', 'Numbered sample paragraphs with a note under each one: why it is there and what it does.', 2),
            feature('volume', 'Listen while you read', 'Read aloud for the rules, the topic, the sample, or the whole lesson, at your own speed.', 3),
            feature('book', 'Your Writers Library', 'Every past lesson saved. Search by title, writing role or date and read it again.', 4),
            feature('shield', 'Safe for kids', 'No ads. No real names, emails or phone numbers. Facts are never made up.', 5)
          ])
        ]),

        el('section', { class: 'landing-section landing-section--tint', 'aria-labelledby': 'roles-land-h' }, [
          el('h2', { id: 'roles-land-h', class: 'landing-section__title reveal', text: 'Seven writing roles to master' }),
          el('ul', { class: 'role-chips' }, list.map(function (r, i) {
            return el('li', { class: 'role-chip reveal', style: '--d:' + (i * 70) + 'ms' }, [
              el('span', { class: 'role-chip__icon role-icon--' + r.id }, roleIcon(r)),
              el('span', null, [el('strong', { text: r.name }), el('span', { class: 'role-chip__short', text: r.short })])
            ]);
          }))
        ]),

        el('section', { class: 'landing-section', 'aria-labelledby': 'how-h' }, [
          el('h2', { id: 'how-h', class: 'landing-section__title reveal', text: 'How it works' }),
          el('ol', { class: 'how-steps' }, [
            ['user', 'Sign up and pay with GCash', 'Make a nickname, then pay ₱1,500 once for a whole year.'],
            ['bookOpen', 'Pick your writing role', 'Open today\'s lesson: the topic, the rules and a model article.'],
            ['pen', 'Practise and write', 'Answer the questions, then write your own piece with the checklist.']
          ].map(function (s, i) {
            return el('li', { class: 'how-step reveal', style: '--d:' + (i * 120) + 'ms' }, [
              el('span', { class: 'how-step__num', text: String(i + 1) }),
              el('span', { class: 'how-step__icon' }, icon(s[0])),
              el('h3', { text: s[1] }),
              el('p', { text: s[2] })
            ]);
          }))
        ]),

        el('section', { class: 'landing-section', 'aria-labelledby': 'price-h' }, [
          el('div', { class: 'price-card reveal' }, [
            el('p', { class: 'eyebrow', text: 'One simple price' }),
            el('h2', { id: 'price-h', class: 'price-card__amount' }, [el('span', { class: 'price-card__peso', text: '₱1,500' }), el('span', { class: 'price-card__per', text: ' / year' })]),
            el('p', { class: 'muted', text: 'That is about ₱4 a day for all lessons, all seven writing roles, the Library and read aloud.' }),
            el('ul', { class: 'tick-list price-card__list' }, ['365 days of daily lessons', 'Lessons written for your age (9 to 18)'].map(function (x) { return el('li', { text: x }); })),
            acct
              ? el('a', { class: 'btn btn--lg btn--block', href: '#/account' }, [icon('user'), 'Go to my account'])
              : el('button', { type: 'button', class: 'btn btn--lg btn--block btn--glow', 'data-auth': 'signup', onclick: function () { openSignUp(); } }, [icon('wallet'), 'Sign up and pay with GCash'])
          ])
        ])
      ]);
      startTypewriter(rotator, token);
      Motion.reveal(view());
      focusHeading();
    });
  }

  // ---------------------------------------------------------------------------
  // My account: subscription status, pay / renew, change password, sign out, delete
  // ---------------------------------------------------------------------------

  function subscriptionCard(acct) {
    var s = acct.subscription || {};
    var p = acct.payment;
    var pay = function (text) { return el('button', { type: 'button', class: 'btn', 'data-act': 'pay', onclick: function () { openPayment(); } }, [icon('wallet'), text]); };
    var badge, title, body = [], actions = [];
    if (s.state === 'ACTIVE') {
      badge = ['ok', 'Active'];
      title = 'Your lessons are open';
      body.push(el('p', { text: 'Your subscription is active until ' + formatIsoDate(s.paidUntil) + ' (' + s.daysLeft + (s.daysLeft === 1 ? ' day' : ' days') + ' left).' }));
      if (s.renewalPending) body.push(el('p', { class: 'notice notice--info', text: 'We are checking your renewal payment. Your extra year will be added when it is approved.' }));
      actions.push(el('a', { class: 'btn', href: '#/dashboard' }, [icon('bookOpen'), 'Open today\'s lessons']));
      if (s.canRenew) actions.push(pay('Renew for another year'));
    } else if (s.state === 'PENDING_REVIEW') {
      badge = ['wait', 'Checking payment'];
      title = 'We are checking your GCash payment';
      body.push(el('p', { text: 'Reference number ending in ' + String(p && p.referenceNo || '').slice(-4) + ', sent ' + formatIsoDate(p && p.submittedAt) + '. A teacher usually checks payments within one day.' }));
      actions.push(el('button', { type: 'button', class: 'btn', 'data-act': 'refresh', onclick: function () { route(); } }, [icon('replay'), 'Check again']));
      actions.push(el('button', { type: 'button', class: 'btn btn--ghost', 'data-act': 'pay', onclick: function () { openPayment(); } }, 'Fix the reference number'));
    } else if (s.state === 'REJECTED') {
      badge = ['bad', 'Payment not found'];
      title = 'We could not confirm your payment';
      if (p && p.note) body.push(el('p', { class: 'notice notice--warn', text: p.note }));
      body.push(el('p', { text: 'Check the 13-digit reference number on your GCash receipt and send it again.' }));
      actions.push(pay('Send the reference number again'));
    } else if (s.state === 'EXPIRED') {
      badge = ['bad', 'Ended'];
      title = 'Your subscription has ended';
      body.push(el('p', { text: 'It ended on ' + formatIsoDate(s.paidUntil) + '. Renew to open new lessons and the Library again.' }));
      actions.push(pay('Renew for ' + formatPeso(acct.price)));
    } else {
      badge = ['wait', 'Not paid yet'];
      title = 'Subscribe to open the lessons';
      body.push(el('p', { text: 'Pay ' + formatPeso(acct.price) + ' once with GCash for ' + acct.planDays + ' days of lessons.' }));
      actions.push(pay('Pay with GCash'));
    }
    return el('section', { class: 'card sub-card sub-card--' + badge[0], 'aria-labelledby': 'sub-h' }, [
      el('span', { class: 'status-badge status-badge--' + badge[0], text: badge[1] }),
      el('h2', { id: 'sub-h', text: title }),
      body,
      el('div', { class: 'card-actions' }, actions)
    ]);
  }

  function renderAccount(token, query) {
    setView(loadingState('Opening your account…'));
    return ensureAccount(true).then(function (acct) {
      if (token !== renderToken) return;
      if (!acct) { redirect('#/welcome', function () { openSignIn({ next: '#/account' }); }); return; }
      var cur = passwordField('cp-cur', 'Current password', null, 'current-password');
      var nxt = passwordField('cp-new', 'New password', '8 or more characters, with at least one letter and one number.', 'new-password');
      var cpErr = formError();
      var cpBtn = el('button', { type: 'submit', class: 'btn btn--ghost' }, 'Change password');
      var cpForm = el('form', { class: 'card stack-form', 'aria-labelledby': 'cp-h', novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        showFormError(cpErr, '');
        if (!cur.input.value || !nxt.input.value) { showFormError(cpErr, 'Fill in both passwords.'); return; }
        setBusy(cpBtn, true, 'Saving…');
        Api.changePassword(cur.input.value, nxt.input.value).then(function (a) {
          setAccount(a); setBusy(cpBtn, false); cur.input.value = ''; nxt.input.value = '';
          toast('Password changed. Other devices were signed out.');
        }, function (e2) { setBusy(cpBtn, false); showFormError(cpErr, friendlyError(e2)); });
      } }, [el('h2', { id: 'cp-h', text: 'Change password' }), cur.field, nxt.field, cpErr, cpBtn]);

      setView([
        el('header', { class: 'page-head' }, [
          el('h1', { text: 'My account' }),
          el('p', { class: 'muted', text: 'Signed in as ' + acct.username + (acct.age ? ' · lessons for age ' + (State.age || acct.age) : '') })
        ]),
        query && query.need === 'sub' ? el('p', { class: 'notice notice--info', text: 'The lessons open after your yearly subscription is active.' }) : null,
        subscriptionCard(acct),
        el('div', { class: 'two-up' }, [
          cpForm,
          el('section', { class: 'card', 'aria-labelledby': 'priv-h' }, [
            el('h2', { id: 'priv-h', text: 'Your privacy' }),
            el('p', { text: 'We keep only your nickname, a scrambled password, your age and your payment reference numbers. We never ask for your real name, email, phone number or school.' }),
            el('div', { class: 'card-actions' }, [
              el('button', { type: 'button', class: 'btn btn--ghost', 'data-act': 'signout', onclick: signOut }, [icon('logOut'), 'Sign out']),
              el('button', { type: 'button', class: 'btn btn--danger', 'data-act': 'delete', onclick: openDeleteAccount }, [icon('x'), 'Delete my account'])
            ])
          ])
        ])
      ]);
      focusHeading();
    }, function (err) {
      if (token !== renderToken) return;
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  function openDeleteAccount() {
    var pw = passwordField('del-pass', 'Type your password to confirm', null, 'current-password');
    var err = formError();
    var btn = el('button', { type: 'submit', class: 'btn btn--danger btn--block' }, 'Delete my account forever');
    Modal.open({ name: 'delete', title: 'Delete your account?', body: el('form', { class: 'auth-form', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      setBusy(btn, true, 'Deleting…');
      Api.deleteAccount(pw.input.value).then(function () {
        Modal.close(true); setAccount(null); toast('Your account was deleted.'); redirect('#/welcome');
      }, function (e2) { setBusy(btn, false); showFormError(err, friendlyError(e2)); });
    } }, [
      el('p', { text: 'Your nickname, password and age will be erased. Any time left on your subscription will be lost. Payment records keep only the amount and reference number.' }),
      pw.field, err, btn,
      el('button', { type: 'button', class: 'btn btn--ghost btn--block', onclick: function () { Modal.close(); } }, 'Keep my account')
    ]) });
  }

  // ---------------------------------------------------------------------------
  // Generic states
  // ---------------------------------------------------------------------------

  function view() { return $('#view'); }
  function setView(nodes) { var v = view(); v.textContent = ''; appendChildren(v, nodes); Motion.enter(v); }

  function loadingState(message, sub) {
    return el('div', { class: 'state state--loading', role: 'status' }, [
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('p', { class: 'state__title', text: message }),
      sub ? el('p', { class: 'state__sub', text: sub }) : null
    ]);
  }

  function errorState(message, onRetry, extra) {
    return el('div', { class: 'state state--error', role: 'alert' }, [
      el('div', { class: 'state__icon' }, icon('alert')),
      el('p', { class: 'state__title', text: 'Something went wrong' }),
      el('p', { text: message }),
      extra || null,
      onRetry ? el('button', { type: 'button', class: 'btn', onclick: onRetry }, 'Try again') : null
    ]);
  }

  function emptyState(title, message, action) {
    return el('div', { class: 'state state--empty', role: 'status' }, [
      el('div', { class: 'state__icon' }, icon('inbox')),
      el('p', { class: 'state__title', text: title }),
      el('p', { text: message }),
      action || null
    ]);
  }

  function setupNeededView() {
    return el('div', { class: 'state state--error' }, [
      el('div', { class: 'state__icon' }, icon('wrench')),
      el('h1', { class: 'state__title', text: 'Almost ready!' }),
      el('p', { text: 'This site is not connected to its Apps Script server yet. A teacher or administrator needs to paste the Web App URL into config.js.' })
    ]);
  }

  function focusHeading() {
    var h = view().querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function friendlyError(err) { return Api.friendly(err); }

  function setDateline(ymd) {
    $('#dateline').textContent = 'Philippine edition · ' + formatLongDate(ymd);
  }

  // ---------------------------------------------------------------------------
  // Age picker
  // ---------------------------------------------------------------------------

  function agePicker(current, onPick, opts) {
    opts = opts || {};
    return el('section', { class: 'card age-picker' + (opts.prominent ? ' age-picker--prominent' : ''), 'aria-labelledby': 'age-picker-h' }, [
      el('div', { class: 'age-picker__head' }, [
        el('span', { class: 'round-icon' }, icon('user')),
        el('div', null, [
          el('h2', { id: 'age-picker-h', text: opts.title || 'How old are you?' }),
          el('p', { class: 'muted', text: current
            ? 'Lessons are written for ' + current + '-year-old writers' + (gradeFor(current) ? ' (' + gradeFor(current) + ')' : '') + '. Tap another age to change.'
            : 'Pick your age so the topics and sample articles fit you. We only keep it on this device.' })
        ])
      ]),
      el('div', { class: 'age-picker__options', role: 'radiogroup', 'aria-labelledby': 'age-picker-h' }, agesList().map(function (a) {
        var selected = a === current;
        return el('button', {
          type: 'button', class: 'age-btn' + (selected ? ' is-selected' : ''), role: 'radio',
          'aria-checked': selected ? 'true' : 'false', 'aria-label': a + ' years old', onclick: function () { onPick(a); }
        }, [el('span', { class: 'age-btn__num', text: String(a) }), el('span', { class: 'age-btn__unit', text: 'years' })]);
      }))
    ]);
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  function renderDashboard(token) {
    setView(loadingState('Gathering today\'s writing lessons…'));
    return loadRoles().then(function () {
      if (token !== renderToken) return;
      var age = State.age;
      var date = manilaParts().ymd;
      var summary = age ? Api.getTodayLessons(age).then(function (s) { return { s: s }; }, function (e) { return { err: e }; }) : Promise.resolve({});
      return summary.then(function (res) {
        if (token !== renderToken) return;
        var byRole = {};
        if (res.s) { date = res.s.date; res.s.roles.forEach(function (r) { byRole[r.role] = r; }); }
        setDateline(date);
        var lastRole = storageGet('jw.lastRole');
        var ready = Object.keys(byRole).filter(function (k) { return byRole[k].status === 'READY'; }).length;
        var statusText = { READY: 'Lesson ready', PENDING: 'Being prepared…', FAILED: 'Not ready yet', NOT_STARTED: 'Tap to open today\'s lesson', UNKNOWN: 'Tap to open' };

        var grid = el('ul', { class: 'role-grid' }, State.roles.map(function (role) {
          var st = byRole[role.id] || { status: 'UNKNOWN', title: '' };
          return el('li', null, el('a', { href: lessonHref(role.id, age), class: 'role-card' + (role.id === lastRole ? ' role-card--last' : ''), 'data-status': st.status }, [
            el('span', { class: 'role-card__icon role-icon--' + role.id }, roleIcon(role)),
            el('span', { class: 'role-card__body' }, [
              el('span', { class: 'role-card__name', text: role.name }),
              el('span', { class: 'role-card__short', text: role.short }),
              st.title ? el('span', { class: 'role-card__topic' }, [el('span', { class: 'kicker', text: 'Today: ' }), st.title]) : null,
              el('span', { class: 'role-card__status status--' + String(st.status).toLowerCase(), text: statusText[st.status] || 'Tap to open' })
            ])
          ]));
        }));

        setView([
          el('section', { class: 'hero' }, [
            el('img', { class: 'hero__logo', src: LOGO_SRC, alt: 'Journalism Writer logo', width: 384, height: 384 }),
            el('div', { class: 'hero__body' }, [
              el('p', { class: 'eyebrow', text: formatLongDate(date) }),
              el('h1', { class: 'hero__title', text: greeting() + ', ' + (State.account ? State.account.username : 'young journalist') + '!' }),
              el('p', { class: 'hero__lead', text: 'Every day there is a new topic and a model article for each kind of writing. Learn the rules, read the sample, then write your own.' })
            ])
          ]),
          agePicker(age, function (a) { setAge(a); route(); }, { prominent: !age }),
          age ? el('section', { class: 'section', 'aria-labelledby': 'roles-h' }, [
            el('div', { class: 'section__head' }, [
              el('h2', { id: 'roles-h', text: 'Today\'s lessons for age ' + age }),
              res.err ? null : el('p', { class: 'muted', text: ready + ' of ' + State.roles.length + ' ready' })
            ]),
            res.err ? el('p', { class: 'notice notice--warn', role: 'status', text: 'We could not check today\'s lessons (' + friendlyError(res.err) + ') You can still open any writing role.' }) : null,
            grid
          ]) : null
        ]);
        focusHeading();
      });
    }, function (err) {
      if (token !== renderToken) return;
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  // ---------------------------------------------------------------------------
  // Today's lesson (saved first; polls while being prepared)
  // ---------------------------------------------------------------------------

  function lessonToolbar(activeRole, activeAge) {
    var roleSel = el('select', { id: 'role-switch', onchange: function (e) { location.hash = lessonHref(e.target.value, activeAge); } },
      State.roles.map(function (r) { return el('option', { value: r.id, selected: r.id === activeRole }, r.name); }));
    var ageSel = el('select', { id: 'age-switch', onchange: function (e) { var a = validAge(e.target.value); setAge(a); location.hash = lessonHref(activeRole, a); } },
      agesList().map(function (a) { return el('option', { value: String(a), selected: a === activeAge }, a + ' years old'); }));
    return el('div', { class: 'toolbar' }, [
      el('a', { href: '#/dashboard', class: 'backlink' }, [icon('arrowLeft'), 'All writing roles']),
      el('div', { class: 'toolbar__selects' }, [
        el('label', { for: 'role-switch', class: 'field' }, [el('span', { text: 'Writing role' }), roleSel]),
        el('label', { for: 'age-switch', class: 'field field--age' }, [el('span', { text: 'Age' }), ageSel])
      ])
    ]);
  }

  function renderTodayLesson(token, roleId, query) {
    setView(loadingState('Opening the lesson…'));
    return loadRoles().then(function () {
      if (token !== renderToken) return;
      var role = State.rolesById[roleId];
      if (!role) { renderNotFound(); return; }
      storageSet('jw.lastRole', role.id);
      var age = validAge(query && query.age) || State.age;
      if (!age) {
        setView([
          el('div', { class: 'toolbar' }, el('a', { href: '#/dashboard', class: 'backlink' }, [icon('arrowLeft'), 'All writing roles'])),
          el('h1', { class: 'page-title', text: role.name }),
          agePicker(null, function (a) { setAge(a); location.hash = lessonHref(role.id, a); }, { prominent: true, title: 'First, how old are you?' })
        ]);
        focusHeading();
        return;
      }
      if (age !== State.age) setAge(age);
      var bar = function () { return lessonToolbar(role.id, age); };
      setView([bar(), loadingState('Getting today\'s ' + role.genre.toLowerCase() + ' lesson…', 'If nobody has opened it yet today, it can take up to a minute to prepare.')]);

      var attempt = 0;
      var poll = function () {
        attempt++;
        return Api.getTodayLesson(role.id, age).then(function (data) {
          if (token !== renderToken) return;
          setDateline(data.date);
          if (data.status === 'READY') {
            setView([bar(), renderLesson(data.lesson, role, { context: 'today', requestedAge: age })]);
            focusHeading();
            return;
          }
          if (data.status === 'GENERATING' && attempt <= CONFIG.MAX_POLLS) return waitAndPoll(data.retryAfterMs);
          if (data.status === 'GENERATING') {
            setView([bar(), errorState('The lesson is taking longer than usual. Please try again in a few minutes.', function () { route(); })]);
            return;
          }
          var libLink = el('p', null, el('a', { href: '#/library?role=' + encodeURIComponent(role.id) }, 'Practise with a saved ' + role.genre.toLowerCase() + ' lesson from the Library'));
          setView([bar(), errorState(data.message || 'Today\'s lesson is not ready yet.', data.canRetry ? function () { route(); } : null, libLink)]);
        }, function (err) {
          if (token !== renderToken) return;
          // The server keeps working after a slow first-time generation; check again instead of failing.
          if (err.code === 'TIMEOUT' && attempt <= CONFIG.MAX_POLLS) return waitAndPoll(3000);
          setView([bar(), errorState(friendlyError(err), function () { route(); })]);
        });
      };
      var waitAndPoll = function (ms) {
        setView([bar(), loadingState('The editor is preparing today\'s ' + role.genre.toLowerCase() + ' lesson…', 'This page will update by itself. Please wait.')]);
        return sleep(Math.max(3000, Math.min(ms || CONFIG.POLL_INTERVAL_MS, 15000))).then(function () {
          if (token === renderToken) return poll();
        });
      };
      return poll();
    }, function (err) {
      if (token !== renderToken) return;
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  // ---------------------------------------------------------------------------
  // Lesson screen
  //   1 role + date · 2 topic + background · 3 Learn the Rules (paragraph guide)
  //   4 Sample Article · 5 explanation under each paragraph · 6 Practice · 7 Save on this device
  //   (then sources, labeled honestly)
  // ---------------------------------------------------------------------------

  function renderLesson(record, role, opts) {
    var L = record && record.lesson;
    if (!L || !L.writing_rules || !L.sample_article) return errorState('This saved lesson cannot be shown.');
    var meta = record.meta || {};
    var wr = L.writing_rules;
    var sa = L.sample_article;
    var unit = role.paragraphGuide && role.paragraphGuide.unit === 'sentence' ? 'sentence' : 'paragraph';
    var Unit = unit.charAt(0).toUpperCase() + unit.slice(1);
    var items = { topic: [], rules: [], sample: [], practice: [] };
    var track = function (group, node, text) { items[group].push({ el: node, text: text }); return node; };

    // 1. Role and date
    var titleEl = el('h1', { class: 'lesson-head__title', text: L.title });
    var header = el('header', { class: 'lesson-head' }, [
      el('p', { class: 'lesson-head__meta' }, [
        el('span', { class: 'chip chip--role' }, [roleIcon(role), role.name]),
        el('span', { class: 'chip' }, [icon('calendar'), (opts.context === 'today' ? 'Today · ' : '') + formatLongDate(record.date)]),
        el('span', { class: 'chip chip--age' }, [icon('user'), record.age ? 'For age ' + record.age : 'For ages 10–12']),
        record.topicCategory ? el('span', { class: 'chip chip--cat', text: record.topicCategory }) : null
      ]),
      titleEl,
      opts.requestedAge && record.age !== opts.requestedAge
        ? el('p', { class: 'notice notice--info', text: 'This sample lesson was written for ' + (record.age ? record.age + '-year-olds' : 'learners aged 10 to 12') + ', not for age ' + opts.requestedAge + '. The live server writes a separate lesson for each age.' })
        : null
    ]);

    var nav = el('nav', { class: 'lesson-nav', 'aria-label': 'Jump to a part of the lesson' }, [
      ['topic', 'Topic'], ['rules', 'Rules'], ['sample', 'Sample'], ['practice', 'Practice']
    ].map(function (p) {
      return el('a', { href: '#sec-' + p[0], onclick: function (e) {
        e.preventDefault();
        var t = document.getElementById('sec-' + p[0]);
        if (t) { t.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }); t.focus({ preventScroll: true }); }
      } }, p[1]);
    }));

    // 2. Today's topic and short background
    var topicTitle = track('topic', el('p', { class: 'topic__title', text: L.topic }), 'Today\'s topic: ' + L.topic + '.');
    var topicBg = track('topic', el('p', { class: 'topic__bg' }, richText(L.topic_background)), L.topic_background);
    var topic = el('section', { id: 'sec-topic', class: 'card', tabindex: '-1', 'aria-labelledby': 'h-topic' }, [
      el('h2', { id: 'h-topic' }, [el('span', { class: 'step', text: '1' }), 'Today\'s topic']),
      topicTitle,
      topicBg,
      speechBar('topic', 'Topic Background', function () { return items.topic; })
    ]);

    // 3. Learn the Rules (genre essentials from the curated role data + this lesson's paragraph guide)
    var purposeEl = track('rules', el('p', { class: 'lead-text', text: wr.purpose }), 'Learn the rules for the ' + role.name + '. ' + wr.purpose);
    var essentials = el('div', { class: 'essentials' }, [
      el('h3', { text: 'The ' + role.genre.toLowerCase() + ' at a glance' }),
      track('rules', el('ul', { class: 'tick-list' }, role.structure.map(function (s) { return el('li', { text: s }); })), 'The usual structure: ' + role.structure.join('. ') + '.')
    ]);
    var lengthEl = track('rules', el('p', { class: 'pill' }, [icon('list'), el('strong', { text: wr.recommended_paragraphs + ' ' + unit + 's' }), ' recommended. This is a guide, not a strict rule.']),
      'Recommended length: ' + wr.recommended_paragraphs + ' ' + unit + 's.');
    var guide = el('ol', { class: 'guide' }, wr.structure.map(function (s) {
      var li = el('li', { class: 'guide__item' }, [
        el('span', { class: 'guide__num', 'aria-hidden': 'true', text: String(s.paragraph) }),
        el('div', null, [
          el('h4', { class: 'guide__purpose' }, [el('span', { class: 'sr-only', text: Unit + ' ' + s.paragraph + ': ' }), s.purpose]),
          el('p', null, [el('strong', { text: 'What to include: ' }), s.instructions]),
          el('p', { class: 'muted' }, [el('strong', { text: 'What it does: ' }), s.example_function])
        ])
      ]);
      return track('rules', li, Unit + ' ' + s.paragraph + ', ' + s.purpose + '. ' + s.instructions + ' ' + s.example_function);
    }));
    var toneEl = track('rules', el('div', { class: 'two-col' }, [
      el('div', null, [el('h3', { text: 'Tone' }), el('p', { text: wr.tone })]),
      el('div', null, [el('h3', { text: 'Language' }), el('p', { text: role.language })])
    ]), 'Tone: ' + wr.tone + '. Language: ' + role.language);
    var mistakesEl = track('rules', el('ul', { class: 'x-list' }, wr.common_mistakes.map(function (m) { return el('li', null, [icon('x'), el('span', { text: m })]); })),
      'Common mistakes to avoid: ' + wr.common_mistakes.join('. ') + '.');
    var checklistEl = track('rules', el('ul', { class: 'checklist' }, wr.checklist.map(function (m, i) {
      var id = 'chk-' + record.lessonId + '-' + i;
      return el('li', null, el('label', { for: id }, [el('input', { type: 'checkbox', id: id }), el('span', { text: m })]));
    })), 'Checklist: ' + wr.checklist.join(' '));

    var rules = el('section', { id: 'sec-rules', class: 'card', tabindex: '-1', 'aria-labelledby': 'h-rules' }, [
      el('h2', { id: 'h-rules' }, [el('span', { class: 'step', text: '2' }), 'Learn the rules: ' + role.genre]),
      purposeEl,
      essentials,
      el('h3', { text: Unit + '-by-' + unit + ' guide' }),
      lengthEl,
      guide,
      toneEl,
      el('h3', { text: 'Common mistakes' }), mistakesEl,
      el('h3', { text: 'Checklist for your own writing' }), checklistEl,
      el('p', { class: 'notice notice--info' }, [el('strong', { text: 'Facts and opinions: ' }), role.factOpinionNote]),
      speechBar('rules', 'Writing Rules', function () { return items.rules; })
    ]);

    // 4–5. Sample article with numbered paragraphs, and an explanation under each paragraph
    var headlineEl = track('sample', el('h3', { class: 'article__headline', text: sa.headline }), 'Sample ' + role.genre.toLowerCase() + '. Headline: ' + sa.headline + '.');
    var article = el('div', { class: 'article' + (role.id === 'caption' ? ' article--caption' : '') });
    if (role.id === 'caption') {
      article.appendChild(el('figure', { class: 'photo-frame' }, [el('div', { class: 'photo-frame__img' }, icon('camera')), el('figcaption', null, richText(L.topic_background))]));
    }
    article.appendChild(headlineEl);
    var paraList = el('ol', { class: 'article__paras' });
    sa.paragraphs.forEach(function (p) {
      var s = wr.structure[p.number - 1];
      var textEl = el('p', { class: 'article__text' }, richText(p.text));
      paraList.appendChild(el('li', { class: 'article__para' }, [
        el('span', { class: 'article__num', 'aria-hidden': 'true', text: String(p.number) }),
        el('div', { class: 'article__content' }, [
          el('span', { class: 'sr-only', text: Unit + ' ' + p.number + '. ' }),
          track('sample', textEl, p.text),
          el('div', { class: 'explain' }, [
            el('p', { class: 'explain__label' }, [icon('help'), 'Why this ' + unit + ' is here' + (s ? ': ' + s.purpose : '')]),
            el('p', { class: 'explain__text', text: p.purpose })
          ])
        ])
      ]));
    });
    article.appendChild(paraList);
    var sample = el('section', { id: 'sec-sample', class: 'card card--article', tabindex: '-1', 'aria-labelledby': 'h-sample' }, [
      el('h2', { id: 'h-sample' }, [el('span', { class: 'step', text: '3' }), 'Sample ' + role.genre.toLowerCase()]),
      meta.fictional ? el('p', { class: 'notice notice--fiction' }, [icon('pin'), el('span', null, [el('strong', { text: 'Fictional example. ' }), 'The people, places and events in this sample are made up for practice.'])]) : null,
      article,
      el('div', { class: 'learn-box' }, [el('h3', null, [icon('bulb'), 'What to learn from this example']), el('p', { text: sa.conclusion })]),
      el('p', { class: 'muted small' }, ['Text in ', el('span', { class: 'reporter-note', text: '[brackets]' }), ' shows where a real reporter would add checked information, like a quote from a real interview or an official score.']),
      speechBar('sample', 'Sample Article', function () { return items.sample; })
    ]);

    // 6. Practice questions + writing challenge
    var challenge = 'Now write your own ' + role.genre.toLowerCase() + ' about ' + L.topic.charAt(0).toLowerCase() + L.topic.slice(1).replace(/\.$/, '') +
      ' in about ' + wr.recommended_paragraphs + ' ' + unit + 's. Follow the guide, then use the checklist.';
    var practice = el('section', { id: 'sec-practice', class: 'card', tabindex: '-1', 'aria-labelledby': 'h-practice' }, [
      el('h2', { id: 'h-practice' }, [el('span', { class: 'step', text: '4' }), 'Practice questions']),
      el('p', { class: 'muted', text: 'Think of your answer first, then check.' }),
      el('ol', { class: 'practice' }, L.practice_questions.map(function (q, i) {
        var ansId = 'ans-' + record.lessonId + '-' + i;
        var qEl = track('practice', el('p', { class: 'practice__q', text: q.question }), 'Question ' + (i + 1) + '. ' + q.question);
        var answer = el('p', { class: 'practice__answer', id: ansId, hidden: true }, [icon('checkCircle'), el('span', { text: q.answer })]);
        var btn = el('button', { type: 'button', class: 'btn btn--small btn--ghost', 'aria-expanded': 'false', 'aria-controls': ansId }, 'Show answer');
        btn.addEventListener('click', function () {
          var show = answer.hidden;
          answer.hidden = !show;
          btn.setAttribute('aria-expanded', show ? 'true' : 'false');
          btn.textContent = show ? 'Hide answer' : 'Show answer';
        });
        return el('li', { class: 'practice__item' }, [qEl, btn, answer]);
      })),
      el('div', { class: 'challenge' }, [el('h3', null, [icon('pen'), 'Your turn']), el('p', { text: challenge })])
    ]);

    // 7. Save on this device (bookmarks are device-only; no accounts, no personal data)
    var saved = Bookmarks.has(record.lessonId);
    var bmBtn = el('button', { type: 'button', class: 'btn btn--ghost bookmark-btn', 'aria-pressed': saved ? 'true' : 'false' });
    var paintBm = function (on) { bmBtn.textContent = ''; appendChildren(bmBtn, [icon('bookmark'), on ? 'Saved on this device' : 'Save this lesson']); bmBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    paintBm(saved);
    bmBtn.addEventListener('click', function () {
      var on = Bookmarks.toggle(Object.assign({}, record, { title: L.title }));
      paintBm(on);
      toast(on ? 'Saved. Find it in the Library under "Saved on this device".' : 'Removed from this device\'s saved lessons.');
    });
    var save = el('section', { class: 'card card--save', 'aria-labelledby': 'h-save' }, [
      el('h2', { id: 'h-save' }, [el('span', { class: 'step', text: '5' }), 'Save for later']),
      el('p', { class: 'muted', text: 'Saved lessons are remembered on this device only, as a quick list in the Library.' }),
      bmBtn
    ]);

    // Sources (honest labels: places to learn more, not proof of every sentence)
    var checks = {};
    (meta.sourceChecks || []).forEach(function (s) { checks[s.url] = s; });
    var label = function (url) {
      var s = checks[url] || {};
      if (s.check === 'retrieved') return 'Opened and checked during research' + (s.retrievedOn ? ' on ' + formatShortDate(s.retrievedOn) : '');
      if (s.check === 'reachable') return 'Trusted organization website · link checked';
      return 'Trusted organization website';
    };
    var sources = el('section', { class: 'card card--sources', 'aria-labelledby': 'h-sources' }, [
      el('h2', { id: 'h-sources', text: 'Where to learn more' }),
      el('ul', { class: 'source-list' }, (L.sources || []).map(function (s) {
        return el('li', null, [
          el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, [s.title, icon('external', 'icon--sm'), el('span', { class: 'sr-only', text: ' (opens in a new tab)' })]),
          el('span', { class: 'source-list__label', text: label(s.url) })
        ]);
      })),
      el('p', { class: 'muted small', text: meta.research
        ? 'These pages were opened while preparing this lesson. Pages can change, so check facts with your teacher before you publish.'
        : 'These trusted websites cover the general subject. They are places to learn more, not proof of every sentence. Check facts with your teacher before you publish.' })
    ]);

    var full = speechBar('full', 'Full Lesson', function () {
      return [{ el: titleEl, text: 'Lesson: ' + L.title + '.' }].concat(items.topic, items.rules, items.sample, items.practice);
    });
    full.classList.add('speech--full');

    return el('article', { class: 'lesson' }, [header, full, nav, topic, rules, sample, practice, save, sources]);
  }

  // ---------------------------------------------------------------------------
  // Library
  // ---------------------------------------------------------------------------

  function libraryCard(it) {
    var role = State.rolesById[it.role] || { icon: 'newspaper', name: it.roleName || it.role };
    var saved = Bookmarks.has(it.lessonId || it.id);
    return el('li', null, el('a', { class: 'lib-card', href: '#/library/' + encodeURIComponent(it.lessonId || it.id) }, [
      el('span', { class: 'lib-card__top' }, [
        el('span', { class: 'lib-card__role role-icon--' + it.role }, roleIcon(role)),
        el('span', { class: 'lib-card__title', text: it.title }),
        saved ? el('span', { class: 'lib-card__saved', title: 'Saved on this device' }, [icon('bookmark'), el('span', { class: 'sr-only', text: 'Saved on this device' })]) : null
      ]),
      el('span', { class: 'lib-card__meta' }, [
        el('span', { class: 'chip chip--role', text: role.name }),
        it.age ? el('span', { class: 'chip chip--age', text: 'Age ' + it.age }) : null,
        it.topicCategory ? el('span', { class: 'chip chip--cat', text: it.topicCategory }) : null
      ]),
      el('span', { class: 'lib-card__date' }, [icon('calendar'), 'Created ', el('time', { datetime: String(it.createdAt || it.date || '').slice(0, 10), text: formatShortDate(it.createdAt || it.date) })]),
      el('span', { class: 'lib-card__open' }, ['Open lesson', icon('arrowLeft', 'icon--flip')])
    ]));
  }

  function renderLibrary(token, query) {
    setView(loadingState('Opening the Library…'));
    return loadRoles().then(function () {
      if (token !== renderToken) return;
      var f = State.library.filters;
      if (query && query.role && (query.role === 'all' || State.rolesById[query.role])) f.role = query.role;
      if (query && query.age && (query.age === 'all' || validAge(query.age))) f.age = query.age;
      if (query && query.saved === '1') f.saved = true;

      var today = manilaParts().ymd;
      var qInput = el('input', { type: 'search', id: 'f-q', value: f.q, placeholder: 'Search by title or topic', maxlength: 80, autocomplete: 'off' });
      var roleSel = el('select', { id: 'f-role' }, [el('option', { value: 'all', text: 'All writing roles' })].concat(State.roles.map(function (r) { return el('option', { value: r.id, selected: f.role === r.id, text: r.name }); })));
      var fromInput = el('input', { type: 'date', id: 'f-from', value: f.from, max: today });
      var toInput = el('input', { type: 'date', id: 'f-to', value: f.to, max: today });
      var ageSel = el('select', { id: 'f-age' }, [el('option', { value: 'all', text: 'All ages' })].concat(agesList().map(function (a) { return el('option', { value: String(a), selected: String(f.age) === String(a), text: a + ' years old' }); })));
      var catSel = el('select', { id: 'f-cat' }, [el('option', { value: 'all', text: 'All topics' })].concat(State.categories.map(function (c) { return el('option', { value: c, selected: f.category === c, text: c }); })));
      var savedBox = el('input', { type: 'checkbox', id: 'f-saved', checked: !!f.saved });
      var results = el('div', { class: 'library-results' });
      var countLine = el('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
      var moreBtn = el('button', { type: 'button', class: 'btn btn--ghost', hidden: true }, 'Load more lessons');

      var read = function () {
        f.q = qInput.value.trim(); f.role = roleSel.value; f.from = fromInput.value; f.to = toInput.value;
        f.age = ageSel.value; f.category = catSel.value; f.saved = savedBox.checked;
      };
      var anyFilter = function () { return f.q || f.role !== 'all' || f.from || f.to || f.age !== 'all' || f.category !== 'all' || f.saved; };
      var clear = function () {
        qInput.value = ''; roleSel.value = 'all'; fromInput.value = ''; toInput.value = ''; ageSel.value = 'all'; catSel.value = 'all'; savedBox.checked = false;
        load(true);
      };

      var draw = function () {
        results.textContent = '';
        var items = State.library.items;
        var t = State.library.total;
        countLine.textContent = t === null || t === undefined ? 'Showing ' + items.length + ' lessons, newest first' : (t === 1 ? '1 lesson found' : t + ' lessons found');
        moreBtn.hidden = !State.library.hasMore;
        if (!items.length) {
          results.appendChild(emptyState(
            f.saved ? 'No saved lessons yet' : (anyFilter() ? 'No lessons match' : 'The Library is still empty'),
            f.saved ? 'Open a lesson and press "Save this lesson" to keep it here on this device.' : (anyFilter() ? 'Try different words, another writing role, or a wider date range.' : 'Lessons appear here after they are prepared each morning.'),
            anyFilter() ? el('button', { type: 'button', class: 'btn btn--ghost', onclick: clear }, 'Clear filters') : el('a', { class: 'btn', href: '#/dashboard' }, 'Go to today\'s lessons')
          ));
          return;
        }
        results.appendChild(el('ul', { class: 'lib-list' }, items.map(libraryCard)));
      };

      var loadSaved = function () {
        // Saved-on-this-device view: filters the local bookmark list (ids + titles only).
        var q = f.q.toLowerCase();
        var list = Bookmarks.list().filter(function (b) {
          if (f.role !== 'all' && b.role !== f.role) return false;
          if (f.age !== 'all' && String(b.age) !== String(f.age)) return false;
          if (f.from && b.date < f.from) return false;
          if (f.to && b.date > f.to) return false;
          if (q && String(b.title).toLowerCase().indexOf(q) === -1) return false;
          return true;
        }).map(function (b) { return { lessonId: b.id, title: b.title, role: b.role, age: b.age, date: b.date, createdAt: b.date }; });
        State.library.items = list; State.library.total = list.length; State.library.hasMore = false; State.library.page = 1;
        draw();
      };

      var load = function (reset) {
        read();
        if (f.from && f.to && f.from > f.to) {
          results.textContent = '';
          results.appendChild(errorState('The "From" date must be on or before the "To" date.'));
          countLine.textContent = ''; moreBtn.hidden = true;
          return Promise.resolve();
        }
        if (f.saved) { loadSaved(); return Promise.resolve(); }
        var page = reset ? 1 : State.library.page + 1;
        if (reset) { results.textContent = ''; results.appendChild(loadingState('Searching the Library…')); countLine.textContent = ''; }
        moreBtn.disabled = true;
        return Api.getLibrary({ role: f.role, age: f.age, category: f.category, from: f.from, to: f.to, q: f.q, page: page, pageSize: CONFIG.LIBRARY_PAGE_SIZE }).then(function (data) {
          if (token !== renderToken) return;
          State.library.items = reset ? data.items : State.library.items.concat(data.items);
          State.library.page = data.page; State.library.hasMore = data.hasMore; State.library.total = data.total;
          moreBtn.disabled = false;
          draw();
        }, function (err) {
          if (token !== renderToken) return;
          moreBtn.disabled = false;
          if (reset) { results.textContent = ''; results.appendChild(errorState(friendlyError(err), function () { load(true); })); countLine.textContent = ''; }
          else toast(friendlyError(err));
        });
      };

      [roleSel, fromInput, toInput, ageSel, catSel, savedBox].forEach(function (c) { c.addEventListener('change', function () { load(true); }); });
      qInput.addEventListener('input', debounce(function () { load(true); }, 400));
      moreBtn.addEventListener('click', function () { load(false); });

      setView([
        el('header', { class: 'page-head' }, [
          el('h1', { text: 'Writers Library' }),
          el('p', { class: 'muted', text: 'Every saved lesson, exactly as it was saved. Search, filter, and open any lesson to read it again.' })
        ]),
        el('form', { class: 'card filters', role: 'search', 'aria-label': 'Search the Library', onsubmit: function (e) { e.preventDefault(); load(true); } }, [
          el('label', { for: 'f-q', class: 'field field--wide' }, [el('span', { text: 'Search' }), el('span', { class: 'input-icon' }, [icon('search'), qInput])]),
          el('label', { for: 'f-role', class: 'field' }, [el('span', { text: 'Writing role' }), roleSel]),
          el('label', { for: 'f-from', class: 'field' }, [el('span', { text: 'From date' }), fromInput]),
          el('label', { for: 'f-to', class: 'field' }, [el('span', { text: 'To date' }), toInput]),
          el('label', { for: 'f-age', class: 'field' }, [el('span', { text: 'Age' }), ageSel]),
          el('label', { for: 'f-cat', class: 'field' }, [el('span', { text: 'Topic' }), catSel]),
          el('label', { for: 'f-saved', class: 'field field--check field--wide' }, [savedBox, el('span', { text: 'Only lessons saved on this device' })]),
          el('div', { class: 'filters__actions field--wide' }, [
            el('button', { type: 'submit', class: 'btn' }, [icon('search'), 'Search']),
            el('button', { type: 'button', class: 'btn btn--ghost', onclick: clear }, 'Clear')
          ])
        ]),
        countLine,
        results,
        el('div', { class: 'center' }, moreBtn)
      ]);
      focusHeading();
      return load(true);
    }, function (err) {
      if (token !== renderToken) return;
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  /** Opens a saved lesson by id. Reads the saved record only (getLessonById never generates). */
  function renderLibraryDetail(token, id) {
    setView(loadingState('Opening the saved lesson…'));
    var back = el('div', { class: 'toolbar' }, el('a', { href: '#/library', class: 'backlink' }, [icon('arrowLeft'), 'Back to the Library']));
    return loadRoles().then(function () { return Api.getLessonById(id); }).then(function (data) {
      if (token !== renderToken) return;
      var role = State.rolesById[data.lesson.role];
      if (!role) throw { name: 'ApiError', code: 'BAD_ROLE', message: 'This lesson belongs to an unknown writing role.' };
      setDateline(data.lesson.date);
      setView([back, renderLesson(data.lesson, role, { context: 'library' })]);
      focusHeading();
    }).catch(function (err) {
      if (token !== renderToken) return;
      var gone = err && (err.code === 'NOT_FOUND' || err.code === 'BAD_ID');
      setView([back, errorState(friendlyError(err), gone ? null : function () { route(); })]);
    });
  }

  // ---------------------------------------------------------------------------
  // Teacher / Admin (the server checks the admin key on every request)
  //   1. GCash payments to check   2. Lesson status / retry   3. Reset a pupil's password
  // ---------------------------------------------------------------------------

  function renderAdmin(token) {
    setView(loadingState('Loading…'));
    return loadRoles().then(function () {
      if (token !== renderToken) return;
      var today = manilaParts().ymd;
      var keyInput = el('input', { type: 'password', id: 'a-key', autocomplete: 'off', value: State.adminKey, minlength: 16 });
      var needKey = function () {
        State.adminKey = keyInput.value;
        if (State.adminKey.length < 16) { toast('Enter the admin key (16 or more characters).'); keyInput.focus(); return false; }
        return true;
      };

      // ---- 1. GCash payments ----
      var payStatus = el('select', { id: 'a-pay-status' }, [['PENDING', 'Waiting for checking'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All payments']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      var payOut = el('div', { class: 'admin-out', 'aria-live': 'polite' });
      var payBtn = el('button', { type: 'button', class: 'btn', id: 'a-pay-load' }, [icon('wallet'), 'Show payments']);
      var loadPayments = function () {
        if (!needKey()) return;
        payBtn.disabled = true; payOut.textContent = ''; payOut.appendChild(loadingState('Loading payments…'));
        Api.adminPayments(State.adminKey, payStatus.value).then(function (d) {
          payOut.textContent = '';
          if (!d.payments.length) { payOut.appendChild(emptyState('No payments here', payStatus.value === 'PENDING' ? 'Nothing is waiting to be checked.' : 'No payments match.')); return; }
          payOut.appendChild(paymentsTable(d.payments));
        }, function (err) { payOut.textContent = ''; payOut.appendChild(errorState(friendlyError(err))); }).then(function () { payBtn.disabled = false; });
      };
      payBtn.addEventListener('click', loadPayments);

      var paymentsTable = function (rows) {
        return el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table admin-table--pay' }, [
          el('caption', { class: 'sr-only', text: 'GCash payments' }),
          el('thead', null, el('tr', null, ['Sent', 'Nickname', 'GCash Ref. No.', 'Amount', 'Status', 'Action'].map(function (h) { return el('th', { scope: 'col', text: h }); }))),
          el('tbody', null, rows.map(function (p) {
            var actions = el('td', { class: 'admin-actions' });
            if (p.status === 'PENDING') {
              var note = el('input', { type: 'text', maxlength: 200, id: 'note-' + p.paymentId, placeholder: 'Reason (shown to the pupil)' });
              var approve = el('button', { type: 'button', class: 'btn btn--small', 'data-act': 'approve' }, [icon('checkCircle'), 'Approve']);
              var reject = el('button', { type: 'button', class: 'btn btn--small btn--danger', 'data-act': 'reject' }, [icon('x'), 'Reject']);
              var armed = null;
              var review = function (decision, btn) {
                if (armed !== decision) { // two-step: avoid approving the wrong row by accident
                  armed = decision;
                  btn.textContent = ''; appendChildren(btn, decision === 'APPROVE' ? 'Confirm: ₱' + p.amount + ' received' : 'Confirm reject');
                  setTimeout(function () { if (armed === decision && btn.isConnected) { armed = null; btn.textContent = ''; appendChildren(btn, [icon(decision === 'APPROVE' ? 'checkCircle' : 'x'), decision === 'APPROVE' ? 'Approve' : 'Reject']); } }, 5000);
                  return;
                }
                approve.disabled = true; reject.disabled = true;
                Api.adminReviewPayment(State.adminKey, p.paymentId, decision, note.value).then(function (d) {
                  toast(decision === 'APPROVE' ? p.username + ': subscription active until ' + formatIsoDate(d.payment.periodEnd) + '.' : p.username + ': payment rejected.');
                  loadPayments();
                }, function (err) { toast(friendlyError(err)); approve.disabled = false; reject.disabled = false; });
              };
              approve.addEventListener('click', function () { review('APPROVE', approve); });
              reject.addEventListener('click', function () { review('REJECT', reject); });
              appendChildren(actions, [el('label', { for: note.id, class: 'sr-only', text: 'Reason for ' + p.username }), note, el('span', { class: 'admin-actions__btns' }, [approve, reject])]);
            } else {
              actions.textContent = p.status === 'APPROVED' ? 'Active until ' + formatIsoDate(p.periodEnd) : (p.note || '—');
            }
            return el('tr', null, [
              el('td', { text: formatIsoDate(p.submittedAt) }),
              el('td', { text: p.username }),
              el('td', { class: 'mono', text: p.referenceNo }),
              el('td', { text: formatPeso(p.amount) }),
              el('td', null, el('span', { class: 'status-pill status--' + String(p.status).toLowerCase(), text: p.status })),
              actions
            ]);
          }))
        ]));
      };

      // ---- 2. Lessons ----
      var dateInput = el('input', { type: 'date', id: 'a-date', value: today, max: today });
      var roleSel = el('select', { id: 'a-role' }, [el('option', { value: 'all', text: 'All writing roles' })].concat(State.roles.map(function (r) { return el('option', { value: r.id, text: r.name }); })));
      var ageSel = el('select', { id: 'a-age' }, [el('option', { value: 'all', text: 'All ages (9–18)' })].concat(agesList().map(function (a) { return el('option', { value: String(a), selected: a === State.age, text: a + ' years old' }); })));
      var out = el('div', { class: 'admin-out', 'aria-live': 'polite' });
      var statusBtn = el('button', { type: 'button', class: 'btn btn--ghost', id: 'a-status' }, 'Check status');
      var retryBtn = el('button', { type: 'button', class: 'btn btn--admin', id: 'a-retry' }, [icon('shield'), 'Administrator only: retry failed lessons']);
      var busy = function (on, msg) { statusBtn.disabled = on; retryBtn.disabled = on; if (on) { out.textContent = ''; out.appendChild(loadingState(msg)); } };
      var table = function (rows) {
        return el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' }, [
          el('thead', null, el('tr', null, ['Role', 'Age', 'Status', 'Title / last error', 'Attempts'].map(function (h) { return el('th', { scope: 'col', text: h }); }))),
          el('tbody', null, rows.map(function (r) {
            var role = State.rolesById[r.role];
            return el('tr', null, [
              el('td', { text: role ? role.name : r.role }), el('td', { text: r.age ? String(r.age) : '' }),
              el('td', null, el('span', { class: 'status-pill status--' + String(r.status).toLowerCase(), text: r.status })),
              el('td', { class: 'admin-table__msg', text: r.title || r.lastError || r.error || '—' }),
              el('td', { text: r.attempts !== undefined ? String(r.attempts) : '' })
            ]);
          }))
        ]));
      };
      var opts = function () { return { date: dateInput.value, role: roleSel.value, age: ageSel.value }; };
      statusBtn.addEventListener('click', function () {
        if (!needKey()) return;
        busy(true, 'Checking…');
        Api.adminStatus(State.adminKey, opts()).then(function (d) {
          out.textContent = '';
          out.appendChild(el('p', { class: 'muted', text: 'Status for ' + formatLongDate(d.date) + ' · Model: ' + d.config.model + ' · OpenAI key set: ' + (d.config.openaiKeySet ? 'yes' : 'NO') + ' · Daily triggers installed: ' + (d.config.triggersInstalled ? 'yes' : 'NO (run setup())') }));
          out.appendChild(table(d.rows));
        }, function (err) { out.textContent = ''; out.appendChild(errorState(friendlyError(err))); }).then(function () { busy(false); });
      });
      retryBtn.addEventListener('click', function () {
        if (!needKey()) return;
        busy(true, 'Retrying… this can take a few minutes. Please keep this page open.');
        Api.adminRetry(State.adminKey, opts()).then(function (d) {
          out.textContent = '';
          var left = d.results.filter(function (r) { return r.status === 'NOT_STARTED'; }).length;
          out.appendChild(el('p', { class: 'muted', text: 'Retry finished for ' + formatLongDate(d.date) + '. Completed lessons are never regenerated or overwritten.' + (left ? ' ' + left + ' were not reached because of the time limit; press the button again to continue.' : '') }));
          out.appendChild(table(d.results.map(function (r) { return { role: r.role, age: r.age, status: r.status, error: r.status === 'READY' ? 'Ready' : r.error }; })));
        }, function (err) { out.textContent = ''; out.appendChild(errorState(friendlyError(err))); }).then(function () { busy(false); });
      });

      // ---- 3. Password reset ----
      var resetName = el('input', { type: 'text', id: 'a-reset-name', autocomplete: 'off', maxlength: 20, autocapitalize: 'none', spellcheck: 'false' });
      var resetOut = el('div', { class: 'admin-out', 'aria-live': 'polite' });
      var resetBtn = el('button', { type: 'button', class: 'btn btn--ghost', id: 'a-reset' }, [icon('lock'), 'Make a temporary password']);
      resetBtn.addEventListener('click', function () {
        if (!needKey()) return;
        if (!resetName.value.trim()) { toast('Type the pupil\'s nickname.'); resetName.focus(); return; }
        resetBtn.disabled = true; resetOut.textContent = '';
        Api.adminResetPassword(State.adminKey, resetName.value.trim()).then(function (d) {
          resetOut.appendChild(el('div', { class: 'temp-pass' }, [
            el('p', null, ['Temporary password for ', el('strong', { text: d.username }), ':']),
            el('p', { class: 'temp-pass__value mono', text: d.temporaryPassword }),
            el('p', { class: 'muted small', text: 'Give it to the pupil privately. It is shown only this once. The pupil should change it on the My account page.' })
          ]));
        }, function (err) { resetOut.appendChild(errorState(friendlyError(err))); }).then(function () { resetBtn.disabled = false; });
      });

      setView([
        el('header', { class: 'page-head' }, [
          el('h1', { text: 'Teacher / Admin' }),
          el('p', { class: 'muted', text: 'For teachers and administrators only. Every action is checked by the server with the admin key, which is not saved in this browser. Completed lessons are never replaced.' })
        ]),
        el('form', { class: 'card filters', onsubmit: function (e) { e.preventDefault(); loadPayments(); } }, [
          el('label', { for: 'a-key', class: 'field field--wide' }, [el('span', { text: 'Admin key' }), keyInput])
        ]),
        el('section', { class: 'card', 'aria-labelledby': 'a-pay-h' }, [
          el('h2', { id: 'a-pay-h' }, [icon('wallet'), ' GCash payments']),
          el('p', { class: 'muted', text: 'Before approving, open your GCash app → Transactions and find a received payment of ₱1,500.00 with exactly the same Reference No. Approving adds 365 days to that pupil\'s subscription.' }),
          el('div', { class: 'filters filters--inline' }, [
            el('label', { for: 'a-pay-status', class: 'field' }, [el('span', { text: 'Show' }), payStatus]),
            el('div', { class: 'filters__actions' }, payBtn)
          ]),
          payOut
        ]),
        el('section', { class: 'card', 'aria-labelledby': 'a-lessons-h' }, [
          el('h2', { id: 'a-lessons-h' }, [icon('newspaper'), ' Daily lessons']),
          el('div', { class: 'filters filters--inline' }, [
            el('label', { for: 'a-date', class: 'field' }, [el('span', { text: 'Date' }), dateInput]),
            el('label', { for: 'a-role', class: 'field' }, [el('span', { text: 'Writing role' }), roleSel]),
            el('label', { for: 'a-age', class: 'field' }, [el('span', { text: 'Age' }), ageSel]),
            el('div', { class: 'filters__actions field--wide' }, [statusBtn, retryBtn])
          ]),
          out
        ]),
        el('section', { class: 'card', 'aria-labelledby': 'a-reset-h' }, [
          el('h2', { id: 'a-reset-h' }, [icon('lock'), ' Reset a pupil\'s password']),
          el('p', { class: 'muted', text: 'Pupils have no email, so a teacher resets forgotten passwords here. This also signs the pupil out on every device.' }),
          el('div', { class: 'filters filters--inline' }, [
            el('label', { for: 'a-reset-name', class: 'field' }, [el('span', { text: 'Pupil nickname' }), resetName]),
            el('div', { class: 'filters__actions' }, resetBtn)
          ]),
          resetOut
        ])
      ]);
      focusHeading();
    }, function (err) {
      if (token !== renderToken) return;
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  function renderNotFound() {
    setView(emptyState('Page not found', 'That page is not in our newspaper.', el('a', { class: 'btn', href: '#/' }, 'Go to the front page')));
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var query = {};
    if (qi >= 0) new URLSearchParams(raw.slice(qi + 1)).forEach(function (v, k) { query[k] = v; });
    var parts = path.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { parts: parts, query: query };
  }

  var GATED = { dashboard: true, lesson: true, library: true };
  var afterNextRoute = null;

  /** Go to another page, then run then() (for example open the sign-in window) once it has rendered. */
  function redirect(hash, then) {
    afterNextRoute = then || null;
    if (location.hash === hash) route();
    else location.replace(hash);
  }

  function route() {
    var r = parseHash();
    var section = r.parts[0] || '';
    if (section.indexOf('sec-') === 0) return; // in-page section anchors: not a new page
    var token = ++renderToken;
    var after = afterNextRoute;
    afterNextRoute = null;
    Speech.reset();
    if (Modal.current) Modal.close(true);
    window.scrollTo(0, 0);
    if (!Api.isConfigured()) { renderNav(); setView(setupNeededView()); return; }
    if (section === 'admin') { renderNav(); return renderAdmin(token); }
    return ensureAccount(false).then(function () {
      if (token !== renderToken) return;
      return Promise.resolve(renderSection(token, section, r)).then(function () {
        if (after && token === renderToken) after();
      });
    }, function (err) {
      if (token !== renderToken) return;
      renderNav();
      if (section === '' || section === 'welcome') return renderLanding(token); // the front page works offline-ish
      setView(errorState(friendlyError(err), function () { route(); }));
    });
  }

  function renderSection(token, section, r) {
    return (function () {
      renderNav();
      if (section === '') { // front door: subscribers go straight to today's lessons
        if (isSubscriber()) { redirect('#/dashboard'); return; }
        return renderLanding(token);
      }
      if (section === 'welcome') return renderLanding(token);
      if (section === 'account') {
        if (!signedIn()) { redirect('#/welcome', function () { openSignIn({ next: '#/account' }); }); return; }
        return renderAccount(token, r.query);
      }
      if (GATED[section]) {
        if (!signedIn()) {
          var next = location.hash;
          redirect('#/welcome', function () { openSignIn({ next: next, notice: 'Please sign in to open the lessons.' }); });
          return;
        }
        if (!isSubscriber()) { redirect('#/account?need=sub'); return; }
        if (section === 'dashboard') return renderDashboard(token);
        if (section === 'lesson' && r.parts[1]) return renderTodayLesson(token, r.parts[1], r.query);
        if (section === 'library' && r.parts[1]) return renderLibraryDetail(token, r.parts[1]);
        if (section === 'library') return renderLibrary(token, r.query);
      }
      renderNotFound();
    })();
  }

  function init() {
    setDateline(manilaParts().ymd);
    decorateStaticIcons();
    State.age = validAge(storageGet('jw.age'));
    Speech.init();
    Speech.notify();
    Install.init();
    window.addEventListener('hashchange', route);
    window.addEventListener('jw:auth-required', function () {
      var wasSignedIn = !!State.account;
      setAccount(null);
      var section = parseHash().parts[0] || '';
      if (wasSignedIn && (GATED[section] || section === 'account')) {
        redirect('#/welcome', function () { openSignIn({ next: '#/dashboard', notice: 'Your sign-in has ended. Please sign in again.' }); });
      }
    });
    window.addEventListener('jw:subscription-required', function () {
      ensureAccount(true).then(function () {
        if (!isSubscriber() && location.hash.indexOf('#/account') !== 0) redirect('#/account?need=sub');
      }, function () { /* offline: keep the current page */ });
    });
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed for automated tests only (no secrets here).
  window.JournalismWriter = { CONFIG: CONFIG, Speech: Speech, State: State, Bookmarks: Bookmarks, Install: Install, Modal: Modal, route: route };
})();
