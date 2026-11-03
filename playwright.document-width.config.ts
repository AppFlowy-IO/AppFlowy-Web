import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/storybook/document-width',
  workers: 1,
  timeout: 60000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:6008',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec storybook dev -p 6008 --ci --no-open',
    url: 'http://localhost:6008',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
