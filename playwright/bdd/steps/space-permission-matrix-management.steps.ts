import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { ModalSelectors, PageSelectors, SpaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const UID_FIELD_REGEX = /"uid"\s*:\s*(\d{16,})/g;
const TEMPORARY_PRIVATE_SPACE_PREFIX = 'spm0622 BDD Private Space';
const TEMPORARY_PRIVATE_PAGE_PREFIX = 'spm0622 BDD Private Page';
const SPACE_PERMISSION_PRIVATE = 1;
const VIEW_LAYOUT_DOCUMENT = 0;
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL_ACCESS = 50;
const SPACE_MEMBER_ROLE_OWNER = 'owner';
const SPACE_MEMBER_ROLE_MEMBER = 'member';
const SEEDED_PRIVATE_SPACE_MEMBER_DEFAULT_ACCESS = ACCESS_LEVEL_READ_ONLY;

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

const SPM_SPACES = {
  'private space': {
    viewId: 'bf0d2d13-6466-4420-a0c0-d4a225f882dc',
    name: 'spm0622 Private Matrix Space',
  },
} as const;

const SPM_PAGES = {
  'private page': {
    viewId: 'd79a7c58-79fb-4c98-a550-83bc4a8685c5',
    title: 'spm0622 Private Matrix Page',
  },
} as const;

type SpmAccountAlias = keyof typeof SPM_ACCOUNTS;
type SpmSpaceAlias = keyof typeof SPM_SPACES;
type SpmPageAlias = keyof typeof SPM_PAGES;

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type WorkspaceMember = {
  uid?: string | number;
  email: string;
};

type SpaceMemberRestoreTarget = {
  email: string;
  role: string;
  accessLevel: number;
};

type TemporarySpace = {
  spaceId: string;
  spaceName: string;
  pageId: string;
  pageTitle: string;
};

type PageWithTemporarySpace = Page & {
  __spmTemporarySpace?: TemporarySpace;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace?: {
    workspace_id?: string;
  };
};

type SpacePermissionSettingsPayload = {
  visibility: string;
  owner_access_level: number;
  member_default_access_level: number;
  everyone_else_access_level?: number | null;
  invite_policy: string;
  sidebar_edit_policy: string;
  invite_link_enabled: boolean;
  security: {
    disable_guests: boolean;
    disable_public_links: boolean;
    disable_export: boolean;
  };
};

type SpacePermissionResponsePayload = {
  permission: SpacePermissionSettingsPayload;
};

type ScenarioState = {
  workspaceId?: string;
  ownerToken?: string;
  currentSpaceId?: string;
  temporarySpace?: TemporarySpace;
  addedSpaceMemberEmails: Set<string>;
  restorePrivateSpaceMemberDefaultAccess?: boolean;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { addedSpaceMemberEmails: new Set() });
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;

  const needsCleanup =
    state.addedSpaceMemberEmails.size > 0 ||
    Boolean(state.temporarySpace) ||
    Boolean(state.restorePrivateSpaceMemberDefaultAccess);

  if (!needsCleanup) return;

  const token = state.ownerToken || (await getAuthToken(page));

  if (!token) return;

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token).catch(() => undefined));

  if (!workspaceId) return;

  const temporarySpace = state.temporarySpace || (page as PageWithTemporarySpace).__spmTemporarySpace;
  const cleanupSpaceId = state.currentSpaceId || temporarySpace?.spaceId || SPM_SPACES['private space'].viewId;

  if (state.restorePrivateSpaceMemberDefaultAccess) {
    await restoreSeededPrivateSpaceMemberDefaultAccess(request, token, workspaceId).catch((error) => {
      console.warn(`Failed to restore seeded private space member default access: ${String(error)}`);
    });
  }

  for (const email of state.addedSpaceMemberEmails) {
    await cleanupSpaceMember(request, token, workspaceId, cleanupSpaceId, email).catch((error) => {
      console.warn(`Failed to cleanup seeded space member "${email}": ${String(error)}`);
    });
  }

  if (temporarySpace) {
    for (const viewId of [temporarySpace.pageId, temporarySpace.spaceId]) {
      await postApi<void>(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`, {}).catch(
        (error) => {
          console.warn(`Failed to trash temporary seeded space view "${viewId}": ${String(error)}`);
        }
      );
    }
  }
});

When('I open the seeded spm0622 {string}', async ({ page, request }, pageAliasValue: string) => {
  const seededPage = spmPage(pageAliasValue);
  const state = await ensureWorkspaceContext(page, request);

  await cleanupSpaceMember(
    request,
    state.ownerToken,
    state.workspaceId,
    SPM_SPACES['private space'].viewId,
    SPM_ACCOUNTS['member closed']
  );
  await page.goto(`/app/${state.workspaceId}/${seededPage.viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
});

When('I create a temporary seeded spm0622 private space', async ({ page, request }) => {
  const state = await ensureWorkspaceContext(page, request);
  const suffix = Date.now().toString(36);
  const spaceName = `${TEMPORARY_PRIVATE_SPACE_PREFIX} ${suffix}`;
  const pageTitle = `${TEMPORARY_PRIVATE_PAGE_PREFIX} ${suffix}`;
  const space = await postApi<{ view_id: string }>(
    request,
    state.ownerToken,
    `/api/workspace/${state.workspaceId}/space`,
    {
      name: spaceName,
      space_icon: 'lock',
      space_icon_color: '#555555',
      space_permission: SPACE_PERMISSION_PRIVATE,
    }
  );
  const pageResponse = await postApi<{ view_id: string }>(
    request,
    state.ownerToken,
    `/api/workspace/${state.workspaceId}/page-view`,
    {
      parent_view_id: space.view_id,
      layout: VIEW_LAYOUT_DOCUMENT,
      name: pageTitle,
    }
  );

  state.currentSpaceId = space.view_id;
  state.temporarySpace = {
    spaceId: space.view_id,
    spaceName,
    pageId: pageResponse.view_id,
    pageTitle,
  };
  (page as PageWithTemporarySpace).__spmTemporarySpace = state.temporarySpace;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(SpaceSelectors.itemByName(page, spaceName)).toBeVisible({ timeout: 30000 });
});

When('I open the seeded spm0622 {string} manage space panel', async ({ page }, spaceAliasValue: string) => {
  const seededSpace = spmSpace(spaceAliasValue);
  const state = requireState(page);

  state.currentSpaceId = seededSpace.viewId;

  await openManageSpacePanel(page, seededSpace.name);
});

When('I change the Manage Space members default access to {string}', async ({ page }, accessLabelValue: string) => {
  const modal = manageSpaceModal(page);
  const row = modal.getByTestId('manage-space-members-default-access-row');

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: /Can view|Can view and comment|Can edit|Full access/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(accessLabelValue)}$`) }).click();

  const state = requireState(page);

  if (
    state.currentSpaceId === SPM_SPACES['private space'].viewId &&
    accessLevelFromLabel(accessLabelValue) !== SEEDED_PRIVATE_SPACE_MEMBER_DEFAULT_ACCESS
  ) {
    state.restorePrivateSpaceMemberDefaultAccess = true;
  }

  await ModalSelectors.okButton(page).click();
  await expect(modal).toHaveCount(0, { timeout: 15000 });
  await page.waitForTimeout(1500);
});

When('I open the Manage Space members tab', async ({ page }) => {
  await openManageSpaceMembersTab(page);
});

Then(
  'the Manage Space members list shows seeded spm0622 {string} with role {string}',
  async ({ page }, accountAliasValue: string, role: string) => {
    const email = spmAccountEmail(accountAliasValue);
    const row = spaceMemberRow(page, email);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(email, { exact: true }).first()).toBeVisible();
    await expect(row.getByText(role, { exact: true }).first()).toBeVisible();
  }
);

Then(
  'the Manage Space members list does not show seeded spm0622 {string}',
  async ({ page }, accountAliasValue: string) => {
    const email = spmAccountEmail(accountAliasValue);

    await expect(spaceMemberRow(page, email)).toHaveCount(0, { timeout: 15000 });
  }
);

Then(
  'the Manage Space member search for seeded spm0622 {string} shows an addable workspace member',
  async ({ page }, accountAliasValue: string) => {
    await searchSpaceMemberCandidate(page, spmAccountEmail(accountAliasValue));
  }
);

When('I add seeded spm0622 {string} to the current space', async ({ page }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);
  const resultRow = await searchSpaceMemberCandidate(page, email);
  const addButton = resultRow.getByTestId('workspace-member-inline-search-result-add');

  await expect(addButton).toBeEnabled({ timeout: 15000 });
  await addButton.click();
  requireState(page).addedSpaceMemberEmails.add(email);
});

When(
  'I sign in as seeded spm0622 {string} and reopen the temporary private space Manage Space members tab',
  async ({ page }, accountAliasValue: string) => {
    const temporarySpace = requireTemporarySpace(page);

    await signInSeededSpmAccount(page, accountAliasValue);
    requireState(page).currentSpaceId = temporarySpace.spaceId;
    await openManageSpacePanel(page, temporarySpace.spaceName);
    await openManageSpaceMembersTab(page);
  }
);

When('I remove seeded spm0622 {string} from the current space', async ({ page }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);
  const row = spaceMemberRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: 'Member' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
});

Then('seeded spm0622 {string} cannot see the temporary private space', async ({ page }, accountAliasValue: string) => {
  const temporarySpace = requireTemporarySpace(page);

  await signInSeededSpmAccount(page, accountAliasValue);
  await expect(SpaceSelectors.itemByName(page, temporarySpace.spaceName)).toHaveCount(0, { timeout: 15000 });
});

Then('seeded spm0622 {string} can see the temporary private space', async ({ page }, accountAliasValue: string) => {
  const temporarySpace = requireTemporarySpace(page);

  await signInSeededSpmAccount(page, accountAliasValue);
  await expect(SpaceSelectors.itemByName(page, temporarySpace.spaceName)).toBeVisible({ timeout: 30000 });
});

When(
  'I sign in as seeded spm0622 {string} and open the seeded spm0622 {string}',
  async ({ page, request }, accountAliasValue: string, pageAliasValue: string) => {
    const seededPage = spmPage(pageAliasValue);
    const state = requireState(page);

    await signInSeededSpmAccount(page, accountAliasValue);

    const token = await getAuthToken(page);
    const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token));

    state.workspaceId = workspaceId;
    await page.goto(`/app/${workspaceId}/${seededPage.viewId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(seededPage.title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
  }
);

Then('the seeded spm0622 page title is read-only', async ({ page }) => {
  await expect(page.getByText(SPM_PAGES['private page'].title, { exact: true }).first()).toBeVisible({
    timeout: 30000,
  });
  await expect(PageSelectors.titleInput(page)).toHaveCount(0, { timeout: 15000 });
});

Then('the seeded spm0622 page title is editable', async ({ page }) => {
  const titleInput = PageSelectors.titleInput(page);

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await expect(titleInput).toBeEnabled({ timeout: 15000 });
});

async function ensureWorkspaceContext(
  page: Page,
  request: APIRequestContext
): Promise<Required<Pick<ScenarioState, 'workspaceId' | 'ownerToken'>>> {
  const state = requireState(page);
  const ownerToken = state.ownerToken || (await getAuthToken(page));

  if (!ownerToken) {
    throw new Error('No auth token found for seeded spm0622 scenario');
  }

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, ownerToken));

  state.ownerToken = ownerToken;
  state.workspaceId = workspaceId;

  return { ownerToken, workspaceId };
}

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Seeded space permission management scenario state has not been initialized');
  }

  return state;
}

