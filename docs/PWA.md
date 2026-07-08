# PWA Foundation — Installable App Groundwork

**Status: PLANNED (not yet built).** Runbook for turning this app into an
installable Progressive Web App. Nothing here exists in the repo yet — no
manifest, service worker, or icons. Forward-looking; do not read as shipped
behavior.

> **Doc-drift note:** the root `CLAUDE.md` still describes this app as
> "React 19 + Vite + Supabase, deployed to GitHub Pages." The repo has since
> migrated to **Next.js App Router** (`app/`, `next.config.mjs`, Next 16) on
> Vercel (see `MIGRATION_PLAN.md` / `ROADMAP.md`). This PWA runbook is written
> against the **actual current Next.js state**, not the stale CLAUDE.md
> description. (Fixing CLAUDE.md's stack summary is a separate cleanup task.)

**Context — this app is different from the other two.** NextGen-Immersion is
the pilot for the native rollout and NextGen-Scholars follows; both are
**private / Play Internal Testing**. AI-Capital is the one app that **may go
public** eventually ("Multi-tenant / public user accounts" is already listed in
ROADMAP future scope). That changes the downstream Play Store path
significantly — a public production listing triggers Google's content review,
the data-safety scrutiny, and (for a new personal developer account) the
12-tester / 14-day closed-testing gate. **None of that affects this PWA
groundwork** — building a clean PWA keeps both doors (private TWA or public
listing) open. Decide the distribution path later; do the PWA now.

Also note: this is a **single-user** app (John's personal capital planning),
so the multi-user data-isolation concerns that dominate the other two repos'
service-worker rules do **not** apply here.

---

## What "PWA-ready" means (acceptance bar)

Passes Chrome DevTools → Lighthouse "Installable" with no errors; Chrome/Android
offers "Install app". Requires: a linked **web app manifest** (name,
short_name, start_url, display, theme_color, background_color, 192+512 icons and
a 512 maskable), a **service worker** controlling the page, HTTPS (Vercel), and
a viewport meta (Next default covers it).

---

## This app's specifics (read before writing code)

- **Framework:** Next.js **16** App Router. Real routes under `app/`
  (`dashboard`, `budget`, `forecast`, `scenarios`, `wealth`, `payperiods`,
  `commitments`, `creditcards`, `mapping`, `settings`). App state is currently
  driven by `app/shellContext.js` / static registry rather than deep-linked
  routes — confirm what `start_url` should land on (likely `/` → dashboard).
- **Existing assets:** `public/` already has `favicon.svg` and `icons.svg` —
  reuse/extend the brand mark for the PWA icon set (you still need raster PNGs
  at 192/512 + maskable; SVG alone isn't sufficient for the manifest).
- **Backend/AI:** AI calls route through a server function (was the Supabase
  `ai-chat` Edge Function; confirm the current Next API route after migration).
  The SW must treat **API routes as network-only** — never cache AI responses
  or authed data. Even though it's single-user, caching API responses would
  serve stale financial data, which for a planning tool is worse than a network
  round-trip.
- **Single-user simplifies caching** — no cross-user leak risk — but financial
  data freshness still argues for network-only on all data/AI endpoints;
  cache-first only for static shell + assets.

---

## Recommended approach: Serwist

Use **Serwist** (`@serwist/next`) — the maintained `next-pwa` successor,
comfortable on Next 16. Alternative: a minimal hand-rolled `public/sw.js`
(shell + assets cache-first, everything API/data network-only), which is
perfectly adequate for a single-user app with modest offline needs.

### Steps

1. `npm install @serwist/next && npm install -D serwist` (or hand-roll).
2. Wrap `next.config.mjs` with `withSerwistInit({ swSrc: 'app/sw.js', swDest:
   'public/sw.js' })`, keeping the existing config.
3. Add the manifest as **`app/manifest.js`** (Next metadata route →
   `/manifest.webmanifest`).
4. Add `themeColor` + `appleWebApp` to `app/layout.jsx`'s `metadata` export.
5. SW strategy: `NetworkOnly` for all `/api/**` (data + AI), `CacheFirst` for
   images/fonts/icons, `StaleWhileRevalidate` for document navigations.
6. Icons in `public/icons/` (below).

### Manifest starter (adapt values)

```jsonc
{
  "name": "AI Capital Planning",
  "short_name": "Capital",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0f172a",   // adapt to the app's actual palette
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

> Pull the real theme/background hex from the app's stylesheet; the value above
> is a placeholder. Derive icons from the existing `public/favicon.svg` /
> `icons.svg` brand mark.

---

## Icons

192, 512, and a **maskable** 512. Rasterize from the existing SVG brand mark
(via PWABuilder Image Generator or `pwa-asset-generator`), drop in
`public/icons/`, verify the maskable safe-circle in DevTools → Manifest.

---

## Verification checklist

- [ ] `npm run build && npm run start`, open in Chrome.
- [ ] DevTools → Manifest: no errors, icons + maskable OK.
- [ ] Service worker registered, activated, controlling the page.
- [ ] Lighthouse / "Installability": installable, no PWA errors.
- [ ] "Install app" appears; installed app launches full-screen at `start_url`.
- [ ] Offline: shell loads; data/AI views show a network state rather than
      stale cached financials.
- [ ] AI chat + data reads still work inside the installed app (API network-only,
      not cached).

---

## Gotchas

- **Never cache financial/AI API responses.** Single-user removes leak risk but
  not staleness risk — a planning tool showing yesterday's numbers is a bug.
- **Stale JS after deploy** — version cache names / rely on Serwist's build
  manifest; clean old caches on `activate`.
- **iOS second-class** — use `appleWebApp` metadata if iOS install matters.

---

## Next step (distribution — decide later)

This PWA is enough to install to a home screen today. The **Play Store path for
this app is an open decision** because it may go public:

- **If kept private** → same TWA + Internal Testing path as
  NextGen-Immersion's `docs/PLAY-STORE.md` (copy + adapt origin/package id).
- **If public** → a full production listing: content rating, data-safety
  declaration (this app holds financial data — declare honestly), privacy
  policy, and the new-account 12-tester / 14-day closed-testing gate before
  production. Heavier; plan separately when the public decision is actually
  made.

Do the PWA groundwork now regardless — it's a prerequisite either way.
