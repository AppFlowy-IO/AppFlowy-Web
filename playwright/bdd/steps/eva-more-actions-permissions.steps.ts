import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import {
  AccessLevel,
  SpaceInvitePolicy,
  SpaceMemberRole,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '../../../src/application/types';
import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { expandSpaceByName } from '../../support/page-utils';
import {
  DropdownSelectors,
  HeaderSelectors,
  PageSelectors,
  SidebarSelectors,
  SpaceSelectors,
  ViewActionSelectors,
} from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const OWNER_EMAIL = 'nathan@appflowy.io';
const EVA_EMAIL = 'eva@appflowy.io';
const FIXTURE_PASSWORD = 'AppFlowy!@123';
const VIEW_LAYOUT_DOCUMENT = 0;
const FIXTURE_PAGE_ALIASES = {
  'Grante full access for eva': AccessLevel.FullAccess,
  'Edit only permission for eva': AccessLevel.ReadAndWrite,
  'Read only permission for eva': AccessLevel.ReadOnly,
} as const;
const MENU_ACTIONS = {
  Rename: (page: Page) => ViewActionSelectors.renameButton(page),
  'Change icon': (page: Page) => ViewActionSelectors.changeIconButton(page),
  'Lock page': (page: Page) => page.getByTestId('more-page-lock'),
  Duplicate: (page: Page) => ViewActionSelectors.duplicateButton(page),
  'Move to': (page: Page) => ViewActionSelectors.moveToButton(page),
  'Find and replace': (page: Page) => page.getByTestId('more-page-find-and-replace'),
  Delete: (page: Page) => ViewActionSelectors.deleteButton(page),
  'Version history': (page: Page) => page.getByTestId('more-page-version-history'),
  'Open in a new tab': (page: Page) => ViewActionSelectors.openNewTabButton(page),
} satisfies Record<string, (page: Page) => Locator>;

type MenuActionLabel = keyof typeof MENU_ACTIONS;
type FixturePageAlias = keyof typeof FIXTURE_PAGE_ALIASES;

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type WorkspaceInfo = {
  visiting_workspace: { workspace_id: string };
  workspaces: { workspace_id: string }[];
};

type FixturePage = {
  pageId: string;
  pageName: string;
  spaceId: string;
  spaceName: string;
};

type EvaPermissionFixture = {
  workspaceId: string;
  ownerToken: string;
  evaToken: string;
  pages: Record<FixturePageAlias, FixturePage>;
};

type ScenarioState = {
  runId: string;
  fixture?: EvaPermissionFixture;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before({ tags: '@eva-more-actions-permissions' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
});

After({ tags: '@eva-more-actions-permissions' }, async ({ page, request }) => {
  const state = stateByPage.get(page);
  let cleanupError: unknown;

  if (state?.fixture) {
    try {
      await cleanupTemporarySpaces(
        request,
        state.fixture.ownerToken,
        state.fixture.workspaceId,
        Object.values(state.fixture.pages).map(({ spaceId }) => spaceId)
      );
    } catch (error) {
      cleanupError = error;
    }
  }

  stateByPage.delete(page);

  if (cleanupError) {
    throw new Error(`Eva permission fixture cleanup failed: ${String(cleanupError)}`);
  }
});

Given('a temporary Eva page action permission fixture exists', async ({ page, request }) => {
  await prepareEvaPermissionFixture(page, request);
});

Given('I sign in as seeded Eva', async ({ page }) => {
  const fixture = requireFixture(page);
  const initialPage = fixture.pages['Grante full access for eva'];

  await signInWithPasswordViaUi(page, EVA_EMAIL, FIXTURE_PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
  await page.goto(`/app/${fixture.workspaceId}/${initialPage.pageId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
  await expandSpaceByName(page, initialPage.spaceName);
});

When("I open Eva's sidebar more menu for {string}", async ({ page }, pageName: string) => {
  const fixturePage = getFixturePage(page, pageName);

  await expandSpaceByName(page, fixturePage.spaceName);
  await openSidebarMoreMenuForPage(page, fixturePage.pageName);
});

When("I open Eva's page {string}", async ({ page }, pageName: string) => {
  const fixturePage = getFixturePage(page, pageName);

  await expandSpaceByName(page, fixturePage.spaceName);
  await openPageFromSidebar(page, fixturePage.pageName);
});

When("I open Eva's page more menu", async ({ page }) => {
  await openPageMoreMenu(page);
});

When("I close Eva's sidebar more menu", async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(ViewActionSelectors.popover(page)).toHaveCount(0);
});

When("I close Eva's page more menu", async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(DropdownSelectors.content(page)).toHaveCount(0);
});

When("I inspect Eva's temporary permission space actions", async ({ page, request }) => {
  const fixture = requireFixture(page);
  const readOnlyPage = fixture.pages['Read only permission for eva'];
  const permissionPath = `/api/workspace/${fixture.workspaceId}/spaces/${readOnlyPage.spaceId}/permission`;
  const permission = await getApi<SpacePermissionResponsePayload>(request, fixture.evaToken, permissionPath);

  expect(permission.can_manage_space).toBe(false);
  expect(permission.current_user_access_level).toBe(AccessLevel.ReadOnly);

  await expandSpaceByName(page, readOnlyPage.spaceName);
  const spaceItem = SpaceSelectors.itemByName(page, readOnlyPage.spaceName);

  await expect(spaceItem).toBeVisible({ timeout: 30000 });
  await spaceItem.scrollIntoViewIfNeeded();
  await spaceItem.hover({ force: true });
  await expect(async () => {
    await spaceItem.hover({ force: true });
    await expect(spaceItem.getByTestId('inline-more-actions')).toHaveCount(0);
  }).toPass({ timeout: 3000, intervals: [250, 500, 1000] });
});

Then("Eva's sidebar more menu shows only {string}", async ({ page }, expectedActions: string) => {
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });
  await assertMoreMenuShowsOnly(page, ViewActionSelectors.popover(page), expectedActions);
});

Then("Eva's page more menu shows only {string}", async ({ page }, expectedActions: string) => {
  const menu = DropdownSelectors.content(page).last();

  await expect(menu).toBeVisible({ timeout: 15000 });
  await assertMoreMenuShowsOnly(page, menu, expectedActions);
});

Then("Eva's temporary permission space more actions button is hidden", async ({ page }) => {
  const readOnlyPage = requireFixture(page).pages['Read only permission for eva'];
  const spaceItem = SpaceSelectors.itemByName(page, readOnlyPage.spaceName);

  await expect(spaceItem.getByTestId('inline-more-actions')).toHaveCount(0);
  await expect(ViewActionSelectors.popover(page)).toHaveCount(0);
});

async function assertMoreMenuShowsOnly(page: Page, popover: Locator, expectedActions: string): Promise<void> {
  const expectedLabels = parseExpectedLabels(expectedActions);

  await expect(page.getByTestId('more-actions-permission-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(popover.locator('[role="menuitem"]:visible')).toHaveCount(expectedLabels.size);

  for (const [label, locatorForPage] of Object.entries(MENU_ACTIONS) as [MenuActionLabel, (page: Page) => Locator][]) {
    const locator = locatorForPage(page);

    if (expectedLabels.has(label)) {
      await expect(locator).toBeVisible({ timeout: 15000 });
    } else {
      await expect(locator).toHaveCount(0);
    }
  }
}

async function openSidebarMoreMenuForPage(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);

  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.hover({ force: true });

  const moreActionsButton = pageItem.getByTestId('page-more-actions').first();

  await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
  await moreActionsButton.click({ force: true });
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });
}

async function openPageFromSidebar(page: Page, pageName: string): Promise<void> {
  const pageItem = PageSelectors.itemByName(page, pageName);

  await expect(pageItem).toBeVisible({ timeout: 30000 });
  await pageItem.scrollIntoViewIfNeeded();
  await pageItem.getByTestId('page-name').click({ force: true });
  await expect(page.locator('main').getByText(pageName, { exact: true }).first()).toBeVisible({ timeout: 30000 });
}

async function openPageMoreMenu(page: Page): Promise<void> {
  const moreActionsButton = HeaderSelectors.moreActionsButton(page);

  await expect(moreActionsButton).toBeVisible({ timeout: 15000 });
  await moreActionsButton.click({ force: true });
  await expect(DropdownSelectors.content(page).last()).toBeVisible({ timeout: 15000 });
}

function parseExpectedLabels(expectedActions: string): Set<MenuActionLabel> {
  const labels = expectedActions
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  for (const label of labels) {
    if (!isMenuActionLabel(label)) {
      throw new Error(`Unknown Eva more-action menu label: ${label}`);
    }
  }

  return new Set(labels as MenuActionLabel[]);
}

function isMenuActionLabel(label: string): label is MenuActionLabel {
  return label in MENU_ACTIONS;
}

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Eva page action permission scenario state has not been initialized');
  }

  return state;
}

function requireFixture(page: Page): EvaPermissionFixture {
  const fixture = requireState(page).fixture;

  if (!fixture) {
    throw new Error('The temporary Eva page action permission fixture has not been created');
  }

  return fixture;
}

function getFixturePage(page: Page, aliasValue: string): FixturePage {
  if (!(aliasValue in FIXTURE_PAGE_ALIASES)) {
    throw new Error(`Unknown Eva permission fixture page alias: ${aliasValue}`);
  }

  return requireFixture(page).pages[aliasValue as FixturePageAlias];
}

async function prepareEvaPermissionFixture(page: Page, request: APIRequestContext): Promise<void> {
  const state = requireState(page);
  const ownerToken = await signInApi(request, OWNER_EMAIL, FIXTURE_PASSWORD);
  const evaToken = await signInApi(request, EVA_EMAIL, FIXTURE_PASSWORD);
  const workspaceInfo = await getApi<WorkspaceInfo>(request, ownerToken, '/api/user/workspace');
  const workspaceId = workspaceInfo.visiting_workspace.workspace_id;

  await joinWorkspaceByInviteCode(request, ownerToken, evaToken, workspaceId);

  const evaUid = await findWorkspaceMemberUid(request, ownerToken, workspaceId, EVA_EMAIL);
  const suffix = state.runId.slice(-12);
  const pages = {} as Record<FixturePageAlias, FixturePage>;
  const createdSpaceIds: string[] = [];

  try {
    for (const [alias, accessLevel] of Object.entries(FIXTURE_PAGE_ALIASES) as [FixturePageAlias, AccessLevel][]) {
      const spaceName = `BDD Eva ${accessLevel} actions ${suffix}`;
      const requestedSpaceId = uuidv4();

      // Record the requested ID before the call so teardown can remove a space
      // even when the server commits it but the HTTP response times out.
      createdSpaceIds.push(requestedSpaceId);

      const createdSpace = await postApi<{ view_id: string }>(
        request,
        ownerToken,
        `/api/workspace/${workspaceId}/spaces`,
        {
          name: spaceName,
          space_icon: 'lock',
          space_icon_color: '#555555',
          view_id: requestedSpaceId,
          permission: {
            visibility: SpaceVisibility.Custom,
            owner_access_level: AccessLevel.FullAccess,
            member_default_access_level: accessLevel,
            everyone_else_access_level: null,
            invite_policy: SpaceInvitePolicy.OwnersOnly,
            sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
            invite_link_enabled: false,
            security: {
              disable_guests: false,
              disable_public_links: false,
              disable_export: false,
            },
          },
        }
      );

      // Also retain an unexpected returned ID so the validation failure below
      // cannot leave a server-created fixture behind.
      createdSpaceIds.push(createdSpace.view_id);

      if (createdSpace.view_id !== requestedSpaceId) {
        throw new Error(`Structured space returned ${createdSpace.view_id}; expected ${requestedSpaceId}`);
      }

      await postRawApi(
        request,
        ownerToken,
        `/api/workspace/${workspaceId}/spaces/${createdSpace.view_id}/members`,
        `{"uid":${evaUid},"role":"${SpaceMemberRole.Member}","access_level":${accessLevel}}`
      );

      const pageName = `${alias} ${suffix}`;
      const createdPage = await postApi<{ view_id: string }>(
        request,
        ownerToken,
        `/api/workspace/${workspaceId}/page-view`,
        {
          parent_view_id: createdSpace.view_id,
          layout: VIEW_LAYOUT_DOCUMENT,
          name: pageName,
        }
      );

      pages[alias] = {
        pageId: createdPage.view_id,
        pageName,
        spaceId: createdSpace.view_id,
        spaceName,
      };
    }

    for (const fixturePage of Object.values(pages)) {
      await expect
        .poll(
          async () => {
            const response = await request.get(
              `${TestConfig.apiUrl}/api/workspace/${workspaceId}/page-view/${fixturePage.pageId}`,
              { headers: apiHeaders(evaToken), failOnStatusCode: false }
            );
            const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

            return response.ok() && body?.code === 0;
          },
          { timeout: 30000, message: `waiting for Eva to receive access to ${fixturePage.spaceName}` }
        )
        .toBe(true);
    }

    state.fixture = { workspaceId, ownerToken, evaToken, pages };
  } catch (error) {
    try {
      await cleanupTemporarySpaces(request, ownerToken, workspaceId, createdSpaceIds);
    } catch (cleanupError) {
      throw new Error(
        `Eva permission fixture setup failed: ${String(error)}; cleanup also failed: ${String(cleanupError)}`
      );
    }

    throw error;
  }
}

type SpacePermissionResponsePayload = {
  current_user_access_level?: AccessLevel | null;
  can_manage_space?: boolean;
};

async function cleanupTemporarySpaces(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  spaceIds: string[]
): Promise<void> {
  const failures: string[] = [];

  for (const spaceId of [...new Set(spaceIds)].reverse()) {
    try {
      await postApi<void>(request, token, `/api/workspace/${workspaceId}/page-view/${spaceId}/move-to-trash`, {});
      await deleteApi<void>(request, token, `/api/workspace/${workspaceId}/trash/${spaceId}`);
    } catch (error) {
      failures.push(`${spaceId}: ${String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}

async function signInApi(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email, password },
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const body = parseJson<{ access_token?: string }>(responseText);

  if (!response.ok() || !body?.access_token) {
    throw new Error(`Cannot sign in the Eva permission fixture account ${email}: HTTP ${response.status()}`);
  }

  return body.access_token;
}

async function joinWorkspaceByInviteCode(
  request: APIRequestContext,
  ownerToken: string,
  memberToken: string,
  workspaceId: string
): Promise<void> {
  const memberWorkspace = await getApi<WorkspaceInfo>(request, memberToken, '/api/user/workspace');

  if (memberWorkspace.workspaces.some((workspace) => workspace.workspace_id === workspaceId)) return;

  const createdInvite = await postApi<{ code: string | null }>(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/invite-code`,
    { validity_period_hours: 24 }
  );
  const inviteCode =
    createdInvite.code ??
    (await getApi<{ code: string | null }>(request, ownerToken, `/api/workspace/${workspaceId}/invite-code`)).code;

  if (!inviteCode) {
    throw new Error(`Workspace ${workspaceId} did not return an invite code`);
  }

  await postApi<{ workspace_id: string }>(request, memberToken, '/api/workspace/join-by-invite-code', {
    code: inviteCode,
  });
}

async function findWorkspaceMemberUid(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  email: string
): Promise<string> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/member?include_pending=true`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const normalized = responseText.replace(/"uid"\s*:\s*(\d{16,})/g, '"uid":"$1"');
  const body = parseJson<ApiResponse<Array<{ uid?: string | number; email: string }>>>(normalized);
  const member = body?.data?.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());

  if (!response.ok() || body?.code !== 0 || member?.uid === undefined) {
    throw new Error(`Cannot find ${email} in workspace ${workspaceId}: HTTP ${response.status()} ${responseText}`);
  }

  return String(member.uid);
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });

  return parseApiResponse<T>(response.status(), response.ok(), await response.text(), `GET ${path}`);
}

async function postApi<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data,
    failOnStatusCode: false,
  });

  return parseApiResponse<T>(response.status(), response.ok(), await response.text(), `POST ${path}`);
}

async function deleteApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });

  return parseApiResponse<T>(response.status(), response.ok(), await response.text(), `DELETE ${path}`);
}

async function postRawApi(request: APIRequestContext, token: string, path: string, rawBody: string): Promise<void> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: rawBody,
    failOnStatusCode: false,
  });

  parseApiResponse<void>(response.status(), response.ok(), await response.text(), `POST ${path}`);
}

function parseApiResponse<T>(status: number, ok: boolean, responseText: string, operation: string): T {
  const body = parseJson<ApiResponse<T>>(responseText);

  if (!ok || body?.code !== 0) {
    throw new Error(`${operation} failed: HTTP ${status} ${responseText}`);
  }

  return body.data as T;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
