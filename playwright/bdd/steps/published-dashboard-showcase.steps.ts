import { expect, type BrowserContext, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  assertPublishedDashboard,
  assertSavedWorkspace,
  publishSelectedDashboard,
  requireUnpublishedFixture,
  savedDashboard,
  selectPublishedDashboard,
  unpublishFixture,
  type SavedDashboard,
} from '../../support/dashboard-publish-fixture-helpers';
import { browserAccessToken } from '../../support/dashboard-shared-helpers';
import { installRuntimeTestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

interface ScenarioState {
  fixture: SavedDashboard;
  token: string;
  publicationStarted: boolean;
  publishedUrl?: string;
  anonymousContext?: BrowserContext;
  anonymousPage?: Page;
}

const scenarios = new WeakMap<Page, ScenarioState>();

function stateFor(page: Page): ScenarioState {
  const state = scenarios.get(page);

  if (!state) throw new Error('The saved dashboard has not been opened');
  return state;
}

function publicPageFor(page: Page): Page {
  const publicPage = stateFor(page).anonymousPage;

  if (!publicPage) throw new Error('The anonymous visitor has not opened the publication');
  return publicPage;
}

Before({ tags: '@dashboard-publish-fixture' }, async ({ page, $testInfo }) => {
  $testInfo.setTimeout(300_000);
  expect(process.env.RUN_DASHBOARD_PUBLISH_FIXTURE, 'Explicitly opt in to the restored snapshot suite').toBe('1');
  // CLI overrides also enable request-fixture tracing, which a browser-context
  // stop cannot disable. Reject them before signing in with the fixture owner.
  const trace = $testInfo.project.use.trace;

  expect(typeof trace === 'object' ? trace.mode : trace, 'Saved dashboard tests require tracing off').toBe('off');
  await installRuntimeTestConfig(page.context());
});

After({ tags: '@dashboard-publish-fixture' }, async ({ page, request }) => {
  const state = scenarios.get(page);

  if (!state) return;
  try {
    await state.anonymousContext?.close();
  } finally {
    try {
      if (state.publicationStarted) await unpublishFixture(request, state.token, state.fixture);
    } finally {
      scenarios.delete(page);
    }
  }
});

Given('the saved {string} dashboard is ready to publish in Pro workspace', async ({ page, request }, key: string) => {
  const email = process.env.DASHBOARD_PUBLISH_FIXTURE_EMAIL;
  const password = process.env.DASHBOARD_PUBLISH_FIXTURE_PASSWORD;

  if (!email || !password) {
    throw new Error('Set DASHBOARD_PUBLISH_FIXTURE_EMAIL and DASHBOARD_PUBLISH_FIXTURE_PASSWORD privately before running');
  }

  const fixture = savedDashboard(key);

  await signInWithPasswordViaUi(page, email, password);
  const token = await browserAccessToken(page);

  await assertSavedWorkspace(request, token, fixture);
  await requireUnpublishedFixture(request, fixture);
  scenarios.set(page, { fixture, token, publicationStarted: false });
  await page.goto(`/app/${fixture.workspaceId}/${fixture.hostPageId}?v=${fixture.dashboardViewId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId(`view-tab-${fixture.dashboardViewId}`)).toHaveAttribute('data-state', 'active', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('dashboard-widget')).toHaveCount(fixture.widgets.length);
});

When('the owner publishes the selected saved dashboard through Share', async ({ page, request }) => {
  const state = stateFor(page);

  // Cleanup also runs when publication is only partially successful.
  state.publicationStarted = true;
  state.publishedUrl = await publishSelectedDashboard(page, request, state.token, state.fixture);
});

When('an anonymous visitor opens the published dashboard', async ({ page, browser }) => {
  const state = stateFor(page);

  if (!state.publishedUrl) throw new Error('No published URL');
  state.anonymousContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
  });
  await installRuntimeTestConfig(state.anonymousContext);
  state.anonymousPage = await state.anonymousContext.newPage();
  // Open the exact Share link. Legacy host publications may start on Grid;
  // select the dashboard using the public tab rather than manufacturing a URL.
  await state.anonymousPage.goto(state.publishedUrl, { waitUntil: 'domcontentloaded' });
  await selectPublishedDashboard(state.anonymousPage, state.fixture);
});

Then('every saved dashboard widget shows its expected source data', async ({ page }) => {
  await assertPublishedDashboard(publicPageFor(page), stateFor(page).fixture);
});

When('the anonymous visitor reloads the published dashboard', async ({ page }) => {
  await publicPageFor(page).reload({ waitUntil: 'domcontentloaded' });
});

When('the anonymous visitor opens the published database container and selects the saved dashboard', async ({ page }) => {
  const state = stateFor(page);
  const publicPage = publicPageFor(page);
  const space = publicPage.locator(`[data-testid="outline-item-${state.fixture.spaceId}"]:visible`).first();
  const container = publicPage.locator(`[data-testid="outline-item-${state.fixture.hostPageId}"]:visible`).first();

  await expect(space).toBeVisible({ timeout: 30_000 });
  const expandSpace = space.getByTestId('outline-toggle-expand');

  if (await expandSpace.isVisible()) await expandSpace.click();
  await expect(container).toBeVisible({ timeout: 30_000 });
  await container.getByTestId('page-name').click();
  await selectPublishedDashboard(publicPage, state.fixture);
  await expect.poll(() => ({
    pathname: new URL(publicPage.url()).pathname,
    selectedViewId: new URL(publicPage.url()).searchParams.get('v'),
  })).toEqual({
    pathname: new URL(state.publishedUrl!).pathname,
    selectedViewId: state.fixture.dashboardViewId,
  });
});
