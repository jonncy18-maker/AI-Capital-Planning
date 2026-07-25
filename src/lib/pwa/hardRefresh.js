// Force the installed PWA onto the newest deploy.
//
// A standalone PWA can sit on a service-worker-cached shell for a long time —
// the SW only picks up a new build when it happens to check. This drops the
// precache, pulls the newest worker, and reloads against the network so a
// freshly pushed deploy shows up on demand.

export async function hardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      // update() first: it fetches the new worker script, which (skipWaiting +
      // clientsClaim in app/sw.js) takes control immediately.
      await Promise.all(regs.map(r => r.update().catch(() => {})))
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch {
    // Cache teardown is best-effort — always fall through to the reload.
  }
  // Cache-busted URL so the navigation can't be served from the HTTP cache or a
  // lingering SW navigation-preload response.
  const url = new URL(window.location.href)
  url.searchParams.set('_r', String(Date.now()))
  window.location.replace(url.toString())
}
