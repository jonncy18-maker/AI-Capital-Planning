// Minimal fixed-window rate limiter for API routes. In-memory, so limits are
// per warm serverless instance, not global — good enough to stop abuse loops
// (credit burn on ai-chat, credential relaying via monarch-sync), not a hard
// quota. Swap for a durable store (e.g. Postgres/Upstash) if that ever matters.

const buckets = new Map()

/**
 * Returns true if the caller identified by `key` is within `limit` calls in
 * the current `windowMs` window, false if the call should be rejected.
 */
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now - bucket.start >= windowMs) {
    // Opportunistically drop expired buckets so the map can't grow unbounded.
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (now - b.start >= windowMs) buckets.delete(k)
      }
    }
    buckets.set(key, { start: now, count: 1 })
    return true
  }

  bucket.count += 1
  return bucket.count <= limit
}
