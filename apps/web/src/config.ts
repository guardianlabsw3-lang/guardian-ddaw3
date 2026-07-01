/**
 * Public runtime configuration, read from `NEXT_PUBLIC_*` env vars (safe to expose to the
 * browser). References are literal so Next inlines them at build time on the client.
 *
 * The MVP is **Testnet only** (product invariant #1); the network is hard-coded.
 */
export interface WebConfig {
  apiBaseUrl: string;
  network: 'TESTNET';
  horizonUrl: string;
  sorobanRpcUrl: string;
  explorerBaseUrl: string;
}

function clean(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getConfig(): WebConfig {
  return {
    apiBaseUrl: clean(process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pow3-api.guardian-labs.xyz'),
    network: 'TESTNET',
    horizonUrl: clean(process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org'),
    sorobanRpcUrl: clean(
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    ),
    explorerBaseUrl: clean(
      process.env.NEXT_PUBLIC_EXPLORER_BASE_URL || 'https://stellar.expert/explorer/testnet',
    ),
  };
}

/**
 * API base URL to use for **server-side** (SSR / route handler) requests.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the browser-facing URL, which inside a container is often NOT
 * reachable from the server process itself: locally `localhost:<port>` resolves to the web
 * container (not the API), and behind a reverse proxy the public domain may not hairpin back in.
 * That made SSR of the public payment page always fail while a client-side retry succeeded.
 *
 * `API_INTERNAL_BASE_URL` (a non-`NEXT_PUBLIC_`, runtime-only var) lets the server reach the API
 * over the internal network (e.g. `http://api:3000`). Falls back to the public URL when unset.
 */
export function getServerApiBaseUrl(): string {
  const internal = process.env.API_INTERNAL_BASE_URL;
  return internal ? clean(internal) : getConfig().apiBaseUrl;
}