function requireTemporarySpace(page: Page): TemporarySpace {
  const temporarySpace = requireState(page).temporarySpace || (page as PageWithTemporarySpace).__spmTemporarySpace;

  if (!temporarySpace) {
    throw new Error('No temporary seeded spm0622 private space has been created');
  }

  return temporarySpace;
}

function manageSpaceModal(page: Page) {
  return page.getByTestId('manage-space-modal');
}

function spaceMemberRow(page: Page, email: string) {
  return manageSpaceModal(page).locator('[data-testid^="space-member-row-"]').filter({ hasText: email }).first();
}

async function openManageSpacePanel(page: Page, spaceName: string) {
  const spaceItem = SpaceSelectors.itemByName(page, spaceName);

  await expect(spaceItem).toBeVisible({ timeout: 30000 });
  await spaceItem.hover();
  await spaceItem.getByTestId('inline-more-actions').click({ force: true });
  await page.getByTestId('space-action-manage').click();

  const modal = manageSpaceModal(page);

  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText('Manage Space', { exact: true })).toBeVisible({ timeout: 15000 });
}

async function openManageSpaceMembersTab(page: Page) {
  const modal = manageSpaceModal(page);

  await modal.getByRole('tab', { name: 'Members' }).click();
  await expect(modal.getByTestId('workspace-member-inline-search-input')).toBeVisible({ timeout: 15000 });
}

