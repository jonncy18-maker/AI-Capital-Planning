// Web app manifest → served at /manifest.webmanifest (Next metadata route).
// Colors match the app's default dark chrome (--bg-app in src/styles/tokens.css)
// so the splash screen and status bar don't flash a mismatched color on launch.
export default function manifest() {
  return {
    name: 'AI Capital Planning',
    short_name: 'Capital',
    description: 'Forward-looking capital planning, cash flow timing, and AI decision support.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0C0F12',
    theme_color: '#0C0F12',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
