import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { EditorSelectors, PageSelectors, ShareSelectors, SpaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL_ACCESS = 50;
const SPACE_MEMBER_ROLE_MEMBER = 'member';
// Seeded space-level grant for group One: an ordinary Member with Can view access.
const SEEDED_GROUP_ONE_ROLE = SPACE_MEMBER_ROLE_MEMBER;
const SEEDED_GROUP_ONE_ACCESS = ACCESS_LEVEL_READ_ONLY;
// Seeded page-level share for group Two on Group Page A.
const SEEDED_GROUP_TWO_PAGE_ACCESS = ACCESS_LEVEL_READ_AND_WRITE;
// Workspace member uids exceed Number.MAX_SAFE_INTEGER; keep them as strings
// when they travel through JSON so group member calls address the right user.
const UID_FIELD_REGEX = /"uid"\s*:\s*(\d{16,})/g;
// A server-pushed permission change has to reach the open page over the
// WebSocket and trigger a re-probe; allow generous time before calling it a gap.
const LIVE_REFRESH_TIMEOUT_MS = 60000;
// The app drops to a safe read-only state the moment the push arrives and only
// then re-probes the server (with up to 250/1000/3000ms retries). Hold the
// observed verdict past that window so a transient state cannot satisfy it.
const LIVE_REFRESH_SETTLE_MS = 5000;

const STG_ACCOUNTS = {
  owner: 'stg0822-own@appflowy.local',
  nathan: 'stg0822-nathan@appflowy.local',
  reader: 'stg0822-reader@appflowy.local',
  outsider: 'stg0822-outsider@appflowy.local',
} as const;

const STG_GROUPS = {
  'group one': 'stg0822 Group One',
  'group two': 'stg0822 Group Two',
} as const;

const STG_SPACES = {
  'group space A': {
    viewId: '2f3a9c4e-6b1d-4e8a-9f0c-7d5b3a1e8c21',
    name: 'stg0822 Group Space A',
  },
} as const;

const STG_PAGES = {
  'group page A': {
    viewId: 'b7e2d4a1-3c5f-4a6b-8e9d-1f2a3b4c5d6e',
    title: 'stg0822 Group Page A',
  },
  'group page B': {
    viewId: 'c8f3e5b2-4d60-4b7c-9fae-2a3b4c5d6e7f',
    title: 'stg0822 Group Page B',
  },
} as const;

type StgAccountAlias = keyof typeof STG_ACCOUNTS;
type StgGroupAlias = keyof typeof STG_GROUPS;
type StgSpaceAlias = keyof typeof STG_SPACES;
type StgPageAlias = keyof typeof STG_PAGES;
type SeededStgPage = (typeof STG_PAGES)[StgPageAlias];

// Seeded group rosters: nathan sits in both groups, reader only in group One.
const SEEDED_GROUP_MEMBERSHIPS: Record<StgGroupAlias, StgAccountAlias[]> = {
  'group one': ['nathan', 'reader'],
  'group two': ['nathan'],
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type WorkspaceSummary = {
  workspace_id?: string;
  owner_email?: string;
  role?: string;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace?: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
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

type WorkspaceGroupMember = {
  uid?: string | number;
  email: string;
  name?: string;
};

type WorkspaceGroupMembersPayload = {
  members: WorkspaceGroupMember[];
};

type SpaceGroupPermission = {
  group_id: string;
  name: string;
  role: string;
  access_level: number;
  member_count: number;
  source: string;
};

type SpaceGroupPermissionsPayload = {
  groups: SpaceGroupPermission[];
};

type ViewGroupPermission = {
  group_id: string;
  name: string;
  access_level: number;
  member_count: number;
};

type ViewGroupPermissionsPayload = {
  groups: ViewGroupPermission[];
};

type SpacePermissionResponsePayload = {
  current_user_access_level?: number | null;
  can_manage_space?: boolean;
  can_manage_members?: boolean;
};

// Fixture context resolved through the owner's API token (never hardcoded):
// the workspace that hosts the seeded space and the ids of both seeded groups.
type FixtureContext = {
  ownerToken: string;
  workspaceId: string;
  groupIds: Record<StgGroupAlias, string>;
};

// Snapshot of the open browser page taken right before an owner API mutation.
// A live permission refresh must keep the URL and the in-memory marker intact:
// a reload recreates `window`, a navigation changes the URL.
type LiveSession = {
  label: string;
  url: string;
  marker: string;
  mutatedAt: number;
};

type LiveMarkerWindow = Window & { __stg0822LiveMarker?: string };

type ScenarioState = {
  fixture?: FixtureContext;
  currentSeededPage?: SeededStgPage;
  // Set before the owner-role mutation starts so the After hook restores the
  // canonical group One grant even when a later assertion fails.
  restoreGroupOneGrant?: boolean;
  // Set before a group membership mutation starts so the After hook re-adds
  // every seeded membership even when a later live assertion fails.
  restoreGroupMemberships?: boolean;
  liveSession?: LiveSession;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {});
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state?.restoreGroupOneGrant && !state?.restoreGroupMemberships) return;

  // Re-authenticate the owner through the API: the browser session may now belong
  // to another seeded account (or be gone entirely) when the scenario ends.
  const fixture = await resolveFixtureContext(request);

  if (state.restoreGroupMemberships) {
    await ensureSeededGroupMemberships(request, fixture);
  }

  if (state.restoreGroupOneGrant) {
    await ensureSeededGroupOneGrant(request, fixture);
  }
});

