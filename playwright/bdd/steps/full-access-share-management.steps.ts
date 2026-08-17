import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { PageSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const WORKSPACE_ID = 'c2b2e8a3-1df1-49d1-a451-deee5b7d0b7c';
const INVITE_PROBE_EMAIL = 'fa0522-out@appflowy.local';
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

const FULL_ACCESS_ACCOUNTS = {
  owner: 'fa0522-own@appflowy.local',
  'full access member': 'fa0522-fm@appflowy.local',
  'edit member': 'fa0522-em@appflowy.local',
  'target member': 'fa0522-tm@appflowy.local',
  'full access guest': 'fa0522-fg@appflowy.local',
  'edit guest': 'fa0522-eg@appflowy.local',
  'read guest': 'fa0522-rg@appflowy.local',
  'no share guest': 'fa0522-ng@appflowy.local',
  nonmember: 'fa0522-out@appflowy.local',
} as const;

const FULL_ACCESS_PAGES = {
  'owner control private page': {
    viewId: 'd8cc0f0a-201c-4e17-8e32-5e89ddad22ce',
    title: 'fa0522 Owner Control Private Page',
  },
  'member full access private page': {
    viewId: '7f5cd6d8-c6e8-4355-9427-a0b746f02826',
    title: 'fa0522 Member FullAccess Manage Private Page',
  },
  'member edit private page': {
    viewId: 'd9a01a15-045e-4ee6-943f-b12d5e8fb762',
    title: 'fa0522 Member Edit Only Private Page',
  },
  'guest full access private page': {
    viewId: 'ecc9f26a-6544-4910-a673-23c73f4072e1',
    title: 'fa0522 Guest FullAccess Manage Private Page',
  },
  'guest edit private page': {
    viewId: '98869de9-0fe7-4c2f-a0f8-3143cc0e6073',
    title: 'fa0522 Guest Edit Only Private Page',
  },
  'guest read only private page': {
    viewId: 'edda38c0-91e0-487a-9ace-31d799c05bd7',
    title: 'fa0522 Guest Read Only Private Page',
  },
} as const;

type FullAccessAccountAlias = keyof typeof FULL_ACCESS_ACCOUNTS;
type FullAccessPageAlias = keyof typeof FULL_ACCESS_PAGES;
type FullAccessPage = (typeof FULL_ACCESS_PAGES)[FullAccessPageAlias];

type ScenarioState = {
  currentPage?: FullAccessPage;
  pagesToRestore: FullAccessPage[];
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
    await restoreFullAccessSeededPageTitle(request, page, seededPage);
  }
});

Given('the seeded fa0522 full access share-management fixture exists', async () => {
  // This suite intentionally reuses the local fixture documented in
  // AppFlowy-Cloud-Premium/backup/README.md instead of creating accounts.
});

