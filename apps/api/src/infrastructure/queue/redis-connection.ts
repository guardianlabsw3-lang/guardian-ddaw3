import type { ConnectionOptions } from 'bullmq';

/**
 * Parse a Redis URL into BullMQ connection options. BullMQ requires
 * `maxRetriesPerRequest: null` (its blocking commands manage their own retries). Returning a
 * plain options object — rather than a constructed ioredis client — lets BullMQ own the
 * connection lifecycle and avoids coupling to a specific ioredis version. The same options
 * are used by the api producer and the worker consumer.
 */
export function redisConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db:
      parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
