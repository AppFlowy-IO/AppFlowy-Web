import type { Page } from '@playwright/test';

/**
 * CI serves a production build against localhost, which follows hosted plan
 * checks but has no billing service. Feature tests for Pro workspaces must
 * provide both the workspace's active plans and the subscription details.
 */
export async function mockProSubscription(page: Page): Promise<void> {
  await page.route('**/billing/api/v1/active-subscription/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: ['pro'], message: '' }),
    });
  });
  await page.route('**/billing/api/v1/subscriptions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: [
          {
            plan: 'pro',
            currency: 'usd',
            price_cents: 0,
            recurring_interval: 'month',
          },
        ],
        message: '',
      }),
    });
  });
}