Given('the seeded stg0822 space group permission fixture exists', async ({ page, request }) => {
  // Seed with (server repo):
  // cargo test --test space_group_permission_seed seed_space_group_permission_suite -- --ignored --nocapture
  //
  // Resolving the context here also re-asserts the seeded group rosters and the
  // group One grant, so an interrupted mutating scenario cannot leak into the
  // read-only scenarios.
  const fixture = await resolveFixtureContext(request);

  await ensureSeededGroupMemberships(request, fixture);
  await ensureSeededGroupOneGrant(request, fixture);
  requireState(page).fixture = fixture;
});

Given('I sign in as seeded stg0822 {string}', async ({ page }, accountAliasValue: string) => {
  await signInSeededStgAccount(page, accountAliasValue);
});

When('I open the seeded stg0822 workspace', async ({ page }) => {
  const { workspaceId } = requireFixture(page);
  const pathname = `/app/${workspaceId}`;

  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toContain(pathname);
  await waitForResolvedFolderOutline(page);
});

When('I directly open the seeded stg0822 {string}', async ({ page }, pageAliasValue: string) => {
  const seededPage = stgPage(pageAliasValue);
  const { workspaceId } = requireFixture(page);
  const pathname = `/app/${workspaceId}/${seededPage.viewId}`;

  requireState(page).currentSeededPage = seededPage;
  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(pathname);
});

Then(
  'the seeded stg0822 {string} space navigation is {string}',
  async ({ page }, spaceAliasValue: string, visibility: string) => {
    const seededSpace = stgSpace(spaceAliasValue);
    const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);

    await waitForResolvedFolderOutline(page);

    switch (visibility) {
      case 'visible':
        await expect(spaceItem).toBeVisible({ timeout: 30000 });
        break;
      case 'hidden':
        await expect(spaceItem).toHaveCount(0, { timeout: 15000 });
        break;
      default:
        throw new Error(`Unsupported seeded stg0822 space navigation visibility: ${visibility}`);
    }
  }
);

Then('the directly opened seeded stg0822 page is {string}', async ({ page }, access: string) => {
  await expectSeededPageAccess(page, requireCurrentSeededPage(page), access);
});

// The page stays open while the owner mutates permissions over the API; the
// server's permission-changed push must flip the rendered access in place.
Then('the open seeded stg0822 page becomes {string} without reload', async ({ page }, access: string) => {
  const seededPage = requireCurrentSeededPage(page);
  const live = requireLiveSession(page);

  await expectSeededPageAccess(page, seededPage, access, LIVE_REFRESH_TIMEOUT_MS);

  const elapsedMs = Date.now() - live.mutatedAt;

  // Re-assert once the re-probe has had time to settle: the verdict must be
  // the server's, not the interim safe state.
  await page.waitForTimeout(LIVE_REFRESH_SETTLE_MS);
  await expectSeededPageAccess(page, seededPage, access, 5000);
  await expectNoReloadSince(page, live);
  console.log(`[stg0822 live] ${seededPage.title} became ${access} ${elapsedMs}ms after ${live.label}`);
});

