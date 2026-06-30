import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@payorder/api`. Unit tests (domain, application, config) run
 * everywhere; integration tests that need a real PostgreSQL are guarded at runtime by the
 * `DATABASE_URL` env var and skip themselves when it is absent (see test/it-db.ts).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Integration suites (`*.it.test.ts`) share a single PostgreSQL database and TRUNCATE
    // between tests, so test files must not run concurrently against it.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**', 'src/infrastructure/config/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
