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
    apiBaseUrl: clean(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'),
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