Then(
  'the seeded stg0822 {string} space navigation becomes {string} without reload',
  async ({ page }, spaceAliasValue: string, visibility: string) => {
    const seededSpace = stgSpace(spaceAliasValue);
    const live = requireLiveSession(page);
    const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);
    const expectSpaceVisibility = async (timeout: number) => {
      switch (visibility) {
        case 'visible':
          await expect(spaceItem).toBeVisible({ timeout });
          break;
        case 'hidden':
          // The outline may be cleared while it refetches; only a resolved outline
          // that still lacks the space proves the sidebar dropped it.
          await expect(spaceItem).toHaveCount(0, { timeout });
          await waitForResolvedFolderOutline(page);
          await expect(spaceItem).toHaveCount(0);
          break;
        default:
          throw new Error(`Unsupported seeded stg0822 space navigation visibility: ${visibility}`);
      }
    };

    await expectSpaceVisibility(LIVE_REFRESH_TIMEOUT_MS);

    const elapsedMs = Date.now() - live.mutatedAt;

    // Re-assert once the outline refetch has had time to settle.
    await page.waitForTimeout(LIVE_REFRESH_SETTLE_MS);
    await expectSpaceVisibility(5000);
    await expectNoReloadSince(page, live);
    console.log(`[stg0822 live] ${seededSpace.name} navigation became ${visibility} ${elapsedMs}ms after ${live.label}`);
  }
);

When(
  'the owner removes seeded stg0822 {string} from seeded stg0822 {string} via the API',
  async ({ page, request }, accountAliasValue: string, groupAliasValue: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const email = stgAccountEmail(accountAliasValue);
    const uid = await findSeededWorkspaceMemberUid(request, fixture, email);

    // Register the restore before the mutation so a failed live assertion
    // cannot leave the seeded roster short of a member.
    state.restoreGroupMemberships = true;
    await markLiveSession(page, state, `removing ${accountAliasValue} from ${groupAliasValue}`);
    await deleteApi(request, fixture.ownerToken, `${groupMembersApiPath(fixture, groupId)}/${uid}`);
    await expect
      .poll(async () => listGroupMemberEmails(request, fixture, groupId), {
        timeout: 15000,
        message: `expected ${accountAliasValue} to leave ${groupAliasValue}`,
      })
      .not.toContain(email);
  }
);

When(
  'the owner adds seeded stg0822 {string} to seeded stg0822 {string} via the API',
  async ({ page, request }, accountAliasValue: string, groupAliasValue: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const email = stgAccountEmail(accountAliasValue);
    const uid = await findSeededWorkspaceMemberUid(request, fixture, email);

    await markLiveSession(page, state, `adding ${accountAliasValue} to ${groupAliasValue}`);
    await addGroupMember(request, fixture, groupId, uid);
    await expect
      .poll(async () => listGroupMemberEmails(request, fixture, groupId), {
        timeout: 15000,
        message: `expected ${accountAliasValue} to join ${groupAliasValue}`,
      })
      .toContain(email);
  }
);

When(
  'the owner revokes seeded stg0822 {string} from the seeded stg0822 {string} space via the API',
  async ({ page, request }, groupAliasValue: string, spaceAliasValue: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = stgSpace(spaceAliasValue);
    const groupId = stgGroupId(fixture, groupAliasValue);

    if (groupAliasValue === 'group one') {
      state.restoreGroupOneGrant = true;
    }

    await markLiveSession(page, state, `revoking ${groupAliasValue} from ${spaceAliasValue}`);
    await deleteApi(request, fixture.ownerToken, spaceGroupApiPath(fixture.workspaceId, seededSpace.viewId, groupId));
    await expect
      .poll(async () => findSpaceGroupGrant(request, fixture, groupId), {
        timeout: 15000,
        message: `expected the ${groupAliasValue} space grant to be revoked`,
      })
      .toBeUndefined();
  }
);

When(
  'the owner grants seeded stg0822 {string} on the seeded stg0822 {string} space as {string} with {string} via the API',
  async ({ page, request }, groupAliasValue: string, spaceAliasValue: string, role: string, accessLabel: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = stgSpace(spaceAliasValue);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const payload = { role: spaceRoleFromLabel(role), access_level: accessLevelFromLabel(accessLabel) };

    if (groupAliasValue === 'group one') {
      state.restoreGroupOneGrant = true;
    }

    await markLiveSession(page, state, `granting ${groupAliasValue} ${role} / ${accessLabel} on ${spaceAliasValue}`);
    await postApi<SpaceGroupPermission>(
      request,
      fixture.ownerToken,
      spaceGroupApiPath(fixture.workspaceId, seededSpace.viewId, groupId),
      payload
    );
    await expect
      .poll(
        async () => {
          const grant = await findSpaceGroupGrant(request, fixture, groupId);

          return grant ? `${grant.role}:${grant.access_level}` : 'missing';
        },
        { timeout: 15000, message: `expected ${groupAliasValue} to hold role ${role} with ${accessLabel}` }
      )
      .toBe(`${payload.role}:${payload.access_level}`);
  }
);

