/*
 * Journalism Writer — the single frontend API client (window.JWApi).
 *
 * Every call the frontend makes to the backend goes through this file.
 *
 *  JWApi method                          HTTP  action=              Apps Script function            Needs
 *  ────────────────────────────────────  ────  ───────────────────  ──────────────────────────────  ───────────────
 *  health()                              GET   health               apiHealth_                      —
 *  getRoles()                            GET   roles                apiRoles_                       —
 *  getPaymentInfo()                      GET   paymentInfo          apiPaymentInfo_ (Auth.gs)       —
 *  signUp({username,password,age,…})     POST  signUp               apiSignUp_                      —
 *  signIn({username,password,remember})  POST  signIn               apiSignIn_                      —
 *  signOut()                             POST  signOut              apiSignOut_                     session
 *  getAccount()                          POST  account              apiAccount_                     session
 *  submitPayment(referenceNo)            POST  submitPayment        apiSubmitPayment_               session
 *  changePassword(current, next)         POST  changePassword       apiChangePassword_              session
 *  deleteAccount(password)               POST  deleteAccount        apiDeleteAccount_               session
 *  getTodayLessons(age)                  POST  todaySummary         getTodayLessons                 subscription
 *  getTodayLesson(role, age)             POST  today                getOrCreateTodayLesson_         subscription *
 *  getLessonById(lessonId)               POST  lesson               getLessonById                   subscription
 *  getLibrary(filters)                   POST  library              getLibrary                      subscription
 *  adminStatus(key, options)             POST  adminStatus          apiAdminStatus_                 admin key
 *  adminRetry(key, options)              POST  adminRetry           apiAdminRetry_                  admin key
 *  adminPayments(key, status)            POST  adminPayments        apiAdminPayments_               admin key
 *  adminReviewPayment(key, id, d, note)  POST  adminReviewPayment   apiAdminReviewPayment_          admin key
 *  adminResetPassword(key, username)     POST  adminResetPassword   apiAdminResetPassword_          admin key
 *
 *  * getTodayLesson returns the saved lesson when one exists. Only when no completed lesson exists for
 *    today's date + role + age can the backend generate one (once, under a lock).
 *
 * Request strategy (Apps Script web apps cannot answer CORS preflight requests):
 *  - GET with query parameters and no custom headers, credentials omitted ("simple request").
 *    Public GETs fall back to JSONP (?callback=) if fetch fails at the network/CORS level.
 *  - POST with Content-Type text/plain;charset=utf-8 (also a "simple request"). The session token
 *    travels only in the POST body, never in a URL.
 *  - Non-JSON responses (for example a Google sign-in page) become BAD_RESPONSE errors.
 *
 * Session: only a random session token is kept in the browser (sessionStorage, or localStorage when
 * "Keep me signed in" is ticked). No lesson content and no password is ever stored in the browser.
 * Events: "jw:auth-required" when the server says the session ended; "jw:subscription-required"
 * when a lesson needs an active subscription.
 */
