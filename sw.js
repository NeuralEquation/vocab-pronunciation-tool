const CACHE_NAME = "mw-pronunciation-pwa-v55";
const CACHE_PREFIX = "mw-pronunciation-pwa-";
const APP_SHELL = [
  "./index.html", "./styles.css?v=55", "./js/storage.js?v=55",
  "./js/content.js?v=55", "./js/test.js?v=55", "./js/playback.js?v=55",
  "./js/dictionary.js?v=55", "./js/app.js?v=55", "./js/ux-overrides.js?v=55",
  "./manifest.webmanifest", "./icon.png"
];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));
// Include the scope so two installations on the same origin cannot overwrite
// or delete each other's offline shell.
const SCOPED_CACHE_NAME = CACHE_NAME + ":" + self.registration.scope;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SCOPED_CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  // Updates wait for all existing tabs to close. Never replace a learning
  // session's service worker in the middle of an unsaved operation.
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const indexUrl = new URL("./index.html", self.registration.scope).href;
    for (const key of await caches.keys()) {
      if (!key.startsWith(CACHE_PREFIX) || key === SCOPED_CACHE_NAME) continue;
      const old = await caches.open(key);
      if (await old.match(indexUrl)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === "navigate") {
    // HTML and versioned assets always come from the same installed build.
    event.respondWith(caches.open(SCOPED_CACHE_NAME).then(async cache => (await cache.match(new URL("./index.html", self.registration.scope).href)) || fetch(request)));
    return;
  }
  if (!SHELL_URLS.has(url.href)) return;
  event.respondWith(caches.open(SCOPED_CACHE_NAME).then(async cache => (await cache.match(request)) || fetch(request)));
});