When(
  'the owner changes the space access of seeded stg0822 {string} on the seeded stg0822 {string} space to {string} via the API',
  async ({ page, request }, groupAliasValue: string, spaceAliasValue: string, accessLabel: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = stgSpace(spaceAliasValue);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const current = await findSpaceGroupGrant(request, fixture, groupId);

    if (!current) {
      throw new Error(`Seeded stg0822 ${groupAliasValue} holds no grant on ${spaceAliasValue}`);
    }

    if (groupAliasValue === 'group one') {
      state.restoreGroupOneGrant = true;
    }

    const payload = { role: current.role, access_level: accessLevelFromLabel(accessLabel) };

    await markLiveSession(page, state, `changing ${groupAliasValue} space access to ${accessLabel}`);
    await patchApi<SpaceGroupPermission>(
      request,
      fixture.ownerToken,
      spaceGroupApiPath(fixture.workspaceId, seededSpace.viewId, groupId),
      payload
    );
    await expect
      .poll(async () => (await findSpaceGroupGrant(request, fixture, groupId))?.access_level, {
        timeout: 15000,
        message: `expected the ${groupAliasValue} space access to become ${accessLabel}`,
      })
      .toBe(payload.access_level);
  }
);

When('I open the seeded stg0822 {string} manage space members tab', async ({ page }, spaceAliasValue: string) => {
  const seededSpace = stgSpace(spaceAliasValue);

  await openManageSpacePanel(page, seededSpace.name);
  await openManageSpaceMembersTab(page);
});

Then(
  'the Manage Space members list shows seeded stg0822 {string} with role {string} and space access {string}',
  async ({ page, request }, groupAliasValue: string, role: string, accessLabel: string) => {
    const fixture = requireFixture(page);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const row = spaceGroupRow(page, groupId);

    // The Manage Space members tab renders a group's role (Space owner / Space
    // member) and its "Group · N members" line; the access level has no UI
    // affordance there, so it is verified through the space group permission
    // API instead.
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(stgGroupName(groupAliasValue), { exact: true }).first()).toBeVisible();
    await expect(row.getByTestId('space-group-subtitle')).toContainText(/^Group · \d+ members?$/);
    await expect(row.getByText(spaceRoleLabel(role), { exact: true }).first()).toBeVisible();

    await expect
      .poll(
        async () => {
          const grant = await findSpaceGroupGrant(request, fixture, groupId);

          return grant ? `${grant.role}:${grant.access_level}` : 'missing';
        },
        { timeout: 15000, message: `expected ${groupAliasValue} to hold role ${role} with ${accessLabel}` }
      )
      .toBe(`${role.toLowerCase()}:${accessLevelFromLabel(accessLabel)}`);
  }
);

