/**
 * Fixed-window rate limiter held in process memory.
 *
 * Each server instance keeps its own counters, so on a multi-instance
 * deployment the effective limit is per instance. That still stops a single
 * client hammering one instance (signup email floods, paid model calls); a
 * shared store is needed for a hard global limit.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

const MAX_KEYS = 10_000;

export function createRateLimiter() {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    if (buckets.size < MAX_KEYS) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function hit(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now()
  ): RateLimitResult {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      sweep(now);
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfterSec: 0 };
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfterSec: 0 };
  };
}

export const rateLimit = createRateLimiter();

export const LIMITS = {
  signupPerIp: { limit: 10, windowMs: 15 * 60_000 },
  signupPerEmail: { limit: 5, windowMs: 60 * 60_000 },
  inviteLookupPerIp: { limit: 60, windowMs: 15 * 60_000 },
  invitesPerUser: { limit: 30, windowMs: 60 * 60_000 },
  bootstrapPerUser: { limit: 10, windowMs: 60 * 60_000 },
  modelCallsPerUser: { limit: 30, windowMs: 60_000 },
  demoRequestPerIp: { limit: 5, windowMs: 60 * 60_000 },
  demoRequestPerEmail: { limit: 3, windowMs: 24 * 60 * 60_000 },
  assistantPerIp: { limit: 20, windowMs: 10 * 60_000 },
  /** A site visit syncs a queue in a burst, so this is generous. */
  fieldwork: { limit: 300, windowMs: 10 * 60_000 },
  /** The public entity-response page is reachable by anyone holding the link. */
  entityResponsePerIp: { limit: 20, windowMs: 15 * 60_000 },
  entityResponsePerLink: { limit: 30, windowMs: 60 * 60_000 },
  /** Model calls from the public assistant, per instance. Past this it answers from the library. */
  assistantModelBudget: { limit: 1000, windowMs: 24 * 60 * 60_000 },
} as const;
