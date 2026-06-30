/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@payorder/shared` ships ESM compiled to `dist`; transpile it with the app so its
  // workspace sources resolve cleanly under the Next bundler.
  transpilePackages: ['@payorder/shared'],
  // Lint and typecheck run as dedicated steps at the repo root (CI), not during the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