When(
  'I change the Manage Space role of seeded stg0822 {string} to {string}',
  async ({ page, request }, groupAliasValue: string, role: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const groupId = stgGroupId(fixture, groupAliasValue);
    const row = spaceGroupRow(page, groupId);
    const roleButton = row.getByRole('button', { name: /^(Space owner|Space member)$/ });

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(roleButton).toBeEnabled({ timeout: 15000 });

    // Register the restore before starting the mutation so a post-commit UI
    // failure cannot leave the canonical fixture grant promoted.
    if (groupAliasValue === 'group one') {
      state.restoreGroupOneGrant = true;
    }

    await roleButton.click();
    await page.getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(spaceRoleLabel(role))}\\b`) }).click();

    // Promoting a group to Space owners asks for confirmation first.
    if (role === 'Owner') {
      await expect(page.getByTestId('manage-space-confirm-dialog')).toContainText('Make this group Space owners?');
      await page.getByTestId('manage-space-confirm-ok').click();
    }

    // The click starts an async mutation. Wait for the server to hold the new
    // role before touching the page again; otherwise navigation can abort the
    // in-flight request.
    await expect
      .poll(async () => (await findSpaceGroupGrant(request, fixture, groupId))?.role, {
        timeout: 15000,
        message: `expected the ${groupAliasValue} space grant to become ${role}`,
      })
      .toBe(role.toLowerCase());

    // The server broadcasts a permission-changed notification while the PATCH
    // is still in flight; the Manage Space panel re-fetches its roster (a 304
    // replays the cached body) and renders the committed role in place.
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(spaceRoleLabel(role), { exact: true }).first()).toBeVisible({ timeout: 15000 });
  }
);

Then(
  'the share panel shows seeded stg0822 {string} with {string}',
  async ({ page }, groupAliasValue: string, accessText: string) => {
    const groupName = stgGroupName(groupAliasValue);
    const row = shareGroupRow(page, groupName);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(groupName, { exact: true })).toBeVisible();
    await expect(row.getByText('Group', { exact: true })).toBeVisible();
    await expect(row.getByText(accessText, { exact: true })).toBeVisible();
  }
);

Then(
  'seeded stg0822 {string} can manage the seeded stg0822 {string}',
  async ({ page, request }, accountAliasValue: string, spaceAliasValue: string) => {
    const seededSpace = stgSpace(spaceAliasValue);
    const fixture = requireFixture(page);
    const groupOneId = stgGroupId(fixture, 'group one');

    await expectCurrentSeededAccount(page, accountAliasValue);

    const token = await getAuthToken(page);

    if (!token) {
      throw new Error(`No auth token found for seeded stg0822 ${accountAliasValue}`);
    }

    const permission = await getApi<SpacePermissionResponsePayload>(
      request,
      token,
      `/api/workspace/${fixture.workspaceId}/spaces/${seededSpace.viewId}/permission`
    );

    expect(permission.can_manage_space, 'an Owner-role group must let its members manage the space').toBe(true);
    expect(permission.current_user_access_level).toBe(ACCESS_LEVEL_FULL_ACCESS);

    await openManageSpacePanel(page, seededSpace.name);
    await openManageSpaceMembersTab(page);

    const row = spaceGroupRow(page, groupOneId);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(spaceRoleLabel('Owner'), { exact: true }).first()).toBeVisible();
  }
);

async function expectSeededPageAccess(page: Page, seededPage: SeededStgPage, access: string, timeout = 30000) {
  const title = page.getByText(seededPage.title, { exact: true });
  const titleInput = PageSelectors.titleInput(page);
  const editor = EditorSelectors.firstEditor(page);

  switch (access) {
    case 'editable':
      await expect(title.first()).toBeVisible({ timeout });
      await expect(titleInput.first()).toBeVisible({ timeout });
      await expect(titleInput.first()).toBeEnabled();
      await expect(editor).toBeVisible({ timeout });
      await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout });
      break;
    case 'read-only':
      await expect(title.first()).toBeVisible({ timeout });
      await expect(titleInput).toHaveCount(0, { timeout });
      await expect(editor).toBeVisible({ timeout });
      await expect(editor).toHaveAttribute('contenteditable', 'false', { timeout });
      await selectFirstEditorWord(page, editor);
      await waitForSelectionEffects(page);
      await expect(page.getByTestId('inline-comment-readonly-trigger')).toBeVisible();
      await expect(page.getByTestId('inline-comment-readonly-trigger').getByRole('button')).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      break;
    case 'denied':
      await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout });
      await expect(title).toHaveCount(0);
      await expect(titleInput).toHaveCount(0);
      break;
    default:
      throw new Error(`Unsupported seeded stg0822 page access expectation: ${access}`);
  }
}

// Stamp the open page right before an owner API mutation: a reload would
// recreate `window` and lose the marker, a navigation would change the URL.
async function markLiveSession(page: Page, state: ScenarioState, label: string) {
  const marker = `stg0822-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await page.evaluate((value) => {
    (window as LiveMarkerWindow).__stg0822LiveMarker = value;
  }, marker);
  state.liveSession = { label, url: page.url(), marker, mutatedAt: Date.now() };
}

async function expectNoReloadSince(page: Page, live: LiveSession) {
  expect(page.url(), `the page must not navigate while ${live.label} refreshes it live`).toBe(live.url);

  const marker = await page.evaluate(() => (window as LiveMarkerWindow).__stg0822LiveMarker);

  expect(marker, `the page must not reload while ${live.label} refreshes it live`).toBe(live.marker);
}

function requireLiveSession(page: Page): LiveSession {
  const live = requireState(page).liveSession;

  if (!live) {
    throw new Error('No owner API mutation has been issued against the open seeded stg0822 page');
  }

  return live;
}

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

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Seeded space group permission scenario state has not been initialized');
  }

  return state;
}

