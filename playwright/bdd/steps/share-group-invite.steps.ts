import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { EditorSelectors, PageSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const TEMPORARY_PAGE_PREFIX = 'bdd share group page';
const TEMPORARY_PRIVATE_SPACE_PREFIX = 'bdd share group private space';
const TEMPORARY_PRIVATE_PAGE_PREFIX = 'bdd share group private page';
const TEMPORARY_GROUP_PREFIX = 'bdd share group';
const SPACE_PERMISSION_PRIVATE = 1;
const VIEW_LAYOUT_DOCUMENT = 0;
const UID_FIELD_REGEX = /"uid"\s*:\s*(\d{16,})/g;

const SPM_ACCOUNTS = {
  'owner 1': 'spm0622-owner1@appflowy.local',
  'owner 2': 'spm0622-owner2@appflowy.local',
  'member default': 'spm0622-member-default@appflowy.local',
  'member open': 'spm0622-member-open@appflowy.local',
  'member closed': 'spm0622-member-closed@appflowy.local',
  'member private': 'spm0622-member-private@appflowy.local',
  'guest closed': 'spm0622-guest-closed@appflowy.local',
  'guest private': 'spm0622-guest-private@appflowy.local',
  'guest none': 'spm0622-guest-none@appflowy.local',
} as const;

type SpmAccountAlias = keyof typeof SPM_ACCOUNTS;

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace?: {
    workspace_id?: string;
  };
};

type WorkspaceGroup = {
  group_id: string;
  name: string;
  member_count: number;
  associated_space_count?: number;
};

type WorkspaceMember = {
  uid?: string | number;
  email: string;
};

type ScenarioState = {
  viewId?: string;
  privateSpaceId?: string;
  pageTitle?: string;
  workspaceId?: string;
  ownerToken?: string;
  group?: WorkspaceGroup;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {});
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state?.group && !state?.viewId && !state?.privateSpaceId) return;

  const token = state.ownerToken || (await getAuthToken(page));

  if (!token) return;

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token).catch(() => undefined));

  if (!workspaceId) return;

  if (state.group) {
    if (state.viewId) {
      await deleteApi(
        request,
        token,
        `/api/workspace/${workspaceId}/views/${state.viewId}/group/${state.group.group_id}`
      );
    }

    await deleteApi(request, token, `/api/workspace/${workspaceId}/groups/${state.group.group_id}`);
  }

  for (const viewId of [state.viewId, state.privateSpaceId].filter((value): value is string => Boolean(value))) {
    await postApi<void>(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`, {});
  }
});

When('I create a temporary share-menu document page', async ({ page }) => {
  const state = requireState(page);
  const viewId = await createDocumentPageAndNavigate(page);
  const pageName = `${TEMPORARY_PAGE_PREFIX} ${Date.now().toString(36)}`;
  const titleInput = page.getByTestId('page-title-input').first();

  state.viewId = viewId;

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await titleInput.click({ force: true });
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await page.keyboard.type(pageName, { delay: 10 });
  await page.keyboard.press('Enter');
  await expect(titleInput).toHaveText(pageName, { timeout: 15000 });
});

When('I create a temporary private-space share-menu page', async ({ page, request }) => {
  const state = requireState(page);
  const token = await requireAuthToken(page);
  const workspaceId = await getCurrentWorkspaceId(request, token);
  const suffix = Date.now().toString(36);
  const spaceName = `${TEMPORARY_PRIVATE_SPACE_PREFIX} ${suffix}`;
  const pageTitle = `${TEMPORARY_PRIVATE_PAGE_PREFIX} ${suffix}`;
  const space = await postApi<{ view_id: string }>(request, token, `/api/workspace/${workspaceId}/space`, {
    name: spaceName,
    space_icon: 'lock',
    space_icon_color: '#555555',
    space_permission: SPACE_PERMISSION_PRIVATE,
  });
  const pageResponse = await postApi<{ view_id: string }>(
    request,
    token,
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: space.view_id,
      layout: VIEW_LAYOUT_DOCUMENT,
      name: pageTitle,
    }
  );

  state.ownerToken = token;
  state.workspaceId = workspaceId;
  state.privateSpaceId = space.view_id;
  state.viewId = pageResponse.view_id;
  state.pageTitle = pageTitle;
});

When('I create a temporary share-menu group', async ({ page, request }) => {
  const state = requireState(page);
  const token = await requireAuthToken(page);
  const workspaceId = await getCurrentWorkspaceId(request, token);
  const groupName = `${TEMPORARY_GROUP_PREFIX} ${Date.now().toString(36)}`;

  state.ownerToken = token;
  state.workspaceId = workspaceId;
  state.group = await postApi<WorkspaceGroup>(request, token, `/api/workspace/${workspaceId}/groups`, {
    name: groupName,
  });
});

When(
  'I create a temporary share-menu group with seeded spm0622 {string}',
  async ({ page, request }, accountAliasValue: string) => {
    const state = requireState(page);
    const token = await requireAuthToken(page);
    const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token));
    const groupName = `${TEMPORARY_GROUP_PREFIX} ${Date.now().toString(36)}`;
    const memberEmail = spmAccountEmail(accountAliasValue);
    const group = await postApi<WorkspaceGroup>(request, token, `/api/workspace/${workspaceId}/groups`, {
      name: groupName,
    });
    const memberUid = await findWorkspaceMemberUid(request, token, workspaceId, memberEmail);

    if (!memberUid) {
      throw new Error(`No workspace member UID found for ${memberEmail}`);
    }

    await addWorkspaceGroupMember(request, token, workspaceId, group.group_id, memberUid);

    state.ownerToken = token;
    state.workspaceId = workspaceId;
    state.group = group;
  }
);

When('I open the temporary share-menu page as owner', async ({ page }) => {
  const pageDetails = requireTemporaryPage(page);

  await openTemporaryPage(page, pageDetails.workspaceId, pageDetails.viewId, pageDetails.pageTitle);
});

When(
  'I sign in as seeded spm0622 {string} and cannot open the temporary share-menu page',
  async ({ page }, accountAliasValue: string) => {
    const pageDetails = requireTemporaryPage(page);

    await signInSeededSpmAccount(page, accountAliasValue);
    await page.goto(`/app/${pageDetails.workspaceId}/${pageDetails.viewId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No access to this page', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: pageDetails.pageTitle, exact: true })).toHaveCount(0);
    await expect(PageSelectors.titleInput(page)).toHaveCount(0);
  }
);

When(
  'I sign in as seeded spm0622 {string} and open the temporary share-menu page as owner',
  async ({ page }, accountAliasValue: string) => {
    const pageDetails = requireTemporaryPage(page);

    await signInSeededSpmAccount(page, accountAliasValue);
    await openTemporaryPage(page, pageDetails.workspaceId, pageDetails.viewId, pageDetails.pageTitle);
  }
);

When('I search the share invite input for the temporary share-menu group', async ({ page }) => {
  const group = requireTemporaryGroup(page);
  const input = inviteInput(page);

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => input.evaluate((element) => (element as HTMLInputElement).readOnly)).toBe(false);
  await input.fill(group.name);
});

