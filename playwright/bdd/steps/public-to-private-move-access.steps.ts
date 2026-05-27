import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  PageSelectors,
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const SPACE_PERMISSION_PUBLIC = 0;
const SPACE_PERMISSION_PRIVATE = 1;
const ACCESS_LEVEL_READ_ONLY = 10;
const VIEW_LAYOUT_DOCUMENT = 0;

const SEEDED_ACCOUNTS = {
  owner: 'ptp0527-own@appflowy.local',
  'member 1': 'ptp0527-m1@appflowy.local',
  'member 2': 'ptp0527-m2@appflowy.local',
  'member 3': 'ptp0527-m3@appflowy.local',
} as const;

type SeededAccountAlias = keyof typeof SEEDED_ACCOUNTS;

type ScenarioState = {
  runId: string;
  workspaceId?: string;
  ownerToken?: string;
  movablePage?: TemporaryView;
  privateTarget?: TemporaryView;
};

type TemporaryView = {
  spaceId: string;
  spaceName: string;
  pageId: string;
  pageTitle: string;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type Workspace = {
  workspace_id: string;
  role?: string;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { runId: Date.now().toString(36) });
});

After(async ({ page, request }) => {
  await cleanupTemporaryViews(request, getState(page));
});

Given('the seeded ptp0527 public-to-private fixture exists', async () => {
  // Created by AppFlowy-Cloud-Premium:
  // PUBLIC_TO_PRIVATE_WEB_PREFIX=ptp0527 cargo test --test public_to_private_access_seed ...
});

Given('I sign in as seeded public-to-private {string}', async ({ page, request }, accountAliasValue: string) => {
  const state = getState(page);
  const email = accountEmail(accountAliasValue);

  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, email, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

  if (accountAliasValue === 'owner') {
    const token = await getAuthToken(page);

    if (!token) {
      throw new Error('Cannot use public-to-private owner: no auth token in browser storage');
    }

    state.ownerToken = token;
    state.workspaceId = await loadSeededWorkspaceId(request, token);
  }
});

Given('I create a temporary public-to-private public space page', async ({ page, request }) => {
  const state = getState(page);
  const workspaceId = requireWorkspaceId(state);
  const ownerToken = requireOwnerToken(state);
  const spaceName = `ptp0527 BDD Public Space ${state.runId}`;
  const pageTitle = `ptp0527 BDD Movable Public Page ${state.runId}`;
  const space = await postApi<{ view_id: string }>(request, ownerToken, `/api/workspace/${workspaceId}/space`, {
    name: spaceName,
    space_icon: 'icon',
    space_icon_color: '#000000',
    space_permission: SPACE_PERMISSION_PUBLIC,
  });
  const pageResponse = await postApi<{ view_id: string }>(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: space.view_id,
      layout: VIEW_LAYOUT_DOCUMENT,
      name: pageTitle,
    }
  );

  state.movablePage = {
    spaceId: space.view_id,
    spaceName,
    pageId: pageResponse.view_id,
    pageTitle,
  };
});

Given(
  'I create a temporary public-to-private private target page shared with {string}',
  async ({ page, request }, accountAliasValue: string) => {
    const state = getState(page);
    const workspaceId = requireWorkspaceId(state);
    const ownerToken = requireOwnerToken(state);
    const sharedEmail = accountEmail(accountAliasValue);
    const spaceName = `ptp0527 BDD Private Space ${state.runId}`;
    const pageTitle = `ptp0527 BDD Private Target Page ${state.runId}`;
    const space = await postApi<{ view_id: string }>(request, ownerToken, `/api/workspace/${workspaceId}/space`, {
      name: spaceName,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: SPACE_PERMISSION_PRIVATE,
    });
    const pageResponse = await postApi<{ view_id: string }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/page-view`,
      {
        parent_view_id: space.view_id,
        layout: VIEW_LAYOUT_DOCUMENT,
        name: pageTitle,
      }
    );

    state.privateTarget = {
      spaceId: space.view_id,
      spaceName,
      pageId: pageResponse.view_id,
      pageTitle,
    };

    await putVoidApi(request, ownerToken, `/api/sharing/workspace/${workspaceId}/view`, {
      view_id: pageResponse.view_id,
      emails: [sharedEmail],
      access_level: ACCESS_LEVEL_READ_ONLY,
    });
  }
);

When('I open the temporary public-to-private movable page', async ({ page }) => {
  const state = getState(page);
  const workspaceId = requireWorkspaceId(state);
  const movablePage = requireMovablePage(state);

  await page.goto(`/app/${workspaceId}/${movablePage.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
});

When('I open the public-to-private share panel', async ({ page }) => {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.shareButton(page).evaluate((element: HTMLElement) => element.click());
  await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 15000 });
  await expect(ShareSelectors.sharePopover(page).getByText('People with access', { exact: true })).toBeVisible({
    timeout: 15000,
  });
});

