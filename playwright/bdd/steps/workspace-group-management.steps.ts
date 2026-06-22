import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { AccountSelectors, WorkspaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const NATHAN_EMAIL = 'nathan@appflowy.io';
const TEMPORARY_GROUP_PREFIX = 'bdd group management';
const SPM_GROUP_NAME = 'spm0622 Full Access Space Group';
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

type WorkspaceGroup = {
  group_id: string;
  name: string;
  member_count: number;
};

type WorkspaceGroupsPayload = {
  groups: WorkspaceGroup[];
};

type WorkspaceMember = {
  uid?: string | number;
  email: string;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace?: {
    workspace_id?: string;
  };
};

type ScenarioState = {
  groupName?: string;
  groupDeleted: boolean;
  ownerToken?: string;
  workspaceId?: string;
  seededGroupCleanupEmails: Set<string>;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {
    groupDeleted: false,
    seededGroupCleanupEmails: new Set(),
  });
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;

  for (const email of state.seededGroupCleanupEmails) {
    await cleanupSeededGroupMember(request, state, email).catch((error) => {
      console.warn(`Failed to cleanup seeded workspace group member "${email}": ${String(error)}`);
    });
  }

  if (!state.groupName || state.groupDeleted) return;

  await cleanupTemporaryGroup(request, page, state).catch((error) => {
    console.warn(`Failed to cleanup temporary workspace group "${state.groupName}": ${String(error)}`);
  });
});

Given('the seeded spm0622 space permission fixture exists', async () => {
  // Seed with:
  // cargo test --test space_permission_matrix_seed seed_space_permission_matrix_suite -- --ignored --nocapture
});

Given('I sign in as the Nathan workspace owner', async ({ page, request }) => {
  await signInAsWorkspaceOwner(page, request, NATHAN_EMAIL);
});

Given('I sign in as seeded spm0622 {string}', async ({ page, request }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);

  await signInAsWorkspaceOwner(page, request, email);

  if (email === SPM_ACCOUNTS['owner 1']) {
    await cleanupSeededGroupMember(request, requireState(page), SPM_ACCOUNTS['member closed']);
  }
});

When('I open the People settings groups tab', async ({ page }) => {
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });

  await AccountSelectors.settingsButton(page).click();

  const dialog = settingsDialog(page);

  await expect(dialog).toBeVisible({ timeout: 15000 });
  await dialog.getByTestId('settings-menu-members').click();
  await dialog.getByRole('tab', { name: /^Groups/ }).click();
  await expect(dialog.getByTestId('people-create-group-button')).toBeVisible({ timeout: 15000 });
});

When('I create a temporary workspace group', async ({ page }) => {
  const state = requireState(page);
  const groupName = `${TEMPORARY_GROUP_PREFIX} ${Date.now().toString(36)}`;
  const dialog = settingsDialog(page);

  state.groupName = groupName;
  await dialog.getByTestId('people-create-group-button').click();
  await dialog.getByTestId('people-create-group-name-input').fill(groupName);
  await dialog.getByTestId('people-create-group-submit').click();
  await expect(groupRow(page, groupName)).toBeVisible({ timeout: 15000 });
});

When('I open the temporary workspace group', async ({ page }) => {
  await openWorkspaceGroup(page, requireGroupName(page));
});

When('I open workspace group {string}', async ({ page }, groupName: string) => {
  await openWorkspaceGroup(page, groupName);
});

Then('the workspace groups list shows {string} with {string}', async ({ page }, groupName: string, memberCount: string) => {
  const row = groupRow(page, groupName);

  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText(groupName, { exact: true })).toBeVisible();
  await expect(row.getByText(memberCount, { exact: true })).toBeVisible();
});

When('I add workspace member {string} to the temporary group', async ({ page }, email: string) => {
  await addWorkspaceMemberToOpenGroup(page, email);
});

When('I add workspace member {string} to the open group', async ({ page }, email: string) => {
  await addWorkspaceMemberToOpenGroup(page, email);

  if (await groupDetailModal(page).getByText(SPM_GROUP_NAME, { exact: true }).isVisible().catch(() => false)) {
    requireState(page).seededGroupCleanupEmails.add(email);
  }
});

Then('the temporary group shows workspace member {string}', async ({ page }, email: string) => {
  await openGroupMembersTab(page);
  await expect(groupMemberRow(page, email)).toBeVisible({ timeout: 15000 });
});

Then('the group detail panel shows workspace member {string}', async ({ page }, email: string) => {
  await openGroupMembersTab(page);
  await expect(groupMemberRow(page, email)).toBeVisible({ timeout: 15000 });
});

When('I remove workspace member {string} from the temporary group', async ({ page }, email: string) => {
  await removeWorkspaceMemberFromOpenGroup(page, email);
});

When('I remove workspace member {string} from the open group', async ({ page }, email: string) => {
  await removeWorkspaceMemberFromOpenGroup(page, email);
});

Then('the temporary group does not show workspace member {string}', async ({ page }, email: string) => {
  await openGroupMembersTab(page);
  await expect(groupMemberRow(page, email)).toHaveCount(0, { timeout: 15000 });
});

Then('the group detail panel does not show workspace member {string}', async ({ page }, email: string) => {
  await openGroupMembersTab(page);
  await expect(groupMemberRow(page, email)).toHaveCount(0, { timeout: 15000 });
});

