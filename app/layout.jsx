'use client'

import '../src/styles/tokens.css'
import '../src/index.css'
import '../src/App.css'
import ErrorBoundary from '../src/modules/common/ErrorBoundary.jsx'
import AppRoot from './AppRoot.jsx'

// Runs synchronously before hydration so <html data-theme> matches the user's
// saved choice on first paint. Without this, SSR renders with no data-theme
// and the client's mount effect would write the default back over a saved
// 'light', causing a wrong-theme flash, a one-step-stale toggle, and reverting
// to dark on refresh. Must stay in sync with useTheme.js's STORAGE_KEY.
const themeInitScript = `(function(){try{var t=localStorage.getItem('acp-theme')||'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>AI Capital Planning OS</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:ital,wght@0,400;0,500&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ErrorBoundary>
          <AppRoot>{children}</AppRoot>
        </ErrorBoundary>
      </body>
    </html>
  )
}
