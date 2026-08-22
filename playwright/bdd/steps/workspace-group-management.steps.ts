import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  AccountSelectors,
  PageSelectors,
  ShareSelectors,
  SpaceSelectors,
  WorkspaceSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const NATHAN_EMAIL = 'nathan@appflowy.io';
const EVA_EMAIL = 'eva@appflowy.io';
const TEMPORARY_GROUP_PREFIX = 'bdd group management';
const SPM_GROUP_NAME = 'spm0622 Full Access Space Group';
const SPM_GROUP_SPACE_NAME = 'spm0622 Group Full Access Space';
const SPM_GROUP_PAGE_ID = 'ff52f801-5960-44d9-850f-8099a8faf4bc';
const SPM_GROUP_PAGE_TITLE = 'spm0622 Group Full Access Page';
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
  workspaceName?: string;
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
  const cleanupErrors: string[] = [];

  for (const email of state.seededGroupCleanupEmails) {
    await cleanupSeededGroupMember(request, state, email).catch((error) => {
      cleanupErrors.push(`seeded workspace group member "${email}": ${String(error)}`);
    });
  }

  if (state.groupName && !state.groupDeleted) {
    await cleanupTemporaryGroup(request, page, state).catch((error) => {
      cleanupErrors.push(`temporary workspace group "${state.groupName}": ${String(error)}`);
    });
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Workspace-group fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
});

Given('the seeded spm0622 space permission fixture exists', async () => {
  // Seed with:
  // cargo test --test space_permission_matrix_seed seed_space_permission_matrix_suite -- --ignored --nocapture
});

Given('I sign in as the Nathan workspace owner', async ({ page, request }) => {
  await signInAsNathanWorkspaceOwner(page, request);
});

Given('I sign in as seeded spm0622 {string}', async ({ page, request }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);

  await signInAsWorkspaceOwner(page, request, email);
});

When(
  'I return as seeded spm0622 {string} without resetting group membership',
  async ({ page, request }, accountAliasValue: string) => {
    await signInAsWorkspaceOwner(page, request, spmAccountEmail(accountAliasValue));
  }
);

When('I open the People settings groups tab', async ({ page }) => {
  const dialog = await openPeopleSettingsGroupsTab(page);

  await expect(dialog.getByTestId('people-create-group-button')).toBeVisible({ timeout: 15000 });
});

When('I sign in as Eva and switch to the Nathan workspace', async ({ page }) => {
  const workspaceName = requireWorkspaceName(page);

  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, EVA_EMAIL, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
  await switchWorkspace(page, workspaceName);
});

When('I open the People settings groups tab as a workspace member', async ({ page }) => {
  const dialog = await openPeopleSettingsGroupsTab(page);

  await expect(dialog.getByTestId('people-create-group-button')).toHaveCount(0);
});

When('I create a temporary workspace group', async ({ page }) => {
  const state = requireState(page);
  const groupName = `${TEMPORARY_GROUP_PREFIX} ${Date.now().toString(36)}`;
  const dialog = settingsDialog(page);

  state.groupName = groupName;
  await dialog.getByTestId('people-create-group-button').click();
  const modal = createGroupModal(page);

  await expect(modal).toBeVisible({ timeout: 15000 });
  await modal.getByTestId('people-create-group-name-input').fill(groupName);
  await modal.getByTestId('people-create-group-submit').click();
  await expect(groupRow(page, groupName)).toBeVisible({ timeout: 15000 });
});

When('I open the temporary workspace group', async ({ page }) => {
  await openWorkspaceGroup(page, requireGroupName(page));
});

When('I open workspace group {string}', async ({ page }, groupName: string) => {
  await openWorkspaceGroup(page, groupName);
});

Then(
  'the workspace groups list shows {string} with {string}',
  async ({ page }, groupName: string, memberCount: string) => {
    const row = groupRow(page, groupName);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(groupName, { exact: true })).toBeVisible();
    await expect(row.getByText(memberCount, { exact: true })).toBeVisible();
  }
);

When('I add workspace member {string} to the temporary group', async ({ page }, email: string) => {
  await addWorkspaceMemberToOpenGroup(page, email);
});

When('I add workspace member {string} to the open group', async ({ page }, email: string) => {
  const isSeededGroup = await groupDetailModal(page)
    .getByText(SPM_GROUP_NAME, { exact: true })
    .isVisible()
    .catch(() => false);

  // Register cleanup before starting the mutation so a post-commit UI failure
  // cannot leave the canonical fixture member attached.
  if (isSeededGroup) {
    requireState(page).seededGroupCleanupEmails.add(email);
  }

  await addWorkspaceMemberToOpenGroup(page, email);
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
  const confirmation = page.getByTestId('delete-group-confirmation');

  await expect(confirmation).toBeVisible({ timeout: 15000 });
  await confirmation.getByTestId('people-delete-group-confirm').click();
  await expect(confirmation).toHaveCount(0, { timeout: 15000 });
  await expect(modal).toHaveCount(0, { timeout: 15000 });
  requireState(page).groupDeleted = true;
});

