import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/extraction/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
    reporters: ['default'],
    // Integration test files (cross-tenant, rls-app-role, publish) all
    // share the same Postgres test DB and call `truncateAll()`. With
    // file-level parallelism enabled (Vitest default), one suite's
    // truncate wipes another's seed mid-test. Serialise file execution
    // so integration suites don't race; unit tests are fast enough
    // that the lost parallelism is negligible.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
