import { execFileSync } from 'node:child_process';

import { mockServerInfoPreservingCapabilities } from './server-info-helpers';

import type { Page } from '@playwright/test';


/**
 * Pro feature fixtures explicitly model an official cloud server, independent
 * of CI's localhost URL, and provide its active plans and subscription details.
 */
export async function mockProSubscription(page: Page): Promise<void> {
  await mockServerInfoPreservingCapabilities(page, { self_hosted: false });
  await mockProBillingResponses(page);
}

/** Isolate the external billing service while keeping real server capabilities. */
export async function mockProBillingResponses(page: Page): Promise<void> {
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

/**
 * Hosted release servers check the database before allowing Timeline creation.
 * Browser billing mocks only enable its menu, so give this fixture workspace
 * the same active Pro entitlement used by the backend's Timeline tests.
 * Supply only the disposable Postgres container used by these tests. The optional
 * database name selects a test database when it differs from the container default.
 * Self-hosted servers need no entitlement fixture; hosted debug builds enforce it too.
 */
export function grantTestProSubscription(page: Page): void {
  grantTestWorkspaceProSubscription(new URL(page.url()).pathname.split('/')[2]);
}

/** Grants only the fresh workspace owned by the calling test. */
export function grantTestWorkspaceProSubscription(workspaceId: string): void {
  const container = process.env.APPFLOWY_TEST_POSTGRES_CONTAINER;

  if (!container) {
    if (process.env.CI) throw new Error('CI must provide APPFLOWY_TEST_POSTGRES_CONTAINER for Timeline fixtures');
    return;
  }

  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new Error('Open a test workspace before granting its Pro subscription');
  }

  grantWorkspaceProSubscription(workspaceId);
}

/** `grantTestProSubscription` for a workspace the fixture already knows by id. */
export function grantWorkspaceProSubscription(workspaceId: string): void {
  const container = process.env.APPFLOWY_TEST_POSTGRES_CONTAINER;

  if (!container) {
    if (process.env.CI) throw new Error('CI must provide APPFLOWY_TEST_POSTGRES_CONTAINER for Pro fixtures');
    return;
  }

  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'sh',
      '-c',
      'exec psql -U "${POSTGRES_USER:-postgres}" -d "${2:-${POSTGRES_DB:-postgres}}" -v ON_ERROR_STOP=1 -v "workspace_id=$1"',
      'psql',
      workspaceId,
      process.env.APPFLOWY_TEST_POSTGRES_DATABASE ?? '',
    ],
    {
      // Pro = 1 in the server's SubscriptionPlan enum. The fixture-specific
      // ID makes repeat setup safe without modifying other subscriptions.
      input: `
        INSERT INTO af_workspace_subscription (workspace_id, subscription_id, workspace_plan, active)
        VALUES (:'workspace_id'::uuid, 'playwright-timeline-' || :'workspace_id', 1, TRUE)
        ON CONFLICT (workspace_id, subscription_id)
        DO UPDATE SET workspace_plan = EXCLUDED.workspace_plan, active = EXCLUDED.active;
      `,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}
