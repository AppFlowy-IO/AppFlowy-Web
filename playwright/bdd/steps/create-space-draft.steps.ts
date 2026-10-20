import { expect, Page, Request } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { PageSelectors, SpaceSelectors, ModalSelectors } from '../../support/selectors';
import { TestConfig } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

const EVA_EMAIL = 'eva@appflowy.io';
const FIXTURE_PASSWORD = 'AppFlowy!@123';
const NATHAN_WORKSPACE_NAME = /nathan.*workspace/i;

type DraftMutationKind = 'create-space' | 'initial-page' | 'space-update' | 'member' | 'group';

type DraftMutation = {
  kind: DraftMutationKind;
  method: string;
  url: string;
  body: string | null;
};

type DraftScenarioState = {
  mutations: DraftMutation[];
  requestListener?: (request: Request) => void;
  draftName?: string;
  createdSpaceId?: string;
  createdInitialPageId?: string;
  workspaceId?: string;
  expectedMemberUid?: string;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type SpacePermissionResponse = {
  permission?: { visibility?: string };
  current_user_access_level?: number | null;
  explicit_member_count?: number;
  can_manage_space?: boolean;
};

type SpaceMember = {
  email?: string | null;
  role?: string;
  access_level?: number;
  source?: string;
};

type SpaceMembersResponse = {
  members?: SpaceMember[];
};

type WorkspaceSummary = {
  workspace_id?: string;
  workspace_name?: string;
  role?: string;
};

type UserWorkspaceInfoResponse = {
  visiting_workspace?: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
};

const stateByPage = new WeakMap<Page, DraftScenarioState>();

Given('I sign in as Eva and open the Nathan workspace for space creation', async ({ page, request }) => {
  await signInWithPasswordViaUi(page, EVA_EMAIL, FIXTURE_PASSWORD, 2000);
  const token = await getAuthToken(page);

  if (!token) throw new Error('The Eva session has no auth token');
  const response = await request.get(`${TestConfig.apiUrl}/api/user/workspace`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const responseBody = parseJsonObject(responseText) as ApiResponse<UserWorkspaceInfoResponse>;
  const workspaces = [
    ...(responseBody.data?.workspaces ?? []),
    ...(responseBody.data?.visiting_workspace ? [responseBody.data.visiting_workspace] : []),
  ];
  const nathanWorkspace = workspaces.find(({ workspace_name }) => NATHAN_WORKSPACE_NAME.test(workspace_name ?? ''));

  if (!response.ok() || responseBody.code !== 0) {
    throw new Error(`Eva workspace lookup failed: HTTP ${response.status()} ${responseText}`);
  }
  if (!nathanWorkspace?.workspace_id) {
    throw new Error(`Eva cannot find a workspace matching ${NATHAN_WORKSPACE_NAME}`);
  }
  expect(nathanWorkspace.role?.toLowerCase()).toBe('member');

  await page.goto(`/app/${nathanWorkspace.workspace_id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('current-workspace-name')).toHaveText(NATHAN_WORKSPACE_NAME, { timeout: 30000 });
  await expect(PageSelectors.newPageButton(page)).toBeVisible({ timeout: 30000 });
});

After({ tags: '@create-space-draft' }, async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;
  if (state.requestListener) page.off('request', state.requestListener);
  const createMutation = state.mutations.find(({ kind }) => kind === 'create-space');
  const createBody = parseJsonObject(createMutation?.body ?? null);
  const createdSpaceId = state.createdSpaceId ?? asNonEmptyString(createBody.view_id);
  const workspaceId = state.workspaceId ?? (createMutation ? workspaceIdFromMutation(createMutation.url) : undefined);

  if (!createdSpaceId || !workspaceId) return;

  const token = await getAuthToken(page);

  if (!token) return;
  const headers = { Authorization: `Bearer ${token}` };

  await request.post(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/page-view/${createdSpaceId}/move-to-trash`, {
    headers,
    data: {},
  });
  await request.delete(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/trash/${createdSpaceId}`, { headers });
});

When('I start recording create-space draft mutations', async ({ page }) => {
  const previous = stateByPage.get(page);

  if (previous?.requestListener) page.off('request', previous.requestListener);
  const state: DraftScenarioState = { mutations: [] };
  const listener = (request: Request) => {
    const kind = classifyDraftMutation(request);

    if (!kind) return;
    state.mutations.push({
      kind,
      method: request.method(),
      url: request.url(),
      body: request.postData(),
    });
    if (kind === 'create-space') {
      const body = parseJsonObject(request.postData());

      state.createdSpaceId = asNonEmptyString(body.view_id);
      state.workspaceId = workspaceIdFromMutation(request.url());
    }
    if (kind === 'initial-page') {
      state.createdInitialPageId = asNonEmptyString(parseJsonObject(request.postData()).view_id);
    }
  };

  state.requestListener = listener;
  stateByPage.set(page, state);
  page.on('request', listener);
});

When('I open the create-space draft panel', async ({ page }) => {
  await expect(PageSelectors.newPageButton(page)).toBeVisible({ timeout: 20000 });
  await PageSelectors.newPageButton(page).click();
  await expect(ModalSelectors.newPageModal(page)).toBeVisible();
  await ModalSelectors.createNewSpaceButton(page).click();

  const modal = SpaceSelectors.createSpaceModal(page);

  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('space-settings-panel')).toBeVisible();
  await expect(modal.getByText('Create space', { exact: true })).toBeVisible();
  await expect(modal.getByTestId('create-space-submit')).toHaveText('Create');
  await expect(SpaceSelectors.manageSpaceModal(page)).toHaveCount(0);
});

When('I rename the create-space draft to {string}', async ({ page }, requestedName: string) => {
  const state = requireState(page);
  const uniqueName = `${requestedName} ${Date.now()}`;

  state.draftName = uniqueName;
  await SpaceSelectors.createSpaceModal(page).getByTestId('space-name-input').fill(uniqueName);
  await expect(SpaceSelectors.itemByName(page, uniqueName)).toHaveCount(0);
});

When('I change the create-space draft type to {string}', async ({ page }, type: string) => {
  const modal = SpaceSelectors.createSpaceModal(page);
  const generalTab = modal.getByRole('tab', { name: 'General' });

  if ((await generalTab.getAttribute('aria-selected')) !== 'true') await generalTab.click();
  const normalizedType = type.trim().toLowerCase();

  await modal.getByTestId(`manage-space-visibility-option-${normalizedType}`).click();
  await expect(modal.getByTestId(`manage-space-visibility-option-${normalizedType}`)).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

When('the Private create-space draft shows owner-only access and roster', async ({ page }) => {
  const modal = SpaceSelectors.createSpaceModal(page);
  const privateCard = modal.getByTestId('manage-space-private-access-card');

  await expect(privateCard.getByText('Private access', { exact: true })).toBeVisible();
  await expect(privateCard.getByText('Only you can access this space.', { exact: true })).toBeVisible();
  await expect(
    privateCard.getByText('You are the only person with access to this space', { exact: true })
  ).toBeVisible();
  await modal.getByRole('tab', { name: 'Members' }).click();
  await expect(
    modal.getByText('Only you can access a private space. Pages within it can still be shared with collaborators.', {
      exact: true,
    })
  ).toBeVisible();
  const ownerRow = modal.getByTestId('private-space-owner-row');

  await expect(ownerRow.getByText('Workspace owner')).toBeVisible();
  await expect(modal.getByTestId('private-space-owner-locked-role')).toHaveText('Space owner');
  await expect(ownerRow.getByRole('button')).toHaveCount(0);
  await expect(modal.getByTestId('workspace-member-inline-search-input')).toHaveCount(0);
});

When('I add {string} to the create-space draft', async ({ page }, email: string) => {
  const state = requireState(page);
  const modal = SpaceSelectors.createSpaceModal(page);

  await expect(modal.getByTestId('manage-space-visibility-option-custom')).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('tab', { name: 'Members' }).click();
  const search = modal.getByTestId('workspace-member-inline-search-input');

  await expect(search).toBeEnabled({ timeout: 20000 });
  await search.fill(email);
  const result = modal.getByTestId('workspace-member-inline-search-result').filter({ hasText: email }).first();

  await expect(result).toBeVisible({ timeout: 20000 });
  await result.getByTestId('workspace-member-inline-search-result-add').click();
  const draftMembers = modal.getByTestId('create-space-draft-members');

  await expect(draftMembers.getByText(email, { exact: true }).first()).toBeVisible();
  const selectedRowTestId = await draftMembers
    .locator('[data-testid^="create-space-draft-member-"]')
    .getAttribute('data-testid');

  state.expectedMemberUid = selectedRowTestId?.replace('create-space-draft-member-', '');
});

Then('the create-space draft has sent no mutations', async ({ page }) => {
  expect(requireState(page).mutations).toEqual([]);
});

When('I cancel the create-space draft', async ({ page }) => {
  const modal = SpaceSelectors.createSpaceModal(page);

  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toBeHidden();
});

When('I confirm the create-space draft', async ({ page }) => {
  const modal = SpaceSelectors.createSpaceModal(page);

  await modal.getByTestId('create-space-submit').click();
  await expect(modal).toBeHidden({ timeout: 30000 });
});

Then('one renamed Custom space and initial page are created before the queued member', async ({ page }) => {
  const state = requireState(page);

  await expect
    .poll(() => state.mutations.length, {
      message: 'expected structured space, initial page and queued member mutations',
      timeout: 30000,
    })
    .toBe(3);

  expect(state.mutations.map(({ kind }) => kind)).toEqual(['create-space', 'initial-page', 'member']);
  const createBody = parseJsonObject(state.mutations[0].body);
  const initialPageBody = parseJsonObject(state.mutations[1].body);
  const memberBody = parseJsonObject(state.mutations[2].body);
  const permission = createBody.permission as { visibility?: string } | undefined;

  expect(createBody.name).toBe(state.draftName);
  expect(permission?.visibility).toBe('custom');
  expect(typeof createBody.view_id).toBe('string');
  expect(initialPageBody.parent_view_id).toBe(createBody.view_id);
  expect(initialPageBody.view_id).toBeTruthy();
  expect(initialPageBody.collab_id).toBe(initialPageBody.view_id);
  expect(memberBody.role).toBe(SpaceMemberRoleValue.Member);
  expect(memberBody.access_level).toBe(ACCESS_LEVEL_READ_AND_WRITE);
  expect(state.expectedMemberUid).toBeTruthy();
  expect(state.mutations[2].body).toMatch(new RegExp(`"uid"\\s*:\\s*"?${state.expectedMemberUid}"?`));

  state.createdSpaceId = String(createBody.view_id);
  state.workspaceId = workspaceIdFromMutation(state.mutations[0].url);
});

Then('one default Public space and initial page are created through structured APIs', async ({ page }) => {
  const state = requireState(page);

  await expect
    .poll(() => state.mutations.length, {
      message: 'expected structured space and initial-page mutations',
      timeout: 30000,
    })
    .toBe(2);

  expect(state.mutations.map(({ kind }) => kind)).toEqual(['create-space', 'initial-page']);
  const [createMutation, initialPageMutation] = state.mutations;
  const createBody = parseJsonObject(createMutation.body);
  const initialPageBody = parseJsonObject(initialPageMutation.body);
  const permission = createBody.permission as { visibility?: string } | undefined;

  expect(new URL(createMutation.url).pathname).toMatch(/\/api\/workspace\/[^/]+\/spaces$/);
  expect(new URL(createMutation.url).pathname).not.toMatch(/\/v2\/space$/);
  expect(createBody.name).toBe(state.draftName);
  expect(permission?.visibility).toBe('public');
  expect(typeof createBody.view_id).toBe('string');
  expect(initialPageBody.parent_view_id).toBe(createBody.view_id);
  expect(initialPageBody.view_id).toBeTruthy();
  expect(initialPageBody.collab_id).toBe(initialPageBody.view_id);

  state.createdSpaceId = String(createBody.view_id);
  state.createdInitialPageId = String(initialPageBody.view_id);
  state.workspaceId = workspaceIdFromMutation(createMutation.url);
});

Then('the created Public space grants Eva creator ownership via the API', async ({ page, request }) => {
  const state = requireState(page);

  if (!state.workspaceId || !state.createdSpaceId) throw new Error('The created Public space IDs are unavailable');
  const token = await getAuthToken(page);

  if (!token) throw new Error('The seeded Member session has no auth token');
  const headers = { Authorization: `Bearer ${token}` };
  const permissionPath = `/api/workspace/${state.workspaceId}/spaces/${state.createdSpaceId}/permission`;
  const permissionResponse = await request.get(`${TestConfig.apiUrl}${permissionPath}`, {
    headers,
    failOnStatusCode: false,
  });
  const permissionBody = (await permissionResponse.json()) as ApiResponse<SpacePermissionResponse>;

  expect(permissionResponse.ok(), await permissionResponse.text()).toBe(true);
  expect(permissionBody.code).toBe(0);
  expect(permissionBody.data?.permission?.visibility).toBe('public');
  expect(permissionBody.data?.current_user_access_level).toBe(ACCESS_LEVEL_FULL_ACCESS);
  expect(permissionBody.data?.can_manage_space).toBe(true);
  expect(permissionBody.data?.explicit_member_count).toBeGreaterThanOrEqual(1);

  const membersPath = `/api/workspace/${state.workspaceId}/spaces/${state.createdSpaceId}/members`;
  const membersResponse = await request.get(`${TestConfig.apiUrl}${membersPath}`, {
    headers,
    failOnStatusCode: false,
  });
  const membersBody = (await membersResponse.json()) as ApiResponse<SpaceMembersResponse>;
  const creator = membersBody.data?.members?.find(({ email }) => email === EVA_EMAIL);

  expect(membersResponse.ok(), await membersResponse.text()).toBe(true);
  expect(membersBody.code).toBe(0);
  expect(creator).toMatchObject({
    role: 'owner',
    access_level: ACCESS_LEVEL_FULL_ACCESS,
    source: 'creator',
  });
});

Then('the created create-space draft is visible as {string}', async ({ page }, _requestedName: string) => {
  const state = requireState(page);

  if (!state.draftName) throw new Error('The create-space draft was not renamed');
  await expect(SpaceSelectors.itemByName(page, state.draftName)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('view-modal-close')).toBeVisible({ timeout: 30000 });
  if (!state.createdInitialPageId) throw new Error('The created initial-page request had no stable view ID');
  const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

  await expect(viewModal.getByTestId('page-title-input')).toBeVisible({ timeout: 30000 });
  await expect(viewModal.getByTestId('page-title-input')).toHaveAttribute(
    'id',
    `editor-title-${state.createdInitialPageId}`
  );
  await expect(viewModal.getByText('Page not found', { exact: true })).toHaveCount(0);
  await expect(viewModal.getByText(/no access/i)).toHaveCount(0);
});

Then('the created space owner menu shows Manage Space and Duplicate Space', async ({ page }) => {
  const state = requireState(page);

  if (!state.draftName) throw new Error('The created space name is unavailable');
  await page.getByTestId('view-modal-close').click();
  const spaceItem = SpaceSelectors.itemByName(page, state.draftName);

  await expect(spaceItem).toBeVisible({ timeout: 30000 });
  await spaceItem.hover();
  await spaceItem.getByTestId('inline-more-actions').first().click();
  const popover = page.getByTestId('view-actions-popover');

  await expect(popover).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('space-action-permission-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(popover.getByTestId('space-action-manage')).toBeVisible();
  await expect(popover.getByTestId('space-action-duplicate')).toBeVisible();
});

const SpaceMemberRoleValue = {
  Member: 'member',
} as const;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL_ACCESS = 50;

function classifyDraftMutation(request: Request): DraftMutationKind | null {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) return null;
  const pathname = new URL(request.url()).pathname;

  if (/\/api\/workspace\/[^/]+\/(?:spaces|v2\/space|space)$/.test(pathname)) return 'create-space';
  if (/\/api\/workspace\/[^/]+\/page-view$/.test(pathname)) return 'initial-page';
  if (/\/api\/workspace\/[^/]+\/spaces\/[^/]+\/members(?:\/[^/]+)?$/.test(pathname)) return 'member';
  if (/\/api\/workspace\/[^/]+\/spaces\/[^/]+\/(?:group|groups)(?:\/[^/]+)?$/.test(pathname)) return 'group';
  if (/\/api\/workspace\/[^/]+\/spaces\/[^/]+(?:\/permission)?$/.test(pathname)) return 'space-update';
  if (/\/api\/workspace\/[^/]+\/(?:space|v2\/space)\/[^/]+(?:\/permission)?$/.test(pathname)) {
    return 'space-update';
  }
  // Record any future nested mutation route beneath a space as well. Draft
  // interactions must remain side-effect free even when the API grows.
  if (/\/api\/workspace\/[^/]+\/(?:spaces|space|v2\/space)\/[^/]+\/.+$/.test(pathname)) return 'space-update';
  return null;
}

function requireState(page: Page): DraftScenarioState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Create-space draft mutation recording was not started');
  return state;
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function workspaceIdFromMutation(url: string): string {
  const match = new URL(url).pathname.match(/\/api\/workspace\/([^/]+)\//);

  if (!match?.[1]) throw new Error(`Could not read workspace ID from ${url}`);
  return match[1];
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
