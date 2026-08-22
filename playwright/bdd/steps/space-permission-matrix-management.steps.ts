import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { EditorSelectors, ModalSelectors, PageSelectors, SpaceSelectors } from '../../support/selectors';
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
  'guest private': 'spm0622-guest-private@appflowy.local',
  'guest none': 'spm0622-guest-none@appflowy.local',
} as const;

const SPM_SPACES = {
  'default space': {
    // The fixture reuses the workspace's built-in space, whose id is generated
    // when the owner workspace is created.
    viewId: undefined,
    name: 'General',
  },
  'private space': {
    viewId: 'bf0d2d13-6466-4420-a0c0-d4a225f882dc',
    name: 'spm0622 Private Matrix Space',
  },
  'group full access space': {
    viewId: '2d6aa207-656a-4562-926b-307270a76079',
    name: 'spm0622 Group Full Access Space',
  },
} as const;

const SPM_PAGES = {
  'default page': {
    viewId: '25fe29de-a747-482e-8d1f-ea5d0dc17d9a',
    title: 'spm0622 Default Matrix Page',
  },
  'private page': {
    viewId: 'd79a7c58-79fb-4c98-a550-83bc4a8685c5',
    title: 'spm0622 Private Matrix Page',
  },
  'group full access page': {
    viewId: 'ff52f801-5960-44d9-850f-8099a8faf4bc',
    title: 'spm0622 Group Full Access Page',
  },
} as const;