function requireFixture(page: Page): FixtureContext {
  const fixture = requireState(page).fixture;

  if (!fixture) {
    throw new Error('The seeded stg0822 fixture context has not been resolved for this scenario');
  }

  return fixture;
}

function requireCurrentSeededPage(page: Page): SeededStgPage {
  const seededPage = requireState(page).currentSeededPage;

  if (!seededPage) {
    throw new Error('No seeded stg0822 page has been opened directly');
  }

  return seededPage;
}

function manageSpaceModal(page: Page) {
  return page.getByTestId('manage-space-modal');
}

function spaceGroupRow(page: Page, groupId: string) {
  return manageSpaceModal(page).getByTestId(`space-group-row-${groupId}`);
}

function shareGroupRow(page: Page, groupName: string) {
  return ShareSelectors.sharePopover(page).locator('.group').filter({ hasText: groupName }).first();
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

async function resolveFixtureContext(request: APIRequestContext): Promise<FixtureContext> {
  const ownerToken = await signInSeededOwnerViaApi(request);
  const workspaceId = await findSeededWorkspaceId(request, ownerToken);
  const groups = await getApi<WorkspaceGroupsPayload>(request, ownerToken, `/api/workspace/${workspaceId}/groups`);
  const groupIds = {} as Record<StgGroupAlias, string>;

  for (const alias of Object.keys(STG_GROUPS) as StgGroupAlias[]) {
    const group = groups.groups.find((candidate) => candidate.name === STG_GROUPS[alias]);

    if (!group) {
      throw new Error(
        `Seeded workspace group "${STG_GROUPS[alias]}" not found; run the stg0822 seed (see the Given step)`
      );
    }

    groupIds[alias] = group.group_id;
  }

  return { ownerToken, workspaceId, groupIds };
}

// The seeded owner's workspace is the one that hosts Group Space A. Prefer the
// workspaces the owner owns and confirm the seeded space answers there.
async function findSeededWorkspaceId(request: APIRequestContext, ownerToken: string): Promise<string> {
  const payload = await getApi<UserWorkspaceInfoPayload>(request, ownerToken, '/api/user/workspace');
  const candidates = [
    ...(payload.workspaces || []).filter(
      (workspace) =>
        workspace.role === 'Owner' && workspace.owner_email?.toLowerCase() === STG_ACCOUNTS.owner.toLowerCase()
    ),
    ...(payload.visiting_workspace ? [payload.visiting_workspace] : []),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const workspaceId = candidate.workspace_id;

    if (!workspaceId || seen.has(workspaceId)) continue;
    seen.add(workspaceId);

    const hostsSeededSpace = await getApi<SpaceGroupPermissionsPayload>(
      request,
      ownerToken,
      spaceGroupApiPath(workspaceId, STG_SPACES['group space A'].viewId)
    )
      .then(() => true)
      .catch(() => false);

    if (hostsSeededSpace) return workspaceId;
  }

  throw new Error(
    `No workspace of ${STG_ACCOUNTS.owner} hosts the seeded stg0822 space; run the seed (see the Given step)`
  );
}

async function ensureSeededGroupOneGrant(request: APIRequestContext, fixture: FixtureContext) {
  const groupId = fixture.groupIds['group one'];
  const spaceId = STG_SPACES['group space A'].viewId;
  const current = await findSpaceGroupGrant(request, fixture, groupId);
  const payload = { role: SEEDED_GROUP_ONE_ROLE, access_level: SEEDED_GROUP_ONE_ACCESS };

  if (!current) {
    await postApi<SpaceGroupPermission>(
      request,
      fixture.ownerToken,
      spaceGroupApiPath(fixture.workspaceId, spaceId, groupId),
      payload
    );
  } else if (current.role !== SEEDED_GROUP_ONE_ROLE || current.access_level !== SEEDED_GROUP_ONE_ACCESS) {
    await patchApi<SpaceGroupPermission>(
      request,
      fixture.ownerToken,
      spaceGroupApiPath(fixture.workspaceId, spaceId, groupId),
      payload
    );
  }

  const restored = await findSpaceGroupGrant(request, fixture, groupId);

  if (!restored || restored.role !== SEEDED_GROUP_ONE_ROLE || restored.access_level !== SEEDED_GROUP_ONE_ACCESS) {
    throw new Error(
      `Seeded stg0822 group One grant is not Member / Can view after restore: ${JSON.stringify(restored)}`
    );
  }

  const pageShare = await findViewGroupGrant(
    request,
    fixture,
    STG_PAGES['group page A'].viewId,
    fixture.groupIds['group two']
  );

  if (!pageShare || pageShare.access_level !== SEEDED_GROUP_TWO_PAGE_ACCESS) {
    throw new Error(
      `Seeded stg0822 group Two page share on Group Page A is not Can edit; run the seed (see the Given step): ${JSON.stringify(
        pageShare
      )}`
    );
  }
}

async function findSpaceGroupGrant(
  request: APIRequestContext,
  fixture: FixtureContext,
  groupId: string
): Promise<SpaceGroupPermission | undefined> {
  const payload = await getApi<SpaceGroupPermissionsPayload>(
    request,
    fixture.ownerToken,
    spaceGroupApiPath(fixture.workspaceId, STG_SPACES['group space A'].viewId)
  );

  return payload.groups.find((group) => group.group_id === groupId);
}

async function findViewGroupGrant(
  request: APIRequestContext,
  fixture: FixtureContext,
  viewId: string,
  groupId: string
): Promise<ViewGroupPermission | undefined> {
  const payload = await getApi<ViewGroupPermissionsPayload>(
    request,
    fixture.ownerToken,
    `/api/workspace/${fixture.workspaceId}/views/${viewId}/group`
  );

  return payload.groups.find((group) => group.group_id === groupId);
}

// Re-add any seeded group member that a live-refresh scenario removed. Members
// that are already present are left untouched, so this is safe to run eagerly.
async function ensureSeededGroupMemberships(request: APIRequestContext, fixture: FixtureContext) {
  for (const alias of Object.keys(SEEDED_GROUP_MEMBERSHIPS) as StgGroupAlias[]) {
    const groupId = fixture.groupIds[alias];
    const emails = await listGroupMemberEmails(request, fixture, groupId);

    for (const accountAlias of SEEDED_GROUP_MEMBERSHIPS[alias]) {
      const email = STG_ACCOUNTS[accountAlias];

      if (emails.includes(email)) continue;

      const uid = await findSeededWorkspaceMemberUid(request, fixture, email);

      await addGroupMember(request, fixture, groupId, uid);
    }

    const restored = await listGroupMemberEmails(request, fixture, groupId);
    const missing = SEEDED_GROUP_MEMBERSHIPS[alias].filter(
      (accountAlias) => !restored.includes(STG_ACCOUNTS[accountAlias])
    );

    if (missing.length > 0) {
      throw new Error(
        `Seeded stg0822 ${alias} is still missing ${missing.join(', ')} after restore: ${restored.join(', ')}`
      );
    }
  }
}

async function listGroupMemberEmails(
  request: APIRequestContext,
  fixture: FixtureContext,
  groupId: string
): Promise<string[]> {
  const payload = await getApiPreservingUid<WorkspaceGroupMembersPayload>(
    request,
    fixture.ownerToken,
    groupMembersApiPath(fixture, groupId)
  );

  return payload.members.map((member) => member.email.toLowerCase());
}

async function addGroupMember(request: APIRequestContext, fixture: FixtureContext, groupId: string, uid: string) {
  if (!/^\d+$/.test(uid)) {
    throw new Error(`Workspace group member UID must be numeric, got: ${uid}`);
  }

  // Send the uid as a raw JSON number: it is larger than Number.MAX_SAFE_INTEGER,
  // so a JS number literal would round it to a different user.
  await postRawApi<void>(request, fixture.ownerToken, groupMembersApiPath(fixture, groupId), `{"uid":${uid}}`);
}

// Resolve a seeded account's uid through the owner's workspace member list.
async function findSeededWorkspaceMemberUid(
  request: APIRequestContext,
  fixture: FixtureContext,
  email: string
): Promise<string> {
  const members = await getApiPreservingUid<WorkspaceMember[]>(
    request,
    fixture.ownerToken,
    `/api/workspace/${fixture.workspaceId}/member?include_pending=true`
  );
  const member = members.find((workspaceMember) => workspaceMember.email.toLowerCase() === email.toLowerCase());

  if (member?.uid === undefined || member.uid === null) {
    throw new Error(`Seeded stg0822 workspace member uid not found for ${email}`);
  }

  return String(member.uid);
}

function groupMembersApiPath(fixture: FixtureContext, groupId: string): string {
  return `/api/workspace/${fixture.workspaceId}/groups/${groupId}/members`;
}

function spaceGroupApiPath(workspaceId: string, spaceId: string, groupId?: string): string {
  const base = `/api/workspace/${workspaceId}/spaces/${spaceId}/group`;

  return groupId ? `${base}/${groupId}` : base;
}

async function signInSeededOwnerViaApi(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      email: STG_ACCOUNTS.owner,
      password: PASSWORD,
    },
    failOnStatusCode: false,
  });
  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Could not authenticate the seeded stg0822 owner: HTTP ${response.status()} ${text}`);
  }

  const token = (parseJson(text) as { access_token?: string } | null)?.access_token;

  if (!token) {
    throw new Error(`Seeded stg0822 owner sign-in response has no access token: ${text}`);
  }

  return token;
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

  return body.data as T;
}

async function deleteApi(request: APIRequestContext, token: string, path: string): Promise<void> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = parseApiResponse<void>(text);

  if (response.ok() && (!text || body?.code === 0)) return;

  throw new Error(`API DELETE failed for ${path}: HTTP ${response.status()} ${text}`);
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
  const body = parseApiResponse<T>(text);

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
  const body = parseApiResponse<T>(text);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API PATCH failed for ${path}: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

function parseApiResponse<T>(text: string, preserveUid = false): ApiResponse<T> | null {
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

async function signInSeededStgAccount(page: Page, accountAliasValue: string) {
  const expectedEmail = stgAccountEmail(accountAliasValue);

  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, expectedEmail, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect
    .poll(() => currentSessionEmail(page), {
      message: `expected seeded login to use ${expectedEmail}`,
      timeout: 10000,
    })
    .toBe(expectedEmail);
}

async function expectCurrentSeededAccount(page: Page, accountAliasValue: string) {
  const expectedEmail = stgAccountEmail(accountAliasValue);

  await expect
    .poll(() => currentSessionEmail(page), {
      message: `expected the current seeded session to use ${expectedEmail}`,
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

function stgAccountEmail(accountAliasValue: string): string {
  const alias = accountAliasValue as StgAccountAlias;
  const email = STG_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown stg0822 account alias: ${accountAliasValue}`);
  }

  return email;
}

