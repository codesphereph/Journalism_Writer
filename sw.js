/*
 * Journalism Writer service worker.
 * Purpose: make the site installable and let the app shell (HTML, CSS, JS, logo) open quickly.
 * It NEVER caches lessons, accounts or any request to the Apps Script server: those always go to
 * the network, so a pupil always sees the saved lesson from Google Sheets and their real account.
 * Bump VERSION whenever you upload changed frontend files, so devices pick up the new version.
 */
var VERSION = 'jw-shell-v3.1.1';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './api.js',
  './app.js',
  './manifest.webmanifest',
  './assets/logo.webp',
  './assets/logo-128.webp',
  './assets/favicon.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('jw-shell-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;                        // POSTs (accounts, lessons) are never touched
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // Apps Script, Google Fonts: straight to the network
  // Network first (so updates arrive), falling back to the cached shell when offline.
  event.respondWith(fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(VERSION).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    });
  }));
});