When('I move the temporary public-to-private page under the private target page', async ({ page, request }) => {
  const state = getState(page);
  const workspaceId = requireWorkspaceId(state);
  const ownerToken = requireOwnerToken(state);
  const movablePage = requireMovablePage(state);
  const privateTarget = requirePrivateTarget(state);

  await postVoidApi(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/page-view/${movablePage.pageId}/move`,
    {
      new_parent_view_id: privateTarget.pageId,
      prev_view_id: null,
    }
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
});

Then('the temporary public-to-private movable page title is visible', async ({ page }) => {
  const movablePage = requireMovablePage(getState(page));

  await expect(page.getByText(movablePage.pageTitle, { exact: true }).first()).toBeVisible({ timeout: 30000 });
});

Then('the public-to-private share panel only shows {string}', async ({ page }, aliasesValue: string) => {
  const expectedEmails = parseAccountAliases(aliasesValue).map(accountEmail);
  const popover = ShareSelectors.sharePopover(page);
  const peopleRows = sharePeopleRows(page);

  await expect(peopleRows).toHaveCount(expectedEmails.length);

  for (const email of expectedEmails) {
    await expect(sharePersonRow(page, email)).toBeVisible({ timeout: 15000 });
  }

  for (const email of Object.values(SEEDED_ACCOUNTS)) {
    const expected = expectedEmails.includes(email);

    if (expected) {
      await expect(sharePersonRow(page, email)).toBeVisible();
    } else {
      await expect(popover.getByText(email, { exact: true })).toHaveCount(0);
    }
  }
});

Then('the public-to-private share panel shows {string} with {string}', async ({ page }, aliasValue: string, accessText: string) => {
  const email = accountEmail(aliasValue);
  const row = sharePersonRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText(email, { exact: true }).first()).toBeVisible();
  await expect(row.getByText(accessText, { exact: true }).first()).toBeVisible();
});

Then('the public-to-private share panel does not show {string}', async ({ page }, aliasValue: string) => {
  const email = accountEmail(aliasValue);
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover.getByText(email, { exact: true })).toHaveCount(0);
});

Then('the public-to-private share panel general access is {string}', async ({ page }, accessText: string) => {
  const popover = ShareSelectors.sharePopover(page);

  await expect(popover.getByText('General access', { exact: true })).toBeVisible();
  await expect(popover.getByText(accessText, { exact: true })).toBeVisible();
});

Then('the public-to-private no access page is shown', async ({ page }) => {
  await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Request access' }).first()).toBeVisible({ timeout: 15000 });
  await expect(PageSelectors.titleInput(page)).toHaveCount(0);
  await expect(ShareSelectors.shareButton(page)).toHaveCount(0);
});

function getState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Public-to-private move scenario state has not been initialized');
  }

  return state;
}

function accountEmail(aliasValue: string): string {
  const alias = aliasValue as SeededAccountAlias;
  const email = SEEDED_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown public-to-private account alias: ${aliasValue}`);
  }

  return email;
}

function requireWorkspaceId(state: ScenarioState): string {
  if (!state.workspaceId) {
    throw new Error('No public-to-private workspace has been loaded for this scenario');
  }

  return state.workspaceId;
}

function requireOwnerToken(state: ScenarioState): string {
  if (!state.ownerToken) {
    throw new Error('No public-to-private owner token has been loaded for this scenario');
  }

  return state.ownerToken;
}

function requireMovablePage(state: ScenarioState): TemporaryView {
  if (!state.movablePage) {
    throw new Error('No temporary public-to-private movable page has been created for this scenario');
  }

  return state.movablePage;
}

function requirePrivateTarget(state: ScenarioState): TemporaryView {
  if (!state.privateTarget) {
    throw new Error('No temporary public-to-private private target page has been created for this scenario');
  }

  return state.privateTarget;
}

function sharePersonRow(page: Page, email: string) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: email }).first();
}

function sharePeopleRows(page: Page) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: /@appflowy\.local/ });
}

function parseAccountAliases(aliasesValue: string): SeededAccountAlias[] {
  return aliasesValue.split(',').map((alias) => {
    const trimmedAlias = alias.trim() as SeededAccountAlias;

    if (!SEEDED_ACCOUNTS[trimmedAlias]) {
      throw new Error(`Unknown public-to-private account alias: ${trimmedAlias}`);
    }

    return trimmedAlias;
  });
}

async function loadSeededWorkspaceId(request: APIRequestContext, ownerToken: string): Promise<string> {
  const workspaces = await getApi<Workspace[]>(request, ownerToken, '/api/workspace?include_member_count=true');
  const ownerWorkspace = workspaces.find((workspace) => workspace.role === 'Owner') ?? workspaces[0];

  if (!ownerWorkspace?.workspace_id) {
    throw new Error('Seeded public-to-private owner has no workspace');
  }

  return ownerWorkspace.workspace_id;
}

async function cleanupTemporaryViews(request: APIRequestContext, state: ScenarioState) {
  if (!state.workspaceId || !state.ownerToken) {
    return;
  }

  const viewIds = [
    state.movablePage?.pageId,
    state.privateTarget?.pageId,
    state.movablePage?.spaceId,
    state.privateTarget?.spaceId,
  ].filter((viewId): viewId is string => Boolean(viewId));

  for (const viewId of viewIds) {
    await postVoidApiAllowFailure(
      request,
      state.ownerToken,
      `/api/workspace/${state.workspaceId}/page-view/${viewId}/move-to-trash`,
      `move temporary public-to-private view ${viewId} to trash`
    );
  }
}

async function getApi<T>(
  request: APIRequestContext,
  token: string,
  path: string
): Promise<T> {
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

async function postApi<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || !body.data) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body.data;
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
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }
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
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

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
