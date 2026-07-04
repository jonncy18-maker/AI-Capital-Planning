'use client'

import '../src/styles/tokens.css'
import '../src/index.css'
import '../src/App.css'
import ErrorBoundary from '../src/modules/common/ErrorBoundary.jsx'
import AppRoot from './AppRoot.jsx'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
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
