import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  collaboratorAddsWidget,
  confirmDashboardWriteAccess,
  ensureFixtureDatabase,
  expectNoEditButton,
  loseDashboardWriteAccess,
  openDashboardViewTab,
  openDashboardWithViewsSideBySide,
  openEmptyDashboardWithoutConfirmedAccess,
  openLayoutViewTab,
} from '../../support/dashboard-platform-helpers';
import {
  addDashboardView,
  allWidgets,
  DashboardSelectors,
  openDatabasePage,
  readDashboardSetting,
  reloadDashboard,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

const WIDGET_TIMEOUT = { timeout: 30_000 };

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

Given('the {string} database is open', async ({ page, request }, database: string) => {
  await ensureFixtureDatabase(page, request, database);
  await openDatabasePage(page, database);
});

/**
 * Shared with WP03 (W2): a new dashboard whose first row shows two views of
 * the database side by side, open in View mode with both widgets rendered.
 */
Given(
  'a dashboard of {string} shows its {string} and {string} views side by side',
  async ({ page, request }, database: string, first: string, second: string) => {
    await openDashboardWithViewsSideBySide(page, request, database, first, second);
  }
);

Given('an empty dashboard of {string} is open', async ({ page, request }, database: string) => {
  await ensureFixtureDatabase(page, request, database);
  await addDashboardView(page, database);
});

Given(
  'an empty dashboard of {string} is open while my write access is not confirmed yet',
  async ({ page, request }, database: string) => {
    await openEmptyDashboardWithoutConfirmedAccess(page, request, database);
  }
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

When('I add a dashboard view to the {string} database', async ({ page }, database: string) => {
  await addDashboardView(page, database);
});

When('I reopen the dashboard', async ({ page }) => {
  await reloadDashboard(page);
});

When('my write access to the dashboard is lost', async ({ page }) => {
  await loseDashboardWriteAccess(page);
});

When('my write access to the dashboard is restored', async ({ page }) => {
  await confirmDashboardWriteAccess(page);
});

When('my write access to the dashboard is confirmed', async ({ page }) => {
  await confirmDashboardWriteAccess(page);
});

When('I open the {string} view tab of {string}', async ({ page }, layout: string, database: string) => {
  await openLayoutViewTab(page, database, layout);
});

When('I open the dashboard view tab', async ({ page }) => {
  await openDashboardViewTab(page);
});

When(
  'a collaborator adds the {string} view of {string} to the dashboard',
  async ({ page }, layout: string, database: string) => {
    await collaboratorAddsWidget(page, database, layout);
  }
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

Then('the dashboard offers no Edit button', async ({ page }) => {
  await expectNoEditButton(page);
});

Then('the dashboard has {int} widget(s)', async ({ page }, count: number) => {
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, WIDGET_TIMEOUT);
  await expect.poll(async () => allWidgets(await readDashboardSetting(page)).length).toBe(count);
});
