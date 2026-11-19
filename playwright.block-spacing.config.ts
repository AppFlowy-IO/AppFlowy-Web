import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/storybook/block-spacing',
  forbidOnly: !!process.env.CI,
  workers: 1,
  timeout: 60000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:6008',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'pnpm exec storybook dev -p 6008 --ci --no-open',
    url: 'http://localhost:6008',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
