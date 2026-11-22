// Adds the two headers browsers need before they let the cut-out use several processor cores.
// GitHub Pages can't send these headers itself, so this service worker adds them to the app's own pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  e.respondWith(fetch(req).then(res => {
    if (!res || res.status === 0) return res;
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
