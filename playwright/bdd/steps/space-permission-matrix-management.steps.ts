import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { SpaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { When, Then, Before, After } = createBdd();

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

type UserWorkspaceInfoPayload = {
  visiting_workspace?: {
    workspace_id?: string;
  };
};

type ScenarioState = {
  workspaceId?: string;
  ownerToken?: string;
  currentSpaceId?: string;
  addedSpaceMemberEmails: Set<string>;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { addedSpaceMemberEmails: new Set() });
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state?.addedSpaceMemberEmails.size) return;

  const token = state.ownerToken || (await getAuthToken(page));

  if (!token) return;

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token).catch(() => undefined));

  if (!workspaceId) return;

  for (const email of state.addedSpaceMemberEmails) {
    await cleanupSpaceMember(request, token, workspaceId, SPM_SPACES['private space'].viewId, email).catch((error) => {
      console.warn(`Failed to cleanup seeded space member "${email}": ${String(error)}`);
    });
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

When('I open the seeded spm0622 {string} manage space panel', async ({ page }, spaceAliasValue: string) => {
  const seededSpace = spmSpace(spaceAliasValue);
  const state = requireState(page);

  state.currentSpaceId = seededSpace.viewId;

  const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);

  await expect(spaceItem).toBeVisible({ timeout: 30000 });
  await spaceItem.hover();
  await spaceItem.getByTestId('inline-more-actions').click({ force: true });
  await page.getByTestId('space-action-manage').click();

  const modal = manageSpaceModal(page);

  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.getByText('Manage Space', { exact: true })).toBeVisible({ timeout: 15000 });
});

When('I open the Manage Space members tab', async ({ page }) => {
  const modal = manageSpaceModal(page);

  await modal.getByRole('tab', { name: 'Members' }).click();
  await expect(modal.getByTestId('workspace-member-inline-search-input')).toBeVisible({ timeout: 15000 });
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

Then('the Manage Space members list does not show seeded spm0622 {string}', async ({ page }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);

  await expect(spaceMemberRow(page, email)).toHaveCount(0, { timeout: 15000 });
});

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

When('I remove seeded spm0622 {string} from the current space', async ({ page }, accountAliasValue: string) => {
  const email = spmAccountEmail(accountAliasValue);
  const row = spaceMemberRow(page, email);

  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: 'Member' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
});

async function ensureWorkspaceContext(page: Page, request: APIRequestContext): Promise<Required<Pick<ScenarioState, 'workspaceId' | 'ownerToken'>>> {
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

function manageSpaceModal(page: Page) {
  return page.getByTestId('manage-space-modal');
}

function spaceMemberRow(page: Page, email: string) {
  return manageSpaceModal(page).locator('[data-testid^="space-member-row-"]').filter({ hasText: email }).first();
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
