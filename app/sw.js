import { defaultCache } from '@serwist/next/worker'
import { Serwist, NetworkOnly } from 'serwist'

// self.__SW_MANIFEST is the precache list injected by @serwist/next at build time
// (the static app shell + hashed assets).
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // All data + AI endpoints are network-only. This app is single-user (no
    // cross-user leak risk), but a planning tool serving cached financials or a
    // stale AI answer is worse than a network round-trip. Registered before
    // defaultCache so it wins over Serwist's default NetworkFirst /api handler.
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    // Static shell (navigations → StaleWhileRevalidate) + images/fonts/icons
    // (CacheFirst) come from Serwist's tuned Next.js defaults.
    ...defaultCache,
  ],
})

serwist.addEventListeners()
