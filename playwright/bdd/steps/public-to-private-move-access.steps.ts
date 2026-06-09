import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { EditorSelectors, PageSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const SPACE_PERMISSION_PUBLIC = 0;
const SPACE_PERMISSION_PRIVATE = 1;
const ACCESS_LEVEL_READ_ONLY = 10;
const VIEW_LAYOUT_DOCUMENT = 0;
const SEEDED_PRIVATE_SPACE_ID = 'a93fc48d-db30-4a0f-8bec-a6f0ff2b071c';
const SEEDED_PRIVATE_TARGET_PAGE_ID = '0574b0b2-5cd7-4893-8c2d-7b23c66a6c56';
const SEEDED_PRIVATE_SPACE_NAME = 'ptp0527 BDD Seeded Private Space';
const SEEDED_PRIVATE_TARGET_PAGE_NAME = 'ptp0527 BDD Seeded Private Target Page';

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
  privateSource?: TemporaryView;
  privateTarget?: TemporaryView;
  privateTargetIsSeeded?: boolean;
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

type FolderView = {
  view_id: string;
  name: string;
  children?: FolderView[];
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
  // cargo test --test public_to_private_access_seed seed_public_to_private_move_web_suite -- --ignored
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

  await cleanupStaleTemporaryViews(request, ownerToken, workspaceId);

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

Given(
  'I use the seeded public-to-private private target page shared with {string}',
  async ({ page, request }, accountAliasValue: string) => {
    const state = getState(page);
    const workspaceId = requireWorkspaceId(state);
    const ownerToken = requireOwnerToken(state);
    const sharedEmail = accountEmail(accountAliasValue);

    if (sharedEmail !== SEEDED_ACCOUNTS['member 1']) {
      throw new Error(`The seeded public-to-private target is shared only with member 1, got ${accountAliasValue}`);
    }

    await getApi(request, ownerToken, `/api/workspace/${workspaceId}/page-view/${SEEDED_PRIVATE_TARGET_PAGE_ID}`);

    state.privateTarget = {
      spaceId: SEEDED_PRIVATE_SPACE_ID,
      spaceName: SEEDED_PRIVATE_SPACE_NAME,
      pageId: SEEDED_PRIVATE_TARGET_PAGE_ID,
      pageTitle: SEEDED_PRIVATE_TARGET_PAGE_NAME,
    };
    state.privateTargetIsSeeded = true;
  }
);

Given(
  'I create a temporary private source shared with {string} and private target shared with {string}',
  async ({ page, request }, sourceAliasValue: string, targetAliasValue: string) => {
    const state = getState(page);
    const workspaceId = requireWorkspaceId(state);
    const ownerToken = requireOwnerToken(state);
    const sourceEmail = accountEmail(sourceAliasValue);
    const targetEmail = accountEmail(targetAliasValue);
    const sourceSpaceName = `ptp0527 BDD Private Source Space ${state.runId}`;
    const sourcePageTitle = `ptp0527 BDD Private Source Page ${state.runId}`;
    const targetSpaceName = `ptp0527 BDD Private Target Space ${state.runId}`;
    const targetPageTitle = `ptp0527 BDD Private Target Page ${state.runId}`;
    const movableTitle = `ptp0527 BDD Private Movable Page ${state.runId}`;

    await cleanupStaleTemporaryViews(request, ownerToken, workspaceId);

    const sourceSpace = await postApi<{ view_id: string }>(request, ownerToken, `/api/workspace/${workspaceId}/space`, {
      name: sourceSpaceName,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: SPACE_PERMISSION_PRIVATE,
    });
    const sourcePage = await postApi<{ view_id: string }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/page-view`,
      {
        parent_view_id: sourceSpace.view_id,
        layout: VIEW_LAYOUT_DOCUMENT,
        name: sourcePageTitle,
      }
    );

    const targetSpace = await postApi<{ view_id: string }>(request, ownerToken, `/api/workspace/${workspaceId}/space`, {
      name: targetSpaceName,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: SPACE_PERMISSION_PRIVATE,
    });
    const targetPage = await postApi<{ view_id: string }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/page-view`,
      {
        parent_view_id: targetSpace.view_id,
        layout: VIEW_LAYOUT_DOCUMENT,
        name: targetPageTitle,
      }
    );
    const movablePage = await postApi<{ view_id: string }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/page-view`,
      {
        parent_view_id: sourcePage.view_id,
        layout: VIEW_LAYOUT_DOCUMENT,
        name: movableTitle,
      }
    );

    await putVoidApi(request, ownerToken, `/api/sharing/workspace/${workspaceId}/view`, {
      view_id: sourcePage.view_id,
      emails: [sourceEmail],
      access_level: ACCESS_LEVEL_READ_ONLY,
    });
    await putVoidApi(request, ownerToken, `/api/sharing/workspace/${workspaceId}/view`, {
      view_id: targetPage.view_id,
      emails: [targetEmail],
      access_level: ACCESS_LEVEL_READ_ONLY,
    });

    state.privateSource = {
      spaceId: sourceSpace.view_id,
      spaceName: sourceSpaceName,
      pageId: sourcePage.view_id,
      pageTitle: sourcePageTitle,
    };
    state.privateTarget = {
      spaceId: targetSpace.view_id,
      spaceName: targetSpaceName,
      pageId: targetPage.view_id,
      pageTitle: targetPageTitle,
    };
    state.privateTargetIsSeeded = false;
    state.movablePage = {
      spaceId: sourceSpace.view_id,
      spaceName: sourceSpaceName,
      pageId: movablePage.view_id,
      pageTitle: movableTitle,
    };
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

  await postVoidApi(request, ownerToken, `/api/workspace/${workspaceId}/page-view/${movablePage.pageId}/move`, {
    new_parent_view_id: privateTarget.pageId,
    prev_view_id: null,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
});

When(
  'I change the temporary private source space permission to {string}',
  async ({ page, request }, permission: string) => {
    const state = getState(page);
    const workspaceId = requireWorkspaceId(state);
    const ownerToken = requireOwnerToken(state);
    const privateSource = requirePrivateSource(state);
    const nextPermission = permission === 'Public' ? SPACE_PERMISSION_PUBLIC : SPACE_PERMISSION_PRIVATE;

    if (permission !== 'Public' && permission !== 'Private') {
      throw new Error(`Unsupported public-to-private source space permission: ${permission}`);
    }

    await patchVoidApi(request, ownerToken, `/api/workspace/${workspaceId}/space/${privateSource.spaceId}`, {
      name: privateSource.spaceName,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: nextPermission,
    });

    await page.waitForTimeout(1500);
  }
);

Then('the temporary public-to-private movable page title is visible', async ({ page }) => {
  const movablePage = requireMovablePage(getState(page));

  await expect(page.getByText(movablePage.pageTitle, { exact: true }).first()).toBeVisible({ timeout: 30000 });
});

Then('the temporary public-to-private movable page title is editable', async ({ page }) => {
  await expect(PageSelectors.titleInput(page).first()).toBeVisible({ timeout: 15000 });
});

Then('the temporary public-to-private movable page editor is read-only', async ({ page }) => {
  // A View-only member viewing a page inside a private space must not be able
  // to edit it. Slate renders the editor with contenteditable="false" when the
  // page resolves to read-only, so assert the inherited access is enforced.
  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toHaveAttribute('contenteditable', 'false');
});

Then('typing in the temporary public-to-private movable page editor has no effect', async ({ page }) => {
  // Prove the read-only gate actually rejects edits: focus the editor, type a
  // sentinel, and assert it never lands in the document content.
  const sentinel = 'PTP_READONLY_EDIT_ATTEMPT';
  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 30000 });

  const before = (await editor.textContent()) ?? '';

  await editor.click({ position: { x: 40, y: 20 } }).catch(() => undefined);
  await page.keyboard.type(sentinel);
  await page.waitForTimeout(500);

  await expect(editor).not.toContainText(sentinel);
  await expect(editor).toHaveText(before);
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

Then(
  'the public-to-private share panel shows {string} with {string}',
  async ({ page }, aliasValue: string, accessText: string) => {
    const email = accountEmail(aliasValue);
    const row = sharePersonRow(page, email);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(email, { exact: true }).first()).toBeVisible();
    await expect(row.getByText(accessText, { exact: true }).first()).toBeVisible();
  }
);

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

function requirePrivateSource(state: ScenarioState): TemporaryView {
  if (!state.privateSource) {
    throw new Error('No temporary public-to-private private source page has been created for this scenario');
  }

  return state.privateSource;
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
  return ShareSelectors.sharePopover(page)
    .locator('.group')
    .filter({ hasText: /@appflowy\.local/ });
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

  const viewIds = Array.from(
    new Set(
      [
        state.movablePage?.pageId,
        state.movablePage?.spaceId,
        state.privateSource?.pageId,
        state.privateSource?.spaceId,
        ...(state.privateTargetIsSeeded ? [] : [state.privateTarget?.pageId, state.privateTarget?.spaceId]),
      ].filter((viewId): viewId is string => Boolean(viewId))
    )
  );

  for (const viewId of viewIds) {
    await postVoidApiAllowFailure(
      request,
      state.ownerToken,
      `/api/workspace/${state.workspaceId}/page-view/${viewId}/move-to-trash`,
      `move temporary public-to-private view ${viewId} to trash`
    );
  }
}

async function cleanupStaleTemporaryViews(
  request: APIRequestContext,
  ownerToken: string,
  workspaceId: string
): Promise<void> {
  const root = await getApi<FolderView>(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/view/${workspaceId}?depth=50`
  );
  const staleViewIds = collectTemporaryViewIds(root);

  for (const viewId of staleViewIds) {
    await postVoidApiAllowFailure(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`,
      `move stale public-to-private view ${viewId} to trash`
    );
  }
}

function collectTemporaryViewIds(view: FolderView): string[] {
  const childIds = (view.children ?? []).flatMap(collectTemporaryViewIds);

  if (isTemporaryView(view)) {
    return [...childIds, view.view_id];
  }

  return childIds;
}

function isTemporaryView(view: FolderView): boolean {
  if (view.view_id === SEEDED_PRIVATE_SPACE_ID || view.view_id === SEEDED_PRIVATE_TARGET_PAGE_ID) {
    return false;
  }

  return [
    'ptp0527 BDD Public Space ',
    'ptp0527 BDD Movable Public Page ',
    'ptp0527 BDD Private Source Space ',
    'ptp0527 BDD Private Source Page ',
    'ptp0527 BDD Private Movable Page ',
    'ptp0527 BDD Private Space ',
    'ptp0527 BDD Private Target Page ',
    'ptp0527 BDD Private Target Space ',
  ].some((prefix) => view.name.startsWith(prefix));
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

async function patchVoidApi(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await request.patch(`${TestConfig.apiUrl}${path}`, {
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