Then('the temporary workspace group is not listed', async ({ page }) => {
  await expect(groupRow(page, requireGroupName(page))).toHaveCount(0, { timeout: 15000 });
});

Then('the temporary workspace group is listed with {string}', async ({ page, request }, memberCount: string) => {
  const groupName = requireGroupName(page);
  const workspaceId = requireWorkspaceId(page);
  const evaToken = await getAuthToken(page);

  if (!evaToken) {
    throw new Error(`No auth token found after signing in as ${EVA_EMAIL}`);
  }

  const visibleGroups = await getApi<WorkspaceGroupsPayload>(request, evaToken, `/api/workspace/${workspaceId}/groups`);
  const temporaryGroup = visibleGroups.groups.find((group) => group.name === groupName);

  if (!temporaryGroup) {
    throw new Error(`Eva's group list does not contain the temporary workspace group: ${groupName}`);
  }

  expect(temporaryGroup.member_count).toBe(1);

  const dialog = settingsDialog(page);
  const row = dialog.getByTestId(`group-row-${temporaryGroup.group_id}`);

  await expect(dialog.getByRole('tab', { name: `Groups ${visibleGroups.groups.length}`, exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText(groupName, { exact: true })).toBeVisible();
  await expect(row.getByText(memberCount, { exact: true })).toBeVisible();
});

Then('workspace members cannot manage or open the temporary workspace group', async ({ page }) => {
  const groupName = requireGroupName(page);
  const dialog = settingsDialog(page);
  const row = groupRow(page, groupName);

  await expect(dialog.getByTestId('people-create-group-button')).toHaveCount(0);
  await expect(row.locator('[data-testid^="group-edit-"]')).toHaveCount(0);
  await expect(row.getByRole('button')).toHaveCount(0);

  await row.click();
  await expect(groupDetailModal(page)).toHaveCount(0);
  await expect(page.getByTestId('rename-group-modal')).toHaveCount(0);
  await expect(page.getByTestId('delete-group-confirmation')).toHaveCount(0);
});

Then(
  'seeded spm0622 {string} cannot open the seeded group Full Access page',
  async ({ page }, accountAliasValue: string) => {
    const state = requireState(page);

    await signInSeededAccountForAccessCheck(page, accountAliasValue);
    await expect(SpaceSelectors.itemByName(page, SPM_GROUP_SPACE_NAME)).toHaveCount(0, { timeout: 15000 });
    await page.goto(`/app/${state.workspaceId}/${SPM_GROUP_PAGE_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No access to this page', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(SPM_GROUP_PAGE_TITLE, { exact: true })).toHaveCount(0);
    await expect(PageSelectors.titleInput(page)).toHaveCount(0);
  }
);

Then(
  'seeded spm0622 {string} can manage the seeded group Full Access page',
  async ({ page }, accountAliasValue: string) => {
    const state = requireState(page);

    await signInSeededAccountForAccessCheck(page, accountAliasValue);
    await expect(SpaceSelectors.itemByName(page, SPM_GROUP_SPACE_NAME)).toBeVisible({ timeout: 30000 });
    await page.goto(`/app/${state.workspaceId}/${SPM_GROUP_PAGE_ID}`, { waitUntil: 'domcontentloaded' });
    await expectSeededGroupPageTitle(page);

    const titleInput = PageSelectors.titleInput(page).first();

    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await expect(titleInput).toBeEnabled();
    await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
    await ShareSelectors.shareButton(page).evaluate((element: HTMLElement) => element.click());
    await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 15000 });

    const inviteInput = ShareSelectors.emailTagInput(page).locator('input[type="text"]');

    await expect(inviteInput).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => inviteInput.evaluate((element) => (element as HTMLInputElement).readOnly)).toBe(false);
  }
);

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
}

async function signInAsNathanWorkspaceOwner(page: Page, request: APIRequestContext) {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, NATHAN_EMAIL, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });

  const workspaceName = await switchWorkspaceMatching(page, /nathan.*workspace/i);
  const ownerToken = await getAuthToken(page);

  if (!ownerToken) {
    throw new Error(`No auth token found after signing in as ${NATHAN_EMAIL}`);
  }

  const state = requireState(page);

  state.ownerToken = ownerToken;
  state.workspaceId = await getCurrentWorkspaceId(request, ownerToken);
  state.workspaceName = workspaceName;
}

async function signInSeededAccountForAccessCheck(page: Page, accountAliasValue: string) {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, spmAccountEmail(accountAliasValue), PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
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

function requireWorkspaceName(page: Page): string {
  const workspaceName = requireState(page).workspaceName;

  if (!workspaceName) {
    throw new Error("Nathan's workspace name has not been captured for this scenario");
  }

  return workspaceName;
}

function requireWorkspaceId(page: Page): string {
  const workspaceId = requireState(page).workspaceId;

  if (!workspaceId) {
    throw new Error("Nathan's workspace id has not been captured for this scenario");
  }

  return workspaceId;
}

function settingsDialog(page: Page) {
  return AccountSelectors.settingsDialog(page);
}

function groupDetailModal(page: Page) {
  return page.getByTestId('group-detail-modal');
}

function createGroupModal(page: Page) {
  return page.getByTestId('create-group-modal');
}

function groupRow(page: Page, groupName: string) {
  return settingsDialog(page).locator('[data-testid^="group-row-"]').filter({ hasText: groupName }).first();
}

function groupMemberRow(page: Page, email: string) {
  return groupDetailModal(page).locator('[data-testid^="group-member-row-"]').filter({ hasText: email }).first();
}

async function openPeopleSettingsGroupsTab(page: Page) {
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  await AccountSelectors.settingsButton(page).click();

  const dialog = settingsDialog(page);

  await expect(dialog).toBeVisible({ timeout: 15000 });
  await dialog.getByTestId('settings-menu-members').click();
  await dialog.getByRole('tab', { name: /^Groups/ }).click();
  return dialog;
}

async function switchWorkspace(page: Page, workspaceName: string): Promise<void> {
  const currentWorkspaceName = page.getByTestId('current-workspace-name');

  if ((await currentWorkspaceName.textContent())?.trim() === workspaceName) return;

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  await WorkspaceSelectors.item(page).filter({ hasText: workspaceName }).first().click();
  await expect(currentWorkspaceName).toHaveText(workspaceName, { timeout: 30000 });
}

async function switchWorkspaceMatching(page: Page, workspaceName: RegExp): Promise<string> {
  const currentWorkspaceName = page.getByTestId('current-workspace-name');
  const currentName = (await currentWorkspaceName.textContent())?.trim();

  if (currentName && workspaceName.test(currentName)) return currentName;

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  const workspace = WorkspaceSelectors.item(page).filter({ hasText: workspaceName }).first();

  await workspace.click();
  await expect(currentWorkspaceName).toHaveText(workspaceName, { timeout: 30000 });
  return (await currentWorkspaceName.textContent())?.trim() || 'Nathan workspace';
}

async function openWorkspaceGroup(page: Page, groupName: string) {
  const row = groupRow(page, groupName);
  const editButton = row.locator('[data-testid^="group-edit-"]');

  await expect(row).toBeVisible({ timeout: 15000 });
  if (await editButton.isVisible().catch(() => false)) {
    await editButton.click();
  } else {
    await row.click();
  }

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
  await openGroupMembersTab(page);
  const row = groupMemberRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
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

async function expectSeededGroupPageTitle(page: Page) {
  const editableTitle = PageSelectors.titleInput(page).first();
  const readOnlyTitle = page.getByRole('heading', { name: SPM_GROUP_PAGE_TITLE, exact: true }).first();

  await expect
    .poll(
      async () => {
        const editableText = await editableTitle.textContent().catch(() => undefined);

        if (editableText?.trim() === SPM_GROUP_PAGE_TITLE) return SPM_GROUP_PAGE_TITLE;

        return (await readOnlyTitle.textContent().catch(() => ''))?.trim();
      },
      { timeout: 30000 }
    )
    .toBe(SPM_GROUP_PAGE_TITLE);
}

async function cleanupTemporaryGroup(request: APIRequestContext, page: Page, state: ScenarioState) {
  const token = state.ownerToken || (await getAuthToken(page));

  if (!token) return;

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token));

  if (!workspaceId) return;
  await cleanupGroupsByName(request, token, workspaceId, (group) => group.name === state.groupName);
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

  if (!group) throw new Error(`Seeded workspace group not found: ${SPM_GROUP_NAME}`);
  if (!uid) throw new Error(`Seeded workspace member uid not found: ${email}`);

  await deleteApi(
    request,
    state.ownerToken,
    `/api/workspace/${state.workspaceId}/groups/${group.group_id}/members/${uid}`
  );
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
  const text = await response.text();
  const body = parseApiResponse<void>(text, false);
  const alreadyAbsent = body?.code === -2 && body.message?.toLowerCase().includes('record not found');

  if (response.status() === 404 || alreadyAbsent || (response.ok() && (!text || body?.code === 0))) return;

  throw new Error(`API DELETE failed for ${path}: HTTP ${response.status()} ${text}`);
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