Given('I sign in as full access seeded {string}', async ({ page }, accountAliasValue: string) => {
  await signInWithPasswordViaUi(page, accountEmail(accountAliasValue), PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
});

When('I open the full access seeded {string}', async ({ page }, pageAliasValue: string) => {
  const seededPage = pageDefinition(pageAliasValue);

  getState(page).currentPage = seededPage;
  await page.goto(`/app/${WORKSPACE_ID}/${seededPage.viewId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
});

Then(
  'the full access share panel shows seeded {string} with {string}',
  async ({ page }, accountAliasValue: string, accessText: string) => {
    const email = accountEmail(accountAliasValue);
    const row = sharePersonRow(page, email);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(email, { exact: true }).first()).toBeVisible();
    await expect(row.getByText(accessText, { exact: true }).first()).toBeVisible();
  }
);

Then('the full access share panel can prepare an invite', async ({ page }) => {
  const input = inviteInput(page);

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => input.evaluate((element) => (element as HTMLInputElement).readOnly)).toBe(false);

  await input.fill(INVITE_PROBE_EMAIL);
  await input.press('Enter');
  await expect(ShareSelectors.inviteButton(page)).toBeEnabled({ timeout: 15000 });
});

Then('the full access invite access selector offers {string}', async ({ page }, accessText: string) => {
  const inviteAccessSelector = ShareSelectors.emailTagInput(page)
    .getByRole('button', { name: /Can view|Can edit|Full access/ })
    .first();

  await expect(inviteAccessSelector).toBeVisible({ timeout: 15000 });
  await inviteAccessSelector.click({ force: true });
  await expect(page.getByText(accessText, { exact: true }).last()).toBeVisible({ timeout: 15000 });

  if (accessText === 'Full access') {
    await expect(page.getByText('Can edit and share with others', { exact: true })).toBeVisible({ timeout: 15000 });
  }
});

Then('the full access share panel invite controls are read-only', async ({ page }) => {
  const input = inviteInput(page);

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => input.evaluate((element) => (element as HTMLInputElement).readOnly)).toBe(true);
  await expect(ShareSelectors.inviteButton(page)).toBeDisabled();
  await expect(
    ShareSelectors.emailTagInput(page).getByRole('button', { name: /Can view|Can edit|Full access/ })
  ).toHaveCount(0);
});

Then('the full access seeded page title is visible', async ({ page }) => {
  const seededPage = requireCurrentPage(getState(page));

  await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
});

Then('the full access page title is editable', async ({ page }) => {
  await expect(PageSelectors.titleInput(page).first()).toBeVisible({ timeout: 15000 });
});

Then('the full access page title cannot be edited to {string}', async ({ page }, blockedTitle: string) => {
  const seededPage = requireCurrentPage(getState(page));
  const originalTitle = page.getByText(seededPage.title, { exact: true }).first();
  const titleInput = PageSelectors.titleInput(page).first();

  await expect(originalTitle).toBeVisible({ timeout: 30000 });

  if ((await titleInput.count()) > 0 && (await titleInput.isVisible().catch(() => false))) {
    await titleInput.click({ force: true });
    await page.keyboard.press(`${modKey}+A`);
    await page.keyboard.type(blockedTitle, { delay: 20 });
    await page.keyboard.press('Enter');
  } else {
    await originalTitle.click({ force: true });
    await page.keyboard.press(`${modKey}+A`);
    await page.keyboard.type(blockedTitle, { delay: 20 });
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(1500);
  await expect(page.getByText(blockedTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 15000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(blockedTitle, { exact: true })).toHaveCount(0);
});

When('I rename the full access page title to {string}', async ({ page }, newTitle: string) => {
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

Then('the full access page title is {string}', async ({ page }, expectedTitle: string) => {
  const editableTitle = PageSelectors.titleInput(page).first();

  if (await editableTitle.isVisible().catch(() => false)) {
    await expect(editableTitle).toHaveText(expectedTitle, { timeout: 15000 });
    return;
  }

  await expect(page.getByText(expectedTitle, { exact: true }).first()).toBeVisible({ timeout: 15000 });
});

Then(
  'the full access seeded {string} access menu only allows removing self',
  async ({ page }, accountAliasValue: string) => {
    const row = sharePersonRow(page, accountEmail(accountAliasValue));
    const accessButton = row.getByRole('button', { name: /Can view|Can edit|Can comment/ }).first();

    await expect(accessButton).toBeVisible({ timeout: 15000 });
    await accessButton.click({ force: true });

    const menu = page.locator('[role="menu"]').last();

    await expect(menu).toBeVisible({ timeout: 15000 });
    await expect(menu.getByText('Remove access', { exact: true })).toBeVisible();
    await expect(menu.getByText('Full access', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Can edit', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Can view', { exact: true })).toHaveCount(0);
  }
);

Then('the full access seeded {string} is not opened', async ({ page }, pageAliasValue: string) => {
  const seededPage = pageDefinition(pageAliasValue);

  await expect(page.getByText(seededPage.title, { exact: true })).toHaveCount(0);
  await expect(ShareSelectors.shareButton(page)).toHaveCount(0);
});

function accountEmail(aliasValue: string): string {
  const alias = aliasValue as FullAccessAccountAlias;
  const email = FULL_ACCESS_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown full access seeded account alias: ${aliasValue}`);
  }

  return email;
}

function pageDefinition(aliasValue: string): (typeof FULL_ACCESS_PAGES)[FullAccessPageAlias] {
  const alias = aliasValue as FullAccessPageAlias;
  const seededPage = FULL_ACCESS_PAGES[alias];

  if (!seededPage) {
    throw new Error(`Unknown full access seeded page alias: ${aliasValue}`);
  }

  return seededPage;
}

function getState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('FullAccess share-management scenario state has not been initialized');
  }

  return state;
}

function requireCurrentPage(state: ScenarioState): FullAccessPage {
  if (!state.currentPage) {
    throw new Error('No full access seeded page is currently open for this scenario');
  }

  return state.currentPage;
}

function inviteInput(page: Page) {
  return ShareSelectors.emailTagInput(page).locator('input[type="text"]');
}

function sharePersonRow(page: Page, email: string) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: email }).first();
}

async function restoreFullAccessSeededPageTitle(request: APIRequestContext, page: Page, seededPage: FullAccessPage) {
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
      `Failed to restore full access seeded page ${seededPage.viewId}: HTTP ${response.status()} ${JSON.stringify(body)}`
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
