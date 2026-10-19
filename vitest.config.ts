import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/native/**', 'test/e2e/**']
  },
});
