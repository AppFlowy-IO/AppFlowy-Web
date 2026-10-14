import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/storybook/callout',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://localhost:6007', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm exec storybook dev -p 6007 --ci --no-open',
    url: 'http://localhost:6007',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'light',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 850 }, colorScheme: 'light' },
    },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 850 }, colorScheme: 'dark' } },
  ],
});
