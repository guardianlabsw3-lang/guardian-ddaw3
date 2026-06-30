import { connect } from 'node:net';
import type { Sql } from 'postgres';

/**
 * A readiness probe (DB / Redis / RPC). Defined here — not imported from the HTTP layer — so
 * infrastructure does not depend on interfaces; it is structurally compatible with the health
 * controller's `ReadinessCheck`.
 */
export interface ReadinessCheck {
  name: string;
  check(): Promise<boolean>;
}

/** DB readiness: a trivial `SELECT 1` round-trip on the live pool. */
export function databaseCheck(sql: Sql): ReadinessCheck {
  return {
    name: 'database',
    async check() {
      await sql`select 1`;
      return true;
    },
  };
}

/**
 * Redis readiness via a bounded TCP connect to host:port parsed from `REDIS_URL`. A full
 * `PING` would need a client library; a successful connection is a sufficient liveness
 * signal for `/ready` and stays dependency-free.
 */
export function redisCheck(redisUrl: string, timeoutMs = 1500): ReadinessCheck {
  const parsed = new URL(redisUrl);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 6379;
  return {
    name: 'redis',
    check() {
      return new Promise<boolean>((resolve) => {
        const socket = connect({ host, port });
        const done = (ok: boolean) => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
      });
    },
  };
}

/** Soroban RPC readiness via the JSON-RPC `getHealth` method (spec 15 — `/ready` checks RPC). */
export function sorobanRpcCheck(rpcUrl: string, timeoutMs = 2500): ReadinessCheck {
  return {
    name: 'soroban_rpc',
    async check() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
