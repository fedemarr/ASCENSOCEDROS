import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: { headless: true, channel: 'msedge', screenshot: 'only-on-failure', trace: 'retain-on-failure' }
});