(function () {
  'use strict';

  var TIMEOUTS = {
    read: 30000,      // health, roles, library, lesson, summary
    account: 45000,   // sign up / sign in (password hashing) and payments
    today: 120000,    // may include first-time generation; on timeout the app polls instead of failing
    admin: 330000     // a retry of many lessons can take several minutes
  };

  var FRIENDLY = {
    NETWORK: 'We could not reach the newsroom server. Check your internet connection and try again.',
    TIMEOUT: 'The server is taking a long time to answer. Please try again.',
    BAD_RESPONSE: 'The server sent something we could not read. Ask your teacher to check that the app is set up correctly.',
    NOT_CONFIGURED: 'The app is not set up yet. Please tell your teacher.',
    SCHEMA_INVALID: 'The database needs attention. Please tell your teacher.',
    SERVER_ERROR: 'Something went wrong on the server. Please try again in a moment.',
    BUSY: 'The server is busy. Please try again in a moment.',
    NOT_FOUND: 'We could not find that lesson.',
    CORRUPT: 'That saved lesson could not be opened. Please tell your teacher.',
    AUTH_REQUIRED: 'Please sign in again.',
    SUBSCRIPTION_REQUIRED: 'Your yearly subscription is not active yet.'
  };

  // Codes whose server message is written for pupils and may be shown as-is.
  var PASS_THROUGH = /^(BAD_[A-Z_]+|UNAUTHORIZED|ADMIN_[A-Z_]+|USERNAME_TAKEN|LOGIN_LOCKED|ACCOUNT_DISABLED|REFERENCE_USED|ALREADY_[A-Z_]+|NO_SUCH_USER|USER_GONE|PAYMENTS_NOT_CONFIGURED|RATE_LIMITED|PREVIEW)$/;

  var SESSION_KEY = 'jw.session';

  function ApiError(code, message, opts) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.code = code;
    e.isNetwork = !!(opts && opts.isNetwork);
    return e;
  }

  function config() { return window.JW_CONFIG || {}; }

  function isConfigured() {
    var url = String(config().API_URL || '');
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url) && url.indexOf('PASTE_') === -1;
  }

  // ---- session token (the only account data kept in the browser) ----
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  var Session = {
    get: function () {
      var kinds = ['sessionStorage', 'localStorage'];
      for (var i = 0; i < kinds.length; i++) {
        var s = store(kinds[i]);
        try {
          var v = s && JSON.parse(s.getItem(SESSION_KEY) || 'null');
          if (v && /^jw_[0-9a-f]{64}$/.test(v.token)) return v.token;
        } catch (e) { /* ignore */ }
      }
      return '';
    },
    set: function (token, remember) {
      Session.clear();
      var s = store(remember ? 'localStorage' : 'sessionStorage');
      try { if (s) s.setItem(SESSION_KEY, JSON.stringify({ token: token })); } catch (e) { /* storage blocked: session lasts for this page only */ }
      Session.memory = token;
    },
    clear: function () {
      ['sessionStorage', 'localStorage'].forEach(function (k) { var s = store(k); try { if (s) s.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } });
      Session.memory = '';
    },
    memory: '',
    token: function () { return Session.get() || Session.memory; },
    has: function () { return !!Session.token(); }
  };

  function emit(name) {
    try { window.dispatchEvent(new CustomEvent(name)); } catch (e) { /* old browsers */ }
  }

  function buildUrl(action, params) {
    var qs = new URLSearchParams();
    qs.set('action', action);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return config().API_URL + '?' + qs.toString();
  }

  function parseEnvelope(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw ApiError('BAD_RESPONSE', FRIENDLY.BAD_RESPONSE); }
    if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') throw ApiError('BAD_RESPONSE', FRIENDLY.BAD_RESPONSE);
    return data;
  }

  function unwrap(envelope) {
    if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') throw ApiError('BAD_RESPONSE', FRIENDLY.BAD_RESPONSE);
    if (envelope.ok) return envelope.data;
    var e = envelope.error || {};
    var code = String(e.code || 'ERROR');
    var msg = PASS_THROUGH.test(code) && e.message ? String(e.message) : (FRIENDLY[code] || FRIENDLY.SERVER_ERROR);
    throw ApiError(code, msg);
  }

  function fetchText(url, opts, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    var init = Object.assign({ redirect: 'follow', credentials: 'omit', cache: 'no-store' }, opts);
    if (controller) init.signal = controller.signal;
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw ApiError('HTTP_' + res.status, FRIENDLY.SERVER_ERROR);
      return res.text();
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw ApiError('TIMEOUT', FRIENDLY.TIMEOUT);
      throw ApiError('NETWORK', FRIENDLY.NETWORK, { isNetwork: true });
    });
  }

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var name = '__jw_cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var script = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(ApiError('TIMEOUT', FRIENDLY.TIMEOUT)); }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[name] = function (data) { cleanup(); resolve(data); };
      script.onerror = function () { cleanup(); reject(ApiError('NETWORK', FRIENDLY.NETWORK, { isNetwork: true })); };
      script.src = url + '&callback=' + name;
      document.head.appendChild(script);
    });
  }

  /** Public data only (no token). */
  function get(action, params, timeoutMs) {
    if (!isConfigured()) return Promise.reject(ApiError('NOT_CONFIGURED', FRIENDLY.NOT_CONFIGURED));
    var url = buildUrl(action, params);
    var t = timeoutMs || TIMEOUTS.read;
    return fetchText(url, { method: 'GET' }, t)
      .then(parseEnvelope, function (err) {
        if (!err.isNetwork) throw err;
        return jsonp(url, t); // CORS/network fallback
      })
      .then(unwrap);
  }

  function post(action, body, timeoutMs) {
    if (!isConfigured()) return Promise.reject(ApiError('NOT_CONFIGURED', FRIENDLY.NOT_CONFIGURED));
    var payload = Object.assign({}, body || {}, { action: action });
    return fetchText(config().API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }, timeoutMs || TIMEOUTS.read).then(parseEnvelope).then(unwrap);
  }

  /** POST with the session token; reacts to an ended session or a missing subscription. */
  function authed(action, body, timeoutMs) {
    var token = Session.token();
    if (!token) {
      emit('jw:auth-required');
      return Promise.reject(ApiError('AUTH_REQUIRED', FRIENDLY.AUTH_REQUIRED));
    }
    return post(action, Object.assign({}, body || {}, { token: token }), timeoutMs).catch(function (err) {
      if (err && err.code === 'AUTH_REQUIRED') { Session.clear(); emit('jw:auth-required'); }
      if (err && err.code === 'SUBSCRIPTION_REQUIRED') emit('jw:subscription-required');
      throw err;
    });
  }

  function startSession(remember) {
    return function (data) { Session.set(data.token, remember); return data.account; };
  }

  window.JWApi = {
    /** Backend actions this client calls (checked by the test suite against Code.gs routing). */
    ACTIONS: {
      get: ['health', 'roles', 'paymentInfo'],
      post: ['signUp', 'signIn', 'signOut', 'account', 'submitPayment', 'changePassword', 'deleteAccount',
        'todaySummary', 'today', 'lesson', 'library',
        'adminStatus', 'adminRetry', 'adminPayments', 'adminReviewPayment', 'adminResetPassword']
    },
    TIMEOUTS: TIMEOUTS,
    session: Session,
    isConfigured: isConfigured,
    friendly: function (err) {
      if (!err) return FRIENDLY.SERVER_ERROR;
      return err.name === 'ApiError' && err.message ? err.message : FRIENDLY.SERVER_ERROR;
    },

    // public
    health: function () { return get('health'); },
    getRoles: function () { return get('roles'); },
    getPaymentInfo: function () { return get('paymentInfo'); },

    // accounts
    signUp: function (o) {
      o = o || {};
      return post('signUp', { username: o.username, password: o.password, age: o.age, guardianOk: o.guardianOk === true, remember: o.remember === true }, TIMEOUTS.account)
        .then(startSession(o.remember === true));
    },
    signIn: function (o) {
      o = o || {};
      return post('signIn', { username: o.username, password: o.password, remember: o.remember === true }, TIMEOUTS.account)
        .then(startSession(o.remember === true));
    },
    signOut: function () {
      var token = Session.token();
      Session.clear();
      if (!token) return Promise.resolve({ signedOut: true });
      return post('signOut', { token: token }).catch(function () { return { signedOut: true }; });
    },
    getAccount: function () { return authed('account', {}).then(function (d) { return d.account; }); },
    submitPayment: function (referenceNo) { return authed('submitPayment', { referenceNo: referenceNo }, TIMEOUTS.account).then(function (d) { return d.account; }); },
    changePassword: function (current, next) {
      var remember = false;
      try { remember = !!window.localStorage.getItem(SESSION_KEY); } catch (e) { remember = false; }
      return authed('changePassword', { currentPassword: current, newPassword: next, remember: remember }, TIMEOUTS.account)
        .then(startSession(remember));
    },
    deleteAccount: function (password) {
      return authed('deleteAccount', { password: password }, TIMEOUTS.account).then(function (d) { Session.clear(); return d; });
    },

    // lessons (active subscription)
    getTodayLessons: function (age) { return authed('todaySummary', { age: age }); },
    getTodayLesson: function (role, age) { return authed('today', { role: role, age: age }, TIMEOUTS.today); },
    getLessonById: function (lessonId) { return authed('lesson', { id: lessonId }); },
    getLibrary: function (filters) {
      var f = filters || {};
      return authed('library', {
        role: f.role, age: f.age, category: f.category, from: f.from, to: f.to, q: f.q, page: f.page, pageSize: f.pageSize
      });
    },

    // administrator
    adminStatus: function (adminKey, o) {
      o = o || {};
      return post('adminStatus', { adminKey: adminKey, date: o.date, role: o.role, age: o.age }, TIMEOUTS.read);
    },
    adminRetry: function (adminKey, o) {
      o = o || {};
      return post('adminRetry', { adminKey: adminKey, date: o.date, role: o.role, age: o.age }, TIMEOUTS.admin);
    },
    adminPayments: function (adminKey, status) { return post('adminPayments', { adminKey: adminKey, status: status || 'PENDING' }); },
    adminReviewPayment: function (adminKey, paymentId, decision, note) {
      return post('adminReviewPayment', { adminKey: adminKey, paymentId: paymentId, decision: decision, note: note || '' });
    },
    adminResetPassword: function (adminKey, username) { return post('adminResetPassword', { adminKey: adminKey, username: username }, TIMEOUTS.account); }
  };
})();
