import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@payorder/shared` ships ESM compiled to `dist`; transpile it with the app so its
  // workspace sources resolve cleanly under the Next bundler.
  transpilePackages: ['@payorder/shared'],
  // Lint and typecheck run as dedicated steps at the repo root (CI), not during the build.
  eslint: { ignoreDuringBuilds: true },
  // Produce a self-contained server bundle for the Docker image — only the traced files plus
  // a minimal node_modules are emitted under `.next/standalone`. The tracing root is the
  // monorepo root so the workspace `@payorder/shared` dependency is traced and copied.
  output: 'standalone',
  outputFileTracingRoot: join(rootDir, '../../'),
};

export default nextConfig;