async function searchSpaceMemberCandidate(page: Page, email: string) {
  const modal = manageSpaceModal(page);
  const input = modal.getByTestId('workspace-member-inline-search-input');

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(input).toBeEnabled({ timeout: 15000 });
  await input.fill(email);

  const resultRow = modal.getByTestId('workspace-member-inline-search-result').filter({ hasText: email }).first();

  await expect(resultRow).toBeVisible({ timeout: 15000 });
  return resultRow;
}

async function cleanupSpaceMember(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  spaceId: string,
  email: string
) {
  const uid = await findWorkspaceMemberUid(request, token, workspaceId, email);

  if (!uid) return;

  await deleteApi(request, token, `/api/workspace/${workspaceId}/spaces/${spaceId}/members/${uid}`);
}

async function restoreSeededPrivateSpaceMemberDefaultAccess(
  request: APIRequestContext,
  token: string,
  workspaceId: string
) {
  const spaceId = SPM_SPACES['private space'].viewId;
  const response = await getApi<SpacePermissionResponsePayload>(
    request,
    token,
    `/api/workspace/${workspaceId}/spaces/${spaceId}/permission`
  );
  const permission = {
    ...response.permission,
    member_default_access_level: SEEDED_PRIVATE_SPACE_MEMBER_DEFAULT_ACCESS,
  };

  await patchApi<SpacePermissionResponsePayload>(
    request,
    token,
    `/api/workspace/${workspaceId}/spaces/${spaceId}/permission`,
    permission
  );
  await restoreSeededPrivateSpaceMembers(request, token, workspaceId);
}

