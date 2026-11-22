// Adds the two headers browsers need before they let the cut-out use several processor cores.
// GitHub Pages can't send these headers itself, so this service worker adds them to the app's own pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  // The cut-out model's files never change (their names are content hashes) but their server
  // doesn't tell phones to keep them, so keep them ourselves: download once, then load from storage.
  if (new URL(req.url).hostname === "staticimgly.com" && req.method === "GET") {
    e.respondWith(caches.open("cutout-model-1.4.5").then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  // no-cache: always ask GitHub whether a file changed (a quick "not modified" if not), so updates
  // show on the next open instead of after GitHub's 10-minute cache time.
  // Page loads themselves keep the normal fetch (it handles the /topere → /topere/ redirect).
  const fresh = req.method === "GET" && req.mode !== "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req);
  e.respondWith(fresh.then(res => {
    if (!res || res.status === 0) return res;
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