function stgGroupName(groupAliasValue: string): string {
  const alias = groupAliasValue as StgGroupAlias;
  const name = STG_GROUPS[alias];

  if (!name) {
    throw new Error(`Unknown stg0822 group alias: ${groupAliasValue}`);
  }

  return name;
}

function stgGroupId(fixture: FixtureContext, groupAliasValue: string): string {
  const alias = groupAliasValue as StgGroupAlias;
  const groupId = fixture.groupIds[alias];

  if (!groupId) {
    throw new Error(`Unknown stg0822 group alias: ${groupAliasValue}`);
  }

  return groupId;
}

function stgSpace(spaceAliasValue: string) {
  const alias = spaceAliasValue as StgSpaceAlias;
  const space = STG_SPACES[alias];

  if (!space) {
    throw new Error(`Unknown stg0822 space alias: ${spaceAliasValue}`);
  }

  return space;
}

function stgPage(pageAliasValue: string) {
  const alias = pageAliasValue as StgPageAlias;
  const page = STG_PAGES[alias];

  if (!page) {
    throw new Error(`Unknown stg0822 page alias: ${pageAliasValue}`);
  }

  return page;
}

function accessLevelFromLabel(label: string): number {
  switch (label) {
    case 'Can view':
      return ACCESS_LEVEL_READ_ONLY;
    case 'Can edit':
      return ACCESS_LEVEL_READ_AND_WRITE;
    case 'Full access':
      return ACCESS_LEVEL_FULL_ACCESS;
    default:
      throw new Error(`Unsupported space access label: ${label}`);
  }
}

// The Members tab uses the PRD's explicit role terminology.
function spaceRoleLabel(role: string): string {
  switch (role) {
    case 'Owner':
      return 'Space owner';
    case 'Member':
      return 'Space member';
    default:
      throw new Error(`Unsupported space role: ${role}`);
  }
}

function spaceRoleFromLabel(label: string): string {
  switch (label) {
    case 'Member':
      return SPACE_MEMBER_ROLE_MEMBER;
    case 'Owner':
      return 'owner';
    default:
      throw new Error(`Unsupported space role label: ${label}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
