import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  DatabaseGridSelectors,
  PageSelectors,
  PropertyMenuSelectors,
  RowDetailSelectors,
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const INVITE_PROBE_EMAIL = 'fa0522-out@appflowy.local';
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
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
    viewId: 'f8d677a2-cb1f-4a93-9ca1-5449b791a5e4',
    title: 'fa0522 Owner Control Private Page',
  },
  'member full access private page': {
    viewId: '93f3783e-1777-4718-a467-d11a19824968',
    title: 'fa0522 Member FullAccess Manage Private Page',
  },
  'member edit private page': {
    viewId: '446b9a2d-293e-4e06-8379-75fafdf2e9a4',
    title: 'fa0522 Member Edit Only Private Page',
  },
  'guest full access private page': {
    viewId: '45ed683e-8ed1-4872-8b28-dc6a61937485',
    title: 'fa0522 Guest FullAccess Manage Private Page',
  },
  'guest edit private page': {
    viewId: 'f93e1946-32d3-49be-a5f8-2801309a5d33',
    title: 'fa0522 Guest Edit Only Private Page',
  },
  'guest read only private page': {
    viewId: '43230138-2cda-4d96-af0f-2fa5522f054c',
    title: 'fa0522 Guest Read Only Private Page',
  },
} as const;

type FullAccessAccountAlias = keyof typeof FULL_ACCESS_ACCOUNTS;
type FullAccessPageAlias = keyof typeof FULL_ACCESS_PAGES;
type FullAccessPageDefinition = (typeof FULL_ACCESS_PAGES)[FullAccessPageAlias];
type FullAccessPage = FullAccessPageDefinition & {
  workspaceId: string;
};

type ScenarioState = {
  workspaceId?: string;
  fixturePages?: Partial<Record<FullAccessPageAlias, FullAccessPage>>;
  currentPage?: FullAccessPage;
  pagesToRestore: FullAccessPage[];
  accessLevelsToRestore: AccessLevelRestore[];
  temporaryDatabase?: TemporaryDatabase;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

type AccessLevelRestore = {
  page: FullAccessPage;
  email: string;
  accessLevel: number;
};

type TemporaryDatabase = {
  workspaceId: string;
  viewId: string;
};

type Workspace = {
  workspace_id: string;
  role?: string;
};

type FolderView = {
  view_id: string;
  name: string;
  children?: FolderView[];
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { pagesToRestore: [], accessLevelsToRestore: [] });
});

After(async ({ page, request }) => {
  const state = getState(page);

  for (const seededPage of state.pagesToRestore) {
    await restoreFullAccessSeededPageTitle(request, page, seededPage);
  }

  for (const restore of state.accessLevelsToRestore) {
    await restoreFullAccessSeededPageAccess(request, restore);
  }

  if (state.temporaryDatabase) {
    await cleanupTemporaryDatabase(request, state.temporaryDatabase);
  }
});

Given('the seeded fa0522 full access share-management fixture exists', async () => {
  // This suite intentionally reuses the local fixture documented in
  // AppFlowy-Cloud-Premium/backup/README.md instead of creating accounts.
});

Given('I sign in as full access seeded {string}', async ({ page }, accountAliasValue: string) => {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, accountEmail(accountAliasValue), PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
});