Then('the share invite suggestions show the temporary share-menu group', async ({ page }) => {
  const group = requireTemporaryGroup(page);

  await expect(shareInviteSuggestion(page, group.name)).toBeVisible({ timeout: 15000 });
});

When('I invite the temporary share-menu group from the share panel', async ({ page }) => {
  const group = requireTemporaryGroup(page);

  await shareInviteSuggestion(page, group.name).click();
  await expect(ShareSelectors.emailTagInput(page).getByText(group.name, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(ShareSelectors.inviteButton(page)).toBeEnabled({ timeout: 15000 });
  await ShareSelectors.inviteButton(page).click();
});

Then('the share panel shows the temporary share-menu group with {string}', async ({ page }, accessText: string) => {
  const group = requireTemporaryGroup(page);
  const row = shareGroupRow(page, group.name);

  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText(group.name, { exact: true })).toBeVisible();
  await expect(row.getByText('Group', { exact: true })).toBeVisible();
  await expect(row.getByText(accessText, { exact: true })).toBeVisible();
});

When('I remove the temporary share-menu group access from the share panel', async ({ page }) => {
  const group = requireTemporaryGroup(page);
  const row = shareGroupRow(page, group.name);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: /Can view|Can edit|Full access/ }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
});

Then('the temporary share-menu group is not shown in the share panel', async ({ page }) => {
  const group = requireTemporaryGroup(page);

  await expect(shareGroupRow(page, group.name)).toHaveCount(0, { timeout: 15000 });
});

When(
  'I sign in as seeded spm0622 {string} and open the temporary share-menu page',
  async ({ page, request }, accountAliasValue: string) => {
    const pageDetails = requireTemporaryPage(page);

    await signInSeededSpmAccount(page, accountAliasValue);
    await waitForTemporaryPageReadAccess(request, await requireAuthToken(page), pageDetails.workspaceId, pageDetails.viewId);
    await openTemporaryPage(page, pageDetails.workspaceId, pageDetails.viewId, pageDetails.pageTitle);
  }
);

Then('the temporary share-menu page is readable', async ({ page }) => {
  const pageDetails = requireTemporaryPage(page);

  await expectTemporaryPageTitle(page, pageDetails.pageTitle);
});

Then('the temporary share-menu page is read only', async ({ page }) => {
  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toHaveAttribute('contenteditable', 'false');
});

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Share group invite scenario state has not been initialized');
  }

  return state;
}

function requireTemporaryGroup(page: Page): WorkspaceGroup {
  const group = requireState(page).group;

  if (!group) {
    throw new Error('No temporary share-menu group has been created for this scenario');
  }

  return group;
}