Then(
  'the group detail member search for {string} shows an addable workspace member',
  async ({ page }, email: string) => {
    await searchGroupMemberCandidate(page, email);
  }
);

When('I delete the temporary workspace group', async ({ page }) => {
  const modal = groupDetailModal(page);

  await modal.getByRole('tab', { name: 'General' }).click();
  await modal.getByRole('button', { name: 'Delete group' }).click();
  await expect(modal).toHaveCount(0, { timeout: 15000 });
  requireState(page).groupDeleted = true;
});

Then('the temporary workspace group is not listed', async ({ page }) => {
  await expect(groupRow(page, requireGroupName(page))).toHaveCount(0, { timeout: 15000 });
});

async function signInAsWorkspaceOwner(page: Page, request: APIRequestContext, email: string) {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, email, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  const state = requireState(page);
  const ownerToken = await getAuthToken(page);

  if (!ownerToken) {
    throw new Error(`No auth token found after signing in as ${email}`);
  }

  state.ownerToken = ownerToken;
  state.workspaceId = await getCurrentWorkspaceId(request, ownerToken);
  await cleanupStaleTemporaryGroups(request, ownerToken, state.workspaceId);
}

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Workspace group management scenario state has not been initialized');
  }

  return state;
}

function requireGroupName(page: Page): string {
  const groupName = requireState(page).groupName;

  if (!groupName) {
    throw new Error('No temporary workspace group has been created for this scenario');
  }

  return groupName;
}

function settingsDialog(page: Page) {
  return AccountSelectors.settingsDialog(page);
}

function groupDetailModal(page: Page) {
  return page.getByTestId('group-detail-modal');
}

function groupRow(page: Page, groupName: string) {
  return settingsDialog(page).locator('[data-testid^="group-row-"]').filter({ hasText: groupName }).first();
}

function groupMemberRow(page: Page, email: string) {
  return groupDetailModal(page).locator('[data-testid^="group-member-row-"]').filter({ hasText: email }).first();
}

async function openWorkspaceGroup(page: Page, groupName: string) {
  await groupRow(page, groupName).click();

  const modal = groupDetailModal(page);

  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText(groupName, { exact: true })).toBeVisible({ timeout: 15000 });
}

async function addWorkspaceMemberToOpenGroup(page: Page, email: string) {
  const resultRow = await searchGroupMemberCandidate(page, email);
  const addButton = resultRow.getByTestId('workspace-member-inline-search-result-add');

  await expect(addButton).toBeEnabled({ timeout: 15000 });
  await addButton.click();
}

async function removeWorkspaceMemberFromOpenGroup(page: Page, email: string) {
  const row = groupMemberRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: 'Group member actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove from group' }).click();
}

async function searchGroupMemberCandidate(page: Page, email: string) {
  const modal = groupDetailModal(page);

  await openGroupMembersTab(page);

  const input = modal.getByTestId('workspace-member-inline-search-input');

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(input).toBeEnabled({ timeout: 15000 });
  await input.fill(email);

  const resultRow = modal.getByTestId('workspace-member-inline-search-result').filter({ hasText: email }).first();

  await expect(resultRow).toBeVisible({ timeout: 15000 });
  return resultRow;
}

async function openGroupMembersTab(page: Page) {
  const modal = groupDetailModal(page);

  await modal.getByRole('tab', { name: 'Members' }).click();
  await expect(modal.getByTestId('workspace-member-inline-search-input')).toBeVisible({ timeout: 15000 });
}

async function cleanupTemporaryGroup(request: APIRequestContext, page: Page, state: ScenarioState) {
  const token = state.ownerToken || (await getAuthToken(page));

  if (!token) return;

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token));

  if (!workspaceId) return;
  await cleanupGroupsByName(request, token, workspaceId, (group) => group.name === state.groupName);
}

async function cleanupStaleTemporaryGroups(request: APIRequestContext, token: string, workspaceId: string) {
  await cleanupGroupsByName(request, token, workspaceId, (group) => group.name.startsWith(TEMPORARY_GROUP_PREFIX));
}

async function cleanupGroupsByName(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  predicate: (group: WorkspaceGroup) => boolean
) {
  const groups = await getApi<WorkspaceGroupsPayload>(request, token, `/api/workspace/${workspaceId}/groups`);

  for (const group of groups.groups.filter(predicate)) {
    await deleteApi(request, token, `/api/workspace/${workspaceId}/groups/${group.group_id}`);
  }
}

async function cleanupSeededGroupMember(request: APIRequestContext, state: ScenarioState, email: string) {
  if (!state.ownerToken || !state.workspaceId) return;

  const group = await findWorkspaceGroup(request, state.ownerToken, state.workspaceId, SPM_GROUP_NAME);
  const uid = await findWorkspaceMemberUid(request, state.ownerToken, state.workspaceId, email);

  if (!group || !uid) return;

  await deleteApi(request, state.ownerToken, `/api/workspace/${state.workspaceId}/groups/${group.group_id}/members/${uid}`);
}

async function findWorkspaceGroup(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string
): Promise<WorkspaceGroup | undefined> {
  const groups = await getApi<WorkspaceGroupsPayload>(request, token, `/api/workspace/${workspaceId}/groups`);

  return groups.groups.find((group) => group.name === name);
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
