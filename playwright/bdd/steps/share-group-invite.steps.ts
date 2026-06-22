import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { ShareSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { When, Then, Before, After } = createBdd();

const TEMPORARY_PAGE_PREFIX = 'bdd share group page';
const TEMPORARY_GROUP_PREFIX = 'bdd share group';

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
};

type ScenarioState = {
  viewId?: string;
  workspaceId?: string;
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

  if (!state?.group && !state?.viewId) return;

  const token = await getAuthToken(page);

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

  if (state.viewId) {
    await postApi<void>(request, token, `/api/workspace/${workspaceId}/page-view/${state.viewId}/move-to-trash`, {});
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

When('I create a temporary share-menu group', async ({ page, request }) => {
  const state = requireState(page);
  const token = await requireAuthToken(page);
  const workspaceId = await getCurrentWorkspaceId(request, token);
  const groupName = `${TEMPORARY_GROUP_PREFIX} ${Date.now().toString(36)}`;

  state.workspaceId = workspaceId;
  state.group = await postApi<WorkspaceGroup>(request, token, `/api/workspace/${workspaceId}/groups`, {
    name: groupName,
  });
});

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
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API GET failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
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
