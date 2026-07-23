import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.js',
  swDest: 'public/sw.js',
  // Don't register/enable the SW in `next dev` — avoids stale-cache confusion
  // during local development. It's active in production builds.
  disable: process.env.NODE_ENV === 'development',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serwist bundles the service worker via a webpack plugin, so production
  // builds run `next build --webpack` (see package.json). This empty Turbopack
  // config lets `next dev` (Turbopack, SW disabled) run without tripping Next's
  // "webpack config with no turbopack config" guard.
  turbopack: {},
}

export default withSerwist(nextConfig)
