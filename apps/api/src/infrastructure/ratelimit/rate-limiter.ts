/**
 * Rate limiter port + in-memory fixed-window implementation (spec 08 §1, spec 10 §5). The
 * MVP limits per API key / IP in-process; a Redis-backed limiter can implement the same
 * interface for multi-instance deployments without touching the middleware.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (for `Retry-After`). */
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
}

export interface FixedWindowOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  now?: () => number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter keyed by an arbitrary string (principal id or client IP). Windows are
 * lazily reset on access and stale windows are pruned opportunistically to bound memory.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: FixedWindowOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  hit(key: string): RateLimitResult {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
      this.prune(now);
    }
    window.count += 1;
    const remaining = Math.max(0, this.limit - window.count);
    const retryAfterSeconds = Math.ceil((window.resetAt - now) / 1000);
    return {
      allowed: window.count <= this.limit,
      retryAfterSeconds,
      limit: this.limit,
      remaining,
    };
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
