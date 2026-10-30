import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  // Tests share real windows, the screen, the mouse and mpv
  workers: 1,
  fullyParallel: false,
  timeout: process.env['CI'] ? 90_000 : 60_000,
  expect: {timeout: process.env['CI'] ? 30_000 : 15_000},
  // The hosted Mac is a slow software-GL VM whose timing failures change from run to run: one more try there
  retries: process.env['CI'] ? (process.platform === 'darwin' ? 2 : 1) : 0,
  reporter: [['list'], ['html', {open: 'never'}]],
  outputDir: 'test-results',
  globalSetup: './test/e2e/support/global-setup.ts',
  globalTeardown: './test/e2e/support/global-teardown.ts',
});