When('I open the full access seeded {string}', async ({ page, request }, pageAliasValue: string) => {
  const seededPage = await resolveFullAccessPage(request, getState(page), pageAliasValue);

  getState(page).currentPage = seededPage;
  await page.goto(`/app/${seededPage.workspaceId}/${seededPage.viewId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
});

Given(
  'I create a temporary full access grid database shared with seeded {string} as {string}',
  async ({ page, request }, accountAliasValue: string, accessText: string) => {
    const state = getState(page);
    const email = accountEmail(accountAliasValue);
    const ownerToken = await getAuthToken(page);

    if (!ownerToken) {
      throw new Error('Cannot create temporary full access database: no owner auth token in browser storage');
    }

    const workspaceId = await ensureFullAccessWorkspaceId(request, state);

    await createDatabaseView(page, 'Grid', 7000);
    await waitForGridReady(page);
    await waitForTemporaryDatabaseCellsLoaded(page);

    const viewId = currentViewIdFromUrl(page.url());

    state.temporaryDatabase = { workspaceId, viewId };

    await putVoidApi(request, ownerToken, `/api/sharing/workspace/${workspaceId}/view`, {
      view_id: viewId,
      emails: [email],
      access_level: accessLevelFromText(accessText),
    });
  }
);

When('I open the temporary full access database', async ({ page }) => {
  const temporaryDatabase = requireTemporaryDatabase(getState(page));

  await page.goto(`/app/${temporaryDatabase.workspaceId}/${temporaryDatabase.viewId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(1500);
  await waitForGridReady(page);
  await waitForTemporaryDatabaseCellsLoaded(page);
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

When(
  'the full access owner grants seeded {string} {string} on the current page',
  async ({ page, request }, accountAliasValue: string, accessText: string) => {
    const state = getState(page);
    const seededPage = requireCurrentPage(state);
    const email = accountEmail(accountAliasValue);
    const nextAccessLevel = accessLevelFromText(accessText);
    const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);

    state.accessLevelsToRestore.push({
      page: seededPage,
      email,
      accessLevel: originalAccessLevelFor(seededPage, email),
    });

    await putVoidApi(request, ownerToken, `/api/sharing/workspace/${seededPage.workspaceId}/view`, {
      view_id: seededPage.viewId,
      emails: [email],
      access_level: nextAccessLevel,
    });

    await page.waitForTimeout(1500);
  }
);

When(
  'the full access owner revokes seeded {string} on the current page',
  async ({ page, request }, accountAliasValue: string) => {
    const state = getState(page);
    const seededPage = requireCurrentPage(state);
    const email = accountEmail(accountAliasValue);
    const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);

    state.accessLevelsToRestore.push({
      page: seededPage,
      email,
      accessLevel: originalAccessLevelFor(seededPage, email),
    });

    await postVoidApi(
      request,
      ownerToken,
      `/api/sharing/workspace/${seededPage.workspaceId}/view/${seededPage.viewId}/revoke-access`,
      {
        emails: [email],
      }
    );

    await page.waitForTimeout(1500);
  }
);

Then('the full access page title is {string}', async ({ page }, expectedTitle: string) => {
  const editableTitle = PageSelectors.titleInput(page).first();

  if (await editableTitle.isVisible().catch(() => false)) {
    await expect(editableTitle).toHaveText(expectedTitle, { timeout: 15000 });
    return;
  }

  await expect(page.getByText(expectedTitle, { exact: true }).first()).toBeVisible({ timeout: 15000 });
});

Then('the full access page title is read-only', async ({ page }) => {
  await expect(PageSelectors.titleInput(page)).toHaveCount(0);
});

Then('the full access no access page is shown', async ({ page }) => {
  await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Request access' }).first()).toBeVisible({ timeout: 15000 });
  await expect(PageSelectors.titleInput(page)).toHaveCount(0);
  await expect(ShareSelectors.shareButton(page)).toHaveCount(0);
});

Then('the temporary full access database is read-only', async ({ page }) => {
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.newRowButton(page)).toHaveCount(0);
  await expect(PropertyMenuSelectors.newPropertyButton(page)).toHaveCount(0);
});

Then('typing in the temporary full access database first cell has no effect', async ({ page }) => {
  await waitForTemporaryDatabaseCellsLoaded(page);

  const firstCell = DatabaseGridSelectors.cells(page).first();

  await expect(firstCell).toBeVisible({ timeout: 30000 });

  const before = (await firstCell.innerText()).trim();
  const wrapperHandle = await firstCell.evaluateHandle((element) => element.closest('.grid-row-cell') ?? element);
  const wrapper = wrapperHandle.asElement();

  if (wrapper) {
    await wrapper.click({ force: true });
  } else {
    await firstCell.click({ force: true });
  }

  await page.keyboard.type('fa0522 readonly database stale edit');
  await page.keyboard.press('Enter').catch(() => undefined);
  await page.waitForTimeout(1000);

  await expect(firstCell.locator('textarea')).toHaveCount(0);
  await expect.poll(async () => (await firstCell.innerText()).trim()).toBe(before);
});

When('I open the temporary full access database first row document', async ({ page }) => {
  await waitForGridReady(page);
  await waitForTemporaryDatabaseCellsLoaded(page);
  await openTemporaryDatabaseRowDocument(page, 0);
});

Then('the temporary full access database row document is read-only', async ({ page }) => {
  await scrollRowDocumentIntoView(page);

  const titleInput = RowDetailSelectors.titleInput(page);
  const editor = rowDocumentEditor(page);

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await expect(titleInput).toHaveJSProperty('readOnly', true);

  if ((await editor.count()) > 0) {
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect(editor).toHaveAttribute('contenteditable', 'false');
  }
});

Then('typing in the temporary full access database row document has no effect', async ({ page }) => {
  await scrollRowDocumentIntoView(page);

  const titleInput = RowDetailSelectors.titleInput(page);
  const editor = rowDocumentEditor(page);
  const sentinel = 'fa0522 readonly row document stale edit';

  await expect(titleInput).toBeVisible({ timeout: 15000 });

  if ((await editor.count()) === 0) {
    const beforeTitle = await titleInput.inputValue();

    await titleInput.click({ force: true }).catch(() => undefined);
    await page.keyboard.type(sentinel);
    await page.waitForTimeout(1000);

    await expect(titleInput).toHaveValue(beforeTitle);
    await expect(page.getByText(sentinel, { exact: true })).toHaveCount(0);
    return;
  }

  const before = (await editor.textContent()) ?? '';

  await editor.click({ force: true }).catch(() => undefined);
  await page.keyboard.type(sentinel);
  await page.waitForTimeout(1000);

  await expect(editor).not.toContainText(sentinel);
  await expect(editor).toHaveText(before);
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

function pageDefinition(aliasValue: string): FullAccessPageDefinition {
  const alias = aliasValue as FullAccessPageAlias;
  const seededPage = FULL_ACCESS_PAGES[alias];

  if (!seededPage) {
    throw new Error(`Unknown full access seeded page alias: ${aliasValue}`);
  }

  return seededPage;
}

async function resolveFullAccessPage(
  request: APIRequestContext,
  state: ScenarioState,
  aliasValue: string
): Promise<FullAccessPage> {
  const alias = aliasValue as FullAccessPageAlias;
  const seededPage = pageDefinition(aliasValue);
  const cachedPage = state.fixturePages?.[alias];

  if (cachedPage) {
    return cachedPage;
  }

  const workspaceId = await ensureFullAccessWorkspaceId(request, state);
  const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);
  const root = await getApi<FolderView>(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/view/${workspaceId}?depth=50`
  );
  const viewId = findViewIdByTitle(root, seededPage.title);
  const resolvedPage = { ...seededPage, viewId, workspaceId };

  state.fixturePages = {
    ...state.fixturePages,
    [alias]: resolvedPage,
  };

  return resolvedPage;
}

async function ensureFullAccessWorkspaceId(request: APIRequestContext, state: ScenarioState): Promise<string> {
  if (state.workspaceId) {
    return state.workspaceId;
  }

  const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);
  const workspaces = await getApi<Workspace[]>(request, ownerToken, '/api/workspace?include_member_count=true');
  const workspace = workspaces.find((candidate) => candidate.role === 'Owner') ?? workspaces[0];

  if (!workspace?.workspace_id) {
    throw new Error('FullAccess seeded owner has no workspace');
  }

  state.workspaceId = workspace.workspace_id;
  return state.workspaceId;
}

function findViewIdByTitle(view: FolderView, title: string): string {
  if (view.name === title) {
    return view.view_id;
  }

  for (const child of view.children ?? []) {
    try {
      return findViewIdByTitle(child, title);
    } catch {
      // Continue searching siblings.
    }
  }

  throw new Error(`Unable to find full access seeded view title: ${title}`);
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

function requireTemporaryDatabase(state: ScenarioState): TemporaryDatabase {
  if (!state.temporaryDatabase) {
    throw new Error('No temporary full access database has been created for this scenario');
  }

  return state.temporaryDatabase;
}

function inviteInput(page: Page) {
  return ShareSelectors.emailTagInput(page).locator('input[type="text"]');
}

function rowDocumentEditor(page: Page) {
  return page.getByTestId('editor-content').first();
}

async function waitForTemporaryDatabaseCellsLoaded(page: Page) {
  const firstCell = DatabaseGridSelectors.cells(page).first();

  await expect(firstCell).toBeVisible({ timeout: 30000 });
  await expect(firstCell.locator('[data-testid^="primary-cell-loading-"]')).toHaveCount(0, {
    timeout: 30000,
  });
}

async function scrollRowDocumentIntoView(page: Page) {
  const modalScrollContainer = RowDetailSelectors.modal(page)
    .locator('.appflowy-scroll-container')
    .first();
  const scrollContainer = (await modalScrollContainer.count()) > 0
    ? modalScrollContainer
    : page.locator('.appflowy-scroll-container').first();

  if ((await scrollContainer.count()) === 0) {
    return;
  }

  await scrollContainer.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await page.waitForTimeout(500);
}

async function openTemporaryDatabaseRowDocument(page: Page, rowIndex: number) {
  const row = DatabaseGridSelectors.dataRows(page).nth(rowIndex);

  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(500);

  const expandButton = page.getByTestId('row-expand-button').first();

  await expect(expandButton).toBeVisible({ timeout: 5000 });
  await expandButton.click({ force: true });

  await expect
    .poll(
      async () =>
        (await RowDetailSelectors.modal(page).count()) > 0 ||
        (await RowDetailSelectors.titleInput(page).count()) > 0,
      {
        timeout: 15000,
      }
    )
    .toBe(true);
}

function accessLevelFromText(accessText: string): number {
  switch (accessText) {
    case 'Can view':
      return ACCESS_LEVEL_READ_ONLY;
    case 'Can edit':
      return ACCESS_LEVEL_READ_AND_WRITE;
    default:
      throw new Error(`Unsupported full access seeded access level: ${accessText}`);
  }
}

function originalAccessLevelFor(page: FullAccessPage, email: string): number {
  if (page.title === FULL_ACCESS_PAGES['guest read only private page'].title) {
    return ACCESS_LEVEL_READ_ONLY;
  }

  if (
    page.title === FULL_ACCESS_PAGES['guest edit private page'].title &&
    email === FULL_ACCESS_ACCOUNTS['edit guest']
  ) {
    return ACCESS_LEVEL_READ_AND_WRITE;
  }

  throw new Error(`No original access level mapping for ${email} on ${page.viewId}`);
}

function currentViewIdFromUrl(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const viewId = segments[2];

  if (!viewId) {
    throw new Error(`Unable to parse view id from current URL: ${url}`);
  }

  return viewId;
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
    `${TestConfig.apiUrl}/api/workspace/${seededPage.workspaceId}/page-view/${seededPage.viewId}/update-name`,
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
      `Failed to restore full access seeded page ${seededPage.viewId}: ` +
        `HTTP ${response.status()} ${JSON.stringify(body)}`
    );
  }
}

async function restoreFullAccessSeededPageAccess(request: APIRequestContext, restore: AccessLevelRestore) {
  const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);

  await putVoidApi(request, ownerToken, `/api/sharing/workspace/${restore.page.workspaceId}/view`, {
    view_id: restore.page.viewId,
    emails: [restore.email],
    access_level: restore.accessLevel,
  });
}

async function cleanupTemporaryDatabase(request: APIRequestContext, temporaryDatabase: TemporaryDatabase) {
  const ownerToken = await getPasswordAuthToken(request, FULL_ACCESS_ACCOUNTS.owner);

  await postVoidApiAllowFailure(
    request,
    ownerToken,
    `/api/workspace/${temporaryDatabase.workspaceId}/page-view/${temporaryDatabase.viewId}/move-to-trash`,
    `move temporary full access database ${temporaryDatabase.viewId} to trash`
  );
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function putVoidApi(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await request.put(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }
}

async function postVoidApi(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }
}

async function postVoidApiAllowFailure(
  request: APIRequestContext,
  token: string,
  path: string,
  label: string
): Promise<void> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    console.warn(`Failed to ${label}: HTTP ${response.status()} ${await response.text()}`);
  }
}

async function getPasswordAuthToken(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      email,
      password: PASSWORD,
    },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;

  if (!response.ok() || !body?.access_token) {
    throw new Error(`Failed to sign in ${email} for API token: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body.access_token;
}

async function resetBrowserSession(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    const indexedDatabase = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };

    if (!indexedDatabase.databases) return;

    const databases = await indexedDatabase.databases();
    await Promise.all(
      databases
        .map((database) => database.name)
        .filter((name): name is string => Boolean(name))
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(name);

              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            })
        )
    );
  });
  await page.context().clearCookies();
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