type SpmAccountAlias = keyof typeof SPM_ACCOUNTS;
type SpmSpaceAlias = keyof typeof SPM_SPACES;
type SpmPageAlias = keyof typeof SPM_PAGES;
type SeededSpmPage = (typeof SPM_PAGES)[SpmPageAlias];

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
  currentSeededPage?: SeededSpmPage;
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

  if (!token) throw new Error('Space-permission fixture cleanup has no owner token');

  const workspaceId = state.workspaceId || (await getCurrentWorkspaceId(request, token));

  if (!workspaceId) throw new Error('Space-permission fixture cleanup has no workspace id');

  const temporarySpace = state.temporarySpace || (page as PageWithTemporarySpace).__spmTemporarySpace;
  const cleanupSpaceId = state.currentSpaceId || temporarySpace?.spaceId || SPM_SPACES['private space'].viewId;
  const cleanupErrors: string[] = [];

  if (state.restorePrivateSpaceMemberDefaultAccess) {
    await restoreSeededPrivateSpaceMemberDefaultAccess(request, token, workspaceId).catch((error) => {
      cleanupErrors.push(`seeded private-space default access: ${String(error)}`);
    });
  }

  for (const email of state.addedSpaceMemberEmails) {
    await cleanupSpaceMember(request, token, workspaceId, cleanupSpaceId, email).catch((error) => {
      cleanupErrors.push(`seeded space member "${email}": ${String(error)}`);
    });
  }

  if (temporarySpace) {
    for (const viewId of [temporarySpace.pageId, temporarySpace.spaceId]) {
      await postApi<void>(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`, {}).catch(
        (error) => {
          cleanupErrors.push(`temporary seeded space view "${viewId}": ${String(error)}`);
        }
      );
    }
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Space-permission fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
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

When('I directly open the seeded spm0622 {string}', async ({ page, request }, pageAliasValue: string) => {
  const seededPage = spmPage(pageAliasValue);
  const state = requireState(page);
  const workspaceId = state.workspaceId || (await getSeededSpmWorkspaceId(request));

  state.workspaceId = workspaceId;
  state.currentSeededPage = seededPage;

  const pathname = `/app/${workspaceId}/${seededPage.viewId}`;

  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(pathname);
});

Then(
  'the seeded spm0622 {string} space navigation is {string}',
  async ({ page }, spaceAliasValue: string, visibility: string) => {
    const seededSpace = spmSpace(spaceAliasValue);
    const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);
    const folderViews = page.locator('.folder-views');
    const noAccess = page.getByText('No access to this page', { exact: true });

    // A denied direct URL intentionally replaces the whole app shell. For an
    // accessible page, absence is meaningful only after the sidebar has
    // replaced its loading directory with the resolved outline.
    await expect
      .poll(
        async () =>
          (await noAccess.isVisible().catch(() => false)) || (await folderViews.isVisible().catch(() => false)),
        {
          timeout: 30000,
        }
      )
      .toBe(true);
    if (await folderViews.isVisible().catch(() => false)) {
      await expect(folderViews.locator('.animate-pulse')).toHaveCount(0, { timeout: 30000 });
    }

    switch (visibility) {
      case 'visible':
        await expect(spaceItem).toBeVisible({ timeout: 30000 });
        break;
      case 'hidden':
        await expect(spaceItem).toHaveCount(0, { timeout: 15000 });
        break;
      default:
        throw new Error(`Unsupported seeded spm0622 space navigation visibility: ${visibility}`);
    }
  }
);

Then('the directly opened seeded spm0622 page is {string}', async ({ page }, access: string) => {
  const seededPage = requireCurrentSeededPage(page);
  const title = page.getByText(seededPage.title, { exact: true });
  const titleInput = PageSelectors.titleInput(page);
  const editor = EditorSelectors.firstEditor(page);

  switch (access) {
    case 'editable':
      await expect(title.first()).toBeVisible({ timeout: 30000 });
      await expect(titleInput.first()).toBeVisible({ timeout: 15000 });
      await expect(titleInput.first()).toBeEnabled();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      break;
    case 'read-only':
      await expect(title.first()).toBeVisible({ timeout: 30000 });
      await expect(titleInput).toHaveCount(0, { timeout: 15000 });
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toHaveAttribute('contenteditable', 'false');
      await selectFirstEditorWord(page, editor);
      await waitForSelectionEffects(page);
      await expect(page.getByTestId('inline-comment-readonly-trigger')).toHaveCount(0);
      break;
    case 'denied':
      await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout: 30000 });
      await expect(title).toHaveCount(0);
      await expect(titleInput).toHaveCount(0);
      break;
    default:
      throw new Error(`Unsupported seeded spm0622 page access expectation: ${access}`);
  }
});

async function selectFirstEditorWord(page: Page, editor: Locator) {
  const firstText = editor.locator('[data-slate-string="true"]').first();

  await expect(firstText).toBeVisible({ timeout: 15000 });
  await firstText.dblclick({ position: { x: 4, y: 4 } });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim().length ?? 0)).toBeGreaterThan(0);
}

async function waitForSelectionEffects(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

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
  // Register cleanup before starting the mutation so a post-commit UI failure
  // cannot leave the canonical fixture member attached.
  requireState(page).addedSpaceMemberEmails.add(email);
  await addButton.click();

  // The click starts an async mutation. Wait for its roster revalidation before
  // the next step clears this owner session; otherwise navigation can abort the
  // in-flight request and the newly signed-in member never receives the space.
  const memberRow = spaceMemberRow(page, email);

  await expect(memberRow).toBeVisible({ timeout: 15000 });
  await expect(memberRow.getByText(email, { exact: true }).first()).toBeVisible();
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
  requireState(page).addedSpaceMemberEmails.delete(email);
});

Then('seeded spm0622 {string} cannot see the temporary private space', async ({ page }, accountAliasValue: string) => {
  const temporarySpace = requireTemporarySpace(page);

  await signInSeededSpmAccount(page, accountAliasValue);
  await waitForResolvedFolderOutline(page);
  await expect(SpaceSelectors.itemByName(page, temporarySpace.spaceName)).toHaveCount(0, { timeout: 15000 });
});

Then('seeded spm0622 {string} can see the temporary private space', async ({ page }, accountAliasValue: string) => {
  const temporarySpace = requireTemporarySpace(page);

  await signInSeededSpmAccount(page, accountAliasValue);
  await expect(SpaceSelectors.itemByName(page, temporarySpace.spaceName)).toBeVisible({ timeout: 30000 });
});

Then('seeded spm0622 {string} can use the temporary private page', async ({ page }, accountAliasValue: string) => {
  const temporarySpace = requireTemporarySpace(page);
  const workspaceId = requireWorkspaceId(page);

  await expectCurrentSeededAccount(page, accountAliasValue);
  await page.goto(`/app/${workspaceId}/${temporarySpace.pageId}`, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30000 })
    .toBe(`/app/${workspaceId}/${temporarySpace.pageId}`);

  const titleInput = PageSelectors.titleInput(page).first();
  const editor = EditorSelectors.firstEditor(page);

  await expect(titleInput).toBeVisible({ timeout: 15000 });
  await expect(titleInput).toHaveText(temporarySpace.pageTitle);
  await expect(titleInput).toBeEnabled();
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
});

Then(
  'seeded spm0622 {string} receives no access to the temporary private page',
  async ({ page }, accountAliasValue: string) => {
    const temporarySpace = requireTemporarySpace(page);
    const workspaceId = requireWorkspaceId(page);

    await expectCurrentSeededAccount(page, accountAliasValue);
    await page.goto(`/app/${workspaceId}/${temporarySpace.pageId}`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 30000 })
      .toBe(`/app/${workspaceId}/${temporarySpace.pageId}`);
    await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(temporarySpace.pageTitle, { exact: true })).toHaveCount(0);
    await expect(PageSelectors.titleInput(page)).toHaveCount(0);
    await expect(EditorSelectors.firstEditor(page)).toHaveCount(0);
  }
);

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

function requireCurrentSeededPage(page: Page): SeededSpmPage {
  const seededPage = requireState(page).currentSeededPage;

  if (!seededPage) {
    throw new Error('No seeded spm0622 page has been opened directly');
  }

  return seededPage;
}

function requireWorkspaceId(page: Page): string {
  const workspaceId = requireState(page).workspaceId;

  if (!workspaceId) {
    throw new Error('No seeded spm0622 workspace id has been resolved');
  }

  return workspaceId;
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

async function waitForResolvedFolderOutline(page: Page) {
  const folderViews = page.locator('.folder-views');

  await expect(folderViews).toBeVisible({ timeout: 30000 });
  await expect(folderViews.locator('.animate-pulse')).toHaveCount(0, { timeout: 30000 });
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

  if (!uid) throw new Error(`Workspace member uid not found during cleanup: ${email}`);

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

    await patchApi(request, token, `/api/workspace/${workspaceId}/spaces/${spaceId}/members/${uid}`, {
      role: target.role,
      access_level: target.accessLevel,
    });
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

async function getSeededSpmWorkspaceId(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      email: SPM_ACCOUNTS['owner 1'],
      password: PASSWORD,
    },
    failOnStatusCode: false,
  });
  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Could not authenticate the seeded spm0622 owner: HTTP ${response.status()} ${text}`);
  }

  const token = (parseJson(text) as { access_token?: string } | null)?.access_token;

  if (!token) {
    throw new Error(`Seeded spm0622 owner sign-in response has no access token: ${text}`);
  }

  return getCurrentWorkspaceId(request, token);
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
  const text = await response.text();
  const body = parseApiResponse<void>(text, false);
  const alreadyAbsent = body?.code === -2 && body.message?.toLowerCase().includes('record not found');

  if (response.status() === 404 || alreadyAbsent || (response.ok() && (!text || body?.code === 0))) return;

  throw new Error(`API DELETE failed for ${path}: HTTP ${response.status()} ${text}`);
}

function parseApiResponse<T>(text: string, preserveUid: boolean): ApiResponse<T> | null {
  if (!text) return null;

  return parseJson(preserveUid ? text.replace(UID_FIELD_REGEX, '"uid":"$1"') : text) as ApiResponse<T> | null;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
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

async function expectCurrentSeededAccount(page: Page, accountAliasValue: string) {
  const expectedEmail = spmAccountEmail(accountAliasValue);

  await expect
    .poll(() => currentSessionEmail(page), {
      message: `expected the current seeded session to use ${expectedEmail}`,
      timeout: 10000,
    })
    .toBe(expectedEmail);
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