async function restoreSeededPrivateSpaceMembers(request: APIRequestContext, token: string, workspaceId: string) {
  const spaceId = SPM_SPACES['private space'].viewId;
  const targets: SpaceMemberRestoreTarget[] = [
    {
      email: SPM_ACCOUNTS['owner 2'],
      role: SPACE_MEMBER_ROLE_OWNER,
      accessLevel: ACCESS_LEVEL_FULL_ACCESS,
    },
    {
      email: SPM_ACCOUNTS['member default'],
      role: SPACE_MEMBER_ROLE_MEMBER,
      accessLevel: ACCESS_LEVEL_READ_ONLY,
    },
    {
      email: SPM_ACCOUNTS['member private'],
      role: SPACE_MEMBER_ROLE_MEMBER,
      accessLevel: ACCESS_LEVEL_READ_AND_WRITE,
    },
  ];

  for (const target of targets) {
    const uid = await findWorkspaceMemberUid(request, token, workspaceId, target.email);

    if (!uid) {
      throw new Error(`Could not restore seeded private space member "${target.email}": workspace uid not found`);
    }

    await patchApi(
      request,
      token,
      `/api/workspace/${workspaceId}/spaces/${spaceId}/members/${uid}`,
      {
        role: target.role,
        access_level: target.accessLevel,
      }
    );
  }
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

async function postApi<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: payload,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseApiResponse<T>(text, false);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST failed for ${path}: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

async function patchApi<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await request.patch(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: payload,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseApiResponse<T>(text, false);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API PATCH failed for ${path}: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
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

async function deleteApi(request: APIRequestContext, token: string, path: string): Promise<void> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });

  if (response.ok() || response.status() === 404) return;

  throw new Error(`API DELETE failed for ${path}: HTTP ${response.status()} ${await response.text()}`);
}

function parseApiResponse<T>(text: string, preserveUid: boolean): ApiResponse<T> | null {
  if (!text) return null;

  try {
    return JSON.parse(preserveUid ? text.replace(UID_FIELD_REGEX, '"uid":"$1"') : text) as ApiResponse<T>;
  } catch {
    return null;
  }
}

function apiHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
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
  const expectedEmail = spmAccountEmail(accountAliasValue);

  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, expectedEmail, PASSWORD, 2000);
  await expect
    .poll(() => currentSessionEmail(page), {
      message: `expected seeded login to use ${expectedEmail}`,
      timeout: 10000,
    })
    .toBe(expectedEmail);
}

async function currentSessionEmail(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rawToken = localStorage.getItem('token');

    if (!rawToken) return '';

    try {
      return (JSON.parse(rawToken) as { user?: { email?: string } }).user?.email || '';
    } catch {
      return '';
    }
  });
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

function spmAccountEmail(accountAliasValue: string): string {
  const alias = accountAliasValue as SpmAccountAlias;
  const email = SPM_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown spm0622 account alias: ${accountAliasValue}`);
  }

  return email;
}

function spmSpace(spaceAliasValue: string) {
  const alias = spaceAliasValue as SpmSpaceAlias;
  const space = SPM_SPACES[alias];

  if (!space) {
    throw new Error(`Unknown spm0622 space alias: ${spaceAliasValue}`);
  }

  return space;
}

function spmPage(pageAliasValue: string) {
  const alias = pageAliasValue as SpmPageAlias;
  const page = SPM_PAGES[alias];

  if (!page) {
    throw new Error(`Unknown spm0622 page alias: ${pageAliasValue}`);
  }

  return page;
}

function accessLevelFromLabel(label: string): number {
  switch (label) {
    case 'Can view':
      return ACCESS_LEVEL_READ_ONLY;
    case 'Can edit':
      return ACCESS_LEVEL_READ_AND_WRITE;
    default:
      throw new Error(`Unsupported Manage Space access label: ${label}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