function requireTemporaryPage(page: Page): { workspaceId: string; viewId: string; pageTitle: string } {
  const state = requireState(page);

  if (!state.workspaceId || !state.viewId || !state.pageTitle) {
    throw new Error('No temporary share-menu page has been created for this scenario');
  }

  return {
    workspaceId: state.workspaceId,
    viewId: state.viewId,
    pageTitle: state.pageTitle,
  };
}

function inviteInput(page: Page) {
  return ShareSelectors.emailTagInput(page).locator('input[type="text"]');
}

function shareGroupRow(page: Page, groupName: string) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: groupName }).first();
}

function shareInviteSuggestion(page: Page, groupName: string) {
  return page.locator('[data-slot="popover-content"]').filter({ hasText: groupName }).last().getByText(groupName, {
    exact: true,
  });
}

async function openTemporaryPage(page: Page, workspaceId: string, viewId: string, pageTitle: string) {
  await page.goto(`/app/${workspaceId}/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expectTemporaryPageTitle(page, pageTitle);
  await expect(EditorSelectors.firstEditor(page)).toBeVisible({ timeout: 30000 });
}

async function expectTemporaryPageTitle(page: Page, pageTitle: string) {
  const editableTitle = PageSelectors.titleInput(page).first();
  const readOnlyTitle = page.getByRole('heading', { name: pageTitle, exact: true }).first();

  await expect
    .poll(
      async () => {
        const editableText = await editableTitle.textContent().catch(() => undefined);

        if (editableText?.trim() === pageTitle) return pageTitle;

        return (await readOnlyTitle.textContent().catch(() => ''))?.trim();
      },
      { timeout: 30000 }
    )
    .toBe(pageTitle);
}

async function waitForTemporaryPageReadAccess(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await getApi<unknown>(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for access to temporary page ${viewId}`);
}

async function getCurrentWorkspaceId(request: APIRequestContext, token: string): Promise<string> {
  const payload = await getApi<UserWorkspaceInfoPayload>(request, token, '/api/user/workspace');
  const workspaceId = payload.visiting_workspace?.workspace_id;

  if (!workspaceId) {
    throw new Error(`No visiting workspace id in /api/user/workspace response: ${JSON.stringify(payload)}`);
  }

  return workspaceId;
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  return getApiResponse<T>(request, token, path, false);
}

async function getApiPreservingUid<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  return getApiResponse<T>(request, token, path, true);
}

async function getApiResponse<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  preserveUid: boolean
): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseApiResponse<T>(text, preserveUid);

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API GET failed for ${path}: HTTP ${response.status()} ${text}`);
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
    headers: apiHeaders(token),
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body?.data as T;
}

async function postRawApi<T>(request: APIRequestContext, token: string, path: string, data: string): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseApiResponse<T>(text, true);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST failed for ${path}: HTTP ${response.status()} ${text}`);
  }

  return body?.data as T;
}

async function deleteApi(request: APIRequestContext, token: string, path: string): Promise<void> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });

  if (response.ok() || response.status() === 404) return;

  console.warn(`API DELETE cleanup failed for ${path}: HTTP ${response.status()} ${await response.text()}`);
}

function apiHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function findWorkspaceMemberUid(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  email: string
): Promise<string | undefined> {
  const members = await getApiPreservingUid<WorkspaceMember[]>(
    request,
    token,
    `/api/workspace/${workspaceId}/member?include_pending=true`
  );
  const member = members.find((workspaceMember) => workspaceMember.email.toLowerCase() === email.toLowerCase());

  if (member?.uid === undefined || member.uid === null) return undefined;
  return String(member.uid);
}

async function addWorkspaceGroupMember(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  groupId: string,
  uid: string
) {
  if (!/^\d+$/.test(uid)) {
    throw new Error(`Workspace group member UID must be numeric, got: ${uid}`);
  }

  await postRawApi<void>(request, token, `/api/workspace/${workspaceId}/groups/${groupId}/members`, `{"uid":${uid}}`);
}

function parseApiResponse<T>(text: string, preserveUid: boolean): ApiResponse<T> | null {
  if (!text) return null;

  try {
    return JSON.parse(preserveUid ? text.replace(UID_FIELD_REGEX, '"uid":"$1"') : text) as ApiResponse<T>;
  } catch {
    return null;
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

async function signInSeededSpmAccount(page: Page, accountAliasValue: string) {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, spmAccountEmail(accountAliasValue), PASSWORD, 2000);
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
}

function spmAccountEmail(accountAliasValue: string): string {
  const alias = accountAliasValue as SpmAccountAlias;
  const email = SPM_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown spm0622 account alias: ${accountAliasValue}`);
  }

  return email;
}

async function requireAuthToken(page: Page): Promise<string> {
  const token = await getAuthToken(page);

  if (!token) {
    throw new Error('No auth token in browser storage');
  }

  return token;
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
