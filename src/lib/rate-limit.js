/**
 * A small fixed-window rate limiter, in memory.
 *
 * For any public endpoint whose only credential is something guessable (a
 * 10-digit phone number, say): without a cap, small input spaces can be
 * walked with a script. A human types a value once or twice; a script wants
 * thousands.
 *
 * IN MEMORY, so the window is per server instance — on a platform that runs
 * several, the effective limit is LIMIT × instances. That still turns a
 * feasible sweep into an infeasible one, which is the point; a shared store
 * (Redis/Upstash) is the upgrade if this ever needs to be exact.
 */

const buckets = new Map();

// Swept lazily rather than on a timer: a timer would keep a serverless
// instance alive, and an idle instance is discarded with its Map anyway.
function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Consume one unit for `key`.
 *
 * @param {string} key            caller identity, e.g. an IP address
 * @param {{limit?: number, windowMs?: number}} [options]
 * @returns {{ok: boolean, retryAfter: number}} retryAfter is whole seconds
 */
export function rateLimit(key, { limit = 8, windowMs = 60_000 } = {}) {
  const now = Date.now();
  if (buckets.size > 5000) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client address for a request.
 *
 * x-forwarded-for is set by the proxy in front of us and is the only signal
 * available on a serverless platform. It is spoofable end-to-end, which is why
 * this is a speed bump rather than an authentication mechanism — but the
 * leftmost hop is what a naive scraper actually presents.
 */
export function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
