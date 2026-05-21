import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { PageSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const WORKSPACE_ID = 'cd3c4886-8da8-468f-b633-f7e257ef288d';
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

const SEEDED_ACCOUNTS = {
  owner: 'rm0521-own@appflowy.local',
  'co-owner': 'rm0521-co@appflowy.local',
  member: 'rm0521-mem@appflowy.local',
  'guest reader': 'rm0521-r@appflowy.local',
  'guest writer': 'rm0521-w@appflowy.local',
  'guest no share': 'rm0521-gst@appflowy.local',
  nonmember: 'rm0521-out@appflowy.local',
} as const;

const SEEDED_PAGES = {
  'public page': {
    viewId: 'a85edd27-22fe-4a3a-8857-65efa48ba17a',
    title: 'rm0521 Public Page',
  },
  'owner unshared private page': {
    viewId: 'e667c364-2151-4e8d-8c2e-a289e0fe8fc1',
    title: 'rm0521 Owner Unshared Private Page',
  },
  'owner member write private page': {
    viewId: '50cc9de9-df1a-4bdd-8695-f0afd5bb5f9c',
    title: 'rm0521 Owner Shared To Member Write Private Page',
  },
  'owner guest read private page': {
    viewId: 'e86a25be-4e4d-4a9e-9080-fe32015502d7',
    title: 'rm0521 Owner Shared To Guest Read Private Page',
  },
  'owner guest write private page': {
    viewId: '92c09a6c-0134-4c56-bc6c-8ad85680f7f5',
    title: 'rm0521 Owner Shared To Guest Write Private Page',
  },
} as const;

type SeededAccountAlias = keyof typeof SEEDED_ACCOUNTS;
type SeededPageAlias = keyof typeof SEEDED_PAGES;
type SeededPage = (typeof SEEDED_PAGES)[SeededPageAlias];

type ScenarioState = {
  currentPage?: SeededPage;
  pagesToRestore: SeededPage[];
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { pagesToRestore: [] });
});

After(async ({ page, request }) => {
  const state = getState(page);

  for (const seededPage of state.pagesToRestore) {
    await restoreSeededPageTitle(request, page, seededPage);
  }
});

Given('the seeded rm0521 role matrix fixture exists', async () => {
  // This BDD suite intentionally reuses the local fixture documented in
  // AppFlowy-Cloud-Premium/backup/README.md instead of creating accounts.
});

Given('I sign in as seeded {string}', async ({ page }, accountAliasValue: string) => {
  const email = accountEmail(accountAliasValue);

  await signInWithPasswordViaUi(page, email, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
});

When('I open the seeded {string}', async ({ page }, pageAliasValue: string) => {
  const seededPage = pageDefinition(pageAliasValue);
  const state = getState(page);

  state.currentPage = seededPage;
  await page.goto(`/app/${WORKSPACE_ID}/${seededPage.viewId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
});

When('I open the share panel', async ({ page }) => {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.shareButton(page).evaluate((element: HTMLElement) => element.click());
  await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 15000 });
  await expect(ShareSelectors.sharePopover(page).getByText('People with access', { exact: true })).toBeVisible({
    timeout: 15000,
  });
});

When('I rename the page title to {string}', async ({ page }, newTitle: string) => {
  const state = getState(page);
  const seededPage = requireCurrentPage(state);
  const titleInput = PageSelectors.titleInput(page).first();

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  state.pagesToRestore.push(seededPage);

  await titleInput.click({ force: true });
  await page.keyboard.press(`${modKey}+A`);
  await page.keyboard.type(newTitle, { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(titleInput).toHaveText(newTitle, { timeout: 15000 });
  await page.waitForTimeout(1500);
});

Then('the seeded page title is visible', async ({ page }) => {
  const seededPage = requireCurrentPage(getState(page));

  await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
});

Then('the seeded page title is not visible', async ({ page }) => {
  const seededPage = requireCurrentPage(getState(page));

  await expect(page.getByText(seededPage.title, { exact: true })).toHaveCount(0);
});

Then('the page title is {string}', async ({ page }, expectedTitle: string) => {
  const editableTitle = PageSelectors.titleInput(page).first();

  if (await editableTitle.isVisible().catch(() => false)) {
    await expect(editableTitle).toHaveText(expectedTitle, { timeout: 15000 });
    return;
  }

  await expect(page.getByText(expectedTitle, { exact: true }).first()).toBeVisible({ timeout: 15000 });
});

Then('the page title is read-only', async ({ page }) => {
  await expect(PageSelectors.titleInput(page)).toHaveCount(0);
});

Then('the page title is editable', async ({ page }) => {
  await expect(PageSelectors.titleInput(page).first()).toBeVisible({ timeout: 15000 });
});

Then(
  'the share panel shows seeded {string} with {string}',
  async ({ page }, accountAliasValue: string, accessText: string) => {
    const email = accountEmail(accountAliasValue);
    const row = sharePersonRow(page, email);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(email, { exact: true }).first()).toBeVisible();
    await expect(row.getByText(accessText, { exact: true }).first()).toBeVisible();
  }
);

Then('the share panel does not show seeded {string}', async ({ page }, accountAliasValue: string) => {
  const email = accountEmail(accountAliasValue);
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover.getByText(email, { exact: true })).toHaveCount(0);
});

Then('the share panel general access is {string}', async ({ page }, accessText: string) => {
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover.getByText('General access', { exact: true })).toBeVisible();
  await expect(popover.getByText(accessText, { exact: true })).toBeVisible();
});

Then('the no access page is shown', async ({ page }) => {
  await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Request access' }).first()).toBeVisible({ timeout: 15000 });
});

function getState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Seeded role matrix scenario state has not been initialized');
  }

  return state;
}

function accountEmail(aliasValue: string): string {
  const alias = aliasValue as SeededAccountAlias;
  const email = SEEDED_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown seeded account alias: ${aliasValue}`);
  }

  return email;
}

function pageDefinition(aliasValue: string): SeededPage {
  const alias = aliasValue as SeededPageAlias;
  const seededPage = SEEDED_PAGES[alias];

  if (!seededPage) {
    throw new Error(`Unknown seeded page alias: ${aliasValue}`);
  }

  return seededPage;
}

function requireCurrentPage(state: ScenarioState): SeededPage {
  if (!state.currentPage) {
    throw new Error('No seeded page is currently open for this scenario');
  }

  return state.currentPage;
}

function sharePersonRow(page: Page, email: string) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: email }).first();
}

async function restoreSeededPageTitle(request: APIRequestContext, page: Page, seededPage: SeededPage) {
  const token = await getAuthToken(page);

  if (!token) {
    throw new Error(`Cannot restore ${seededPage.viewId}: no auth token in browser storage`);
  }

  const response = await request.post(
    `${TestConfig.apiUrl}/api/workspace/${WORKSPACE_ID}/page-view/${seededPage.viewId}/update-name`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { name: seededPage.title },
      failOnStatusCode: false,
    }
  );
  const body = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(
      `Failed to restore seeded page ${seededPage.viewId}: HTTP ${response.status()} ${JSON.stringify(body)}`
    );
  }
}

async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const directToken = localStorage.getItem('af_auth_token');

    if (directToken) return directToken;

    const rawToken = localStorage.getItem('token');

    if (!rawToken) return '';

    try {
      return (JSON.parse(rawToken) as { access_token?: string }).access_token || '';
    } catch {
      return '';
    }
  });
}
