import { defineConfig, devices } from '@playwright/test';

const port = process.env.CALLOUT_STORYBOOK_PORT || '6007';

export default defineConfig({
  testDir: './playwright/storybook/callout',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: `pnpm exec storybook dev -p ${port} --ci --no-open`,
    url: `http://localhost:${port}`,
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
