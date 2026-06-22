import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { AccountSelectors, WorkspaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const OWNER_EMAIL = 'nathan@appflowy.io';
const OWNER_PASSWORD = 'AppFlowy!@123';
const TEMPORARY_GROUP_PREFIX = 'bdd group management';

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
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { groupDeleted: false });
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state?.groupName || state.groupDeleted) return;

  await cleanupTemporaryGroup(request, page, state).catch((error) => {
    console.warn(`Failed to cleanup temporary workspace group "${state.groupName}": ${String(error)}`);
  });
});

Given('I sign in as the Nathan workspace owner', async ({ page, request }) => {
  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, OWNER_EMAIL, OWNER_PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  const state = requireState(page);
  const ownerToken = await getAuthToken(page);

  if (!ownerToken) {
    throw new Error('No auth token found after signing in as the workspace owner');
  }

  state.ownerToken = ownerToken;
  state.workspaceId = await getCurrentWorkspaceId(request, ownerToken);
  await cleanupStaleTemporaryGroups(request, ownerToken, state.workspaceId);
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
  const groupName = requireGroupName(page);

  await groupRow(page, groupName).click();

  const modal = groupDetailModal(page);

  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText(groupName, { exact: true })).toBeVisible({ timeout: 15000 });
});

When('I add workspace member {string} to the temporary group', async ({ page }, email: string) => {
  const modal = groupDetailModal(page);

  await modal.getByRole('tab', { name: 'Members' }).click();

  const input = modal.getByTestId('workspace-member-inline-search-input');

  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(input).toBeEnabled({ timeout: 15000 });
  await input.fill(email);

  const resultRow = modal.getByTestId('workspace-member-inline-search-result').filter({ hasText: email }).first();
  const addButton = resultRow.getByTestId('workspace-member-inline-search-result-add');

  await expect(resultRow).toBeVisible({ timeout: 15000 });
  await expect(addButton).toBeEnabled({ timeout: 15000 });
  await addButton.click();
});

Then('the temporary group shows workspace member {string}', async ({ page }, email: string) => {
  await expect(groupMemberRow(page, email)).toBeVisible({ timeout: 15000 });
});

When('I remove workspace member {string} from the temporary group', async ({ page }, email: string) => {
  const row = groupMemberRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: 'Group member actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove from group' }).click();
});

Then('the temporary group does not show workspace member {string}', async ({ page }, email: string) => {
  await expect(groupMemberRow(page, email)).toHaveCount(0, { timeout: 15000 });
});

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

async function getCurrentWorkspaceId(request: APIRequestContext, token: string): Promise<string> {
  const payload = await getApi<UserWorkspaceInfoPayload>(request, token, '/api/user/workspace');
  const workspaceId = payload.visiting_workspace?.workspace_id;

  if (!workspaceId) {
    throw new Error(`No visiting workspace id in /api/user/workspace response: ${JSON.stringify(payload)}`);
  }

  return workspaceId;
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
    throw new Error(`API GET failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function deleteApi(request: APIRequestContext, token: string, path: string): Promise<void> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    throw new Error(`API DELETE failed for ${path}: HTTP ${response.status()} ${await response.text()}`);
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
