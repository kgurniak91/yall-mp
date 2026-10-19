import { defineConfig } from 'vitest/config';

// Integration tests for the native addon (libmpv). They need the built addon and a libmpv, so they
// run separately from `test:electron` (see `npm run test:native`).
export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    include: ['test/native/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000
  },
});
