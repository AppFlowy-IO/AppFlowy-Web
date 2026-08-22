import { APIRequestContext, expect, Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { EditorSelectors, PageSelectors, SpaceSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORD = 'AppFlowy!@123';
const ACCESS_LEVEL_READ_ONLY = 10;
const ACCESS_LEVEL_READ_AND_WRITE = 30;
const ACCESS_LEVEL_FULL_ACCESS = 50;
// Workspace member uids exceed Number.MAX_SAFE_INTEGER; keep them as strings
// when they travel through JSON so member calls address the right user.
const UID_FIELD_REGEX = /"uid"\s*:\s*(\d{16,})/g;
// A server-pushed permission change has to reach the open page over the
// WebSocket and trigger a re-probe; allow generous time before calling it a gap.
const LIVE_REFRESH_TIMEOUT_MS = 60000;
// The app drops to a safe state the moment the push arrives and only then
// re-probes the server. Hold the observed verdict past that window so a
// transient state cannot satisfy it.
const LIVE_REFRESH_SETTLE_MS = 5000;

const SCP_ACCOUNTS = {
  owner: 'scp0822-own@appflowy.local',
  member: 'scp0822-member@appflowy.local',
  editor: 'scp0822-editor@appflowy.local',
  outsider: 'scp0822-outsider@appflowy.local',
} as const;

const SCP_EDITORS_GROUP_NAME = 'scp0822 Editors';

const SCP_SPACES = {
  'public space': {
    viewId: '5a1c2d3e-4f60-4718-8a9b-0c1d2e3f4a50',
    name: 'scp0822 Public Space',
    seededVisibility: 'public',
  },
  'private space': {
    viewId: '7c3e4f50-6182-493a-abcd-2e3f4a5b6c72',
    name: 'scp0822 Private Space',
    seededVisibility: 'private',
  },
  'custom space': {
    viewId: '9e506172-83a4-4b5c-8def-4a5b6c7d8e94',
    name: 'scp0822 Custom Space',
    seededVisibility: 'custom',
  },
} as const;

const SCP_PAGES = {
  'public page': {
    viewId: '6b2d3e4f-5071-4829-9bac-1d2e3f4a5b61',
    title: 'scp0822 Public Page',
  },
  'private page': {
    viewId: '8d4f5061-7293-4a4b-bcde-3f4a5b6c7d83',
    title: 'scp0822 Private Page',
  },
  'custom page': {
    viewId: 'af617283-94b5-4c6d-9ef0-5b6c7d8e9fa5',
    title: 'scp0822 Custom Page',
  },
} as const;

type ScpAccountAlias = keyof typeof SCP_ACCOUNTS;
type ScpSpaceAlias = keyof typeof SCP_SPACES;
type ScpPageAlias = keyof typeof SCP_PAGES;
type SeededScpSpace = (typeof SCP_SPACES)[ScpSpaceAlias];
type SeededScpPage = (typeof SCP_PAGES)[ScpPageAlias];

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type WorkspaceSummary = {
  workspace_id?: string;
  workspace_name?: string;
  owner_email?: string;
  role?: string;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace?: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
};

type SpacePermissionSettingsPayload = {
  visibility: string;
  owner_access_level: number;
  member_default_access_level: number | null;
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
  current_user_access_level?: number | null;
  can_manage_space?: boolean;
};

type SpaceMemberPayload = {
  uid: string | number;
  email?: string | null;
  role: string;
  access_level: number;
  source: string;
  workspace_role?: string;
};

type SpaceGroupPermissionPayload = {
  group_id: string;
  name: string;
  role: string;
  access_level: number;
  member_count: number;
};

type SpaceMembersPayload = {
  members: SpaceMemberPayload[];
  groups?: SpaceGroupPermissionPayload[];
};

type SpaceGroupPermissionsPayload = {
  groups: SpaceGroupPermissionPayload[];
};

type WorkspaceGroupsPayload = {
  groups: { group_id: string; name: string; member_count: number }[];
};

type WorkspaceMemberPayload = {
  uid?: string | number;
  email: string;
};

// Fixture context resolved through the owner's API token (never hardcoded).
type FixtureContext = {
  ownerToken: string;
  workspaceId: string;
  workspaceName: string;
  editorsGroupId: string;
  uids: Record<ScpAccountAlias, string>;
};

// Snapshot of the open browser page taken right before an owner API mutation.
// A live refresh must keep the URL and the in-memory marker intact: a reload
// recreates `window`, a navigation changes the URL.
type LiveSession = {
  label: string;
  url: string;
  marker: string;
  mutatedAt: number;
};

type LiveMarkerWindow = Window & { __scp0822LiveMarker?: string };

type ScenarioState = {
  fixture?: FixtureContext;
  currentSeededPage?: SeededScpPage;
  liveSession?: LiveSession;
};

const stateByPage = new WeakMap<Page, ScenarioState>();

// The deterministic seeded shape every scenario starts from and returns to.
const SEEDED_SECURITY = { disable_guests: false, disable_public_links: false, disable_export: false };

function seededSettings(visibility: 'public' | 'private' | 'custom'): SpacePermissionSettingsPayload {
  return {
    visibility,
    owner_access_level: ACCESS_LEVEL_FULL_ACCESS,
    member_default_access_level: ACCESS_LEVEL_READ_AND_WRITE,
    everyone_else_access_level: visibility === 'custom' ? ACCESS_LEVEL_READ_ONLY : null,
    invite_policy: 'owners_only',
    sidebar_edit_policy: 'owners_only',
    invite_link_enabled: false,
    security: { ...SEEDED_SECURITY },
  };
}

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {});
});

// Every scenario may have switched a space type, changed a collective level
// or edited the roster; always put the seeded shape back so reruns and the
// other scenarios are deterministic. Re-authenticate through the API: the
// browser session may belong to another seeded account by now.
After(async ({ request }) => {
  const fixture = await resolveFixtureContext(request);

  await restoreSeededShape(request, fixture);
});

Given('the seeded scp0822 space permission fixture exists', async ({ page, request }) => {
  // Seed with (server repo):
  // cargo test --test space_custom_permission_seed seed_space_custom_permission_suite -- --ignored --nocapture
  const fixture = await resolveFixtureContext(request);

  await restoreSeededShape(request, fixture);
  requireState(page).fixture = fixture;
});

Given('I sign in as seeded scp0822 {string}', async ({ page }, accountAliasValue: string) => {
  const expectedEmail = scpAccountEmail(accountAliasValue);

  await resetBrowserSession(page);
  await signInWithPasswordViaUi(page, expectedEmail, PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await expect
    .poll(() => currentSessionEmail(page), {
      message: `expected seeded login to use ${expectedEmail}`,
      timeout: 10000,
    })
    .toBe(expectedEmail);
});

When('I open the seeded scp0822 workspace', async ({ page }) => {
  const { workspaceId } = requireFixture(page);
  const pathname = `/app/${workspaceId}`;

  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toContain(pathname);
  await waitForResolvedFolderOutline(page);
});

When('I directly open the seeded scp0822 {string}', async ({ page }, pageAliasValue: string) => {
  const seededPage = scpPage(pageAliasValue);
  const { workspaceId } = requireFixture(page);
  const pathname = `/app/${workspaceId}/${seededPage.viewId}`;

  requireState(page).currentSeededPage = seededPage;
  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30000 }).toBe(pathname);
});

Then('the directly opened seeded scp0822 page is {string}', async ({ page }, access: string) => {
  await expectSeededPageAccess(page, requireCurrentSeededPage(page), access);
});

Then(
  'the seeded scp0822 {string} space navigation is {string}',
  async ({ page }, spaceAliasValue: string, visibility: string) => {
    const seededSpace = scpSpace(spaceAliasValue);
    const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);

    await waitForResolvedFolderOutline(page);
    await expectSpaceNavigation(page, spaceItem, visibility, 30000);
  }
);

When('I open the seeded scp0822 {string} manage space panel', async ({ page }, spaceAliasValue: string) => {
  const seededSpace = scpSpace(spaceAliasValue);
  const { workspaceId } = requireFixture(page);

  // Start from the workspace root so the sidebar lists the space regardless of
  // which page (or which workspace) the session was on.
  await page.goto(`/app/${workspaceId}`, { waitUntil: 'domcontentloaded' });
  await waitForResolvedFolderOutline(page);
  await openManageSpacePanel(page, seededSpace.name);
});

When('I open the seeded scp0822 {string} manage space members tab', async ({ page }, spaceAliasValue: string) => {
  const seededSpace = scpSpace(spaceAliasValue);
  const { workspaceId } = requireFixture(page);

  await page.goto(`/app/${workspaceId}`, { waitUntil: 'domcontentloaded' });
  await waitForResolvedFolderOutline(page);
  await openManageSpacePanel(page, seededSpace.name);
  await openManageSpaceMembersTab(page);
});

When('I open the Manage Space members tab of the open panel', async ({ page }) => {
  await openManageSpaceMembersTab(page);
});

Then('the Manage Space general tab shows the Public access card', async ({ page }) => {
  const card = manageSpaceModal(page).getByTestId('manage-space-public-access-card');

  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.getByText('Public access', { exact: true })).toBeVisible();
  await expect(
    card.getByText('This space is public. Everyone in the workspace can access with the permissions below.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(card.getByText('Who', { exact: true })).toBeVisible();
  await expect(card.getByText('Access', { exact: true })).toBeVisible();
  await expect(card.getByText('Need different access levels?', { exact: true })).toBeVisible();
  await expect(
    card.getByText(
      'Switch to a Custom space to give specific people or groups edit access, while others can view.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(card.getByTestId('manage-space-switch-to-custom')).toHaveText('Switch to Custom');
  await expect(manageSpaceModal(page).getByTestId('manage-space-custom-permissions-card')).toHaveCount(0);
});

Then('the Manage Space general tab shows the Custom permissions card', async ({ page }) => {
  const card = manageSpaceModal(page).getByTestId('manage-space-custom-permissions-card');

  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.getByText('Custom permissions', { exact: true })).toBeVisible();
  await expect(
    card.getByText('Choose the default access for space members and everyone else in the workspace.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(manageSpaceModal(page).getByTestId('manage-space-public-access-card')).toHaveCount(0);
});

Then(
  'the Public access card lists {string} with {string} and {string}',
  async ({ page }, title: string, description: string, accessLabel: string) => {
    const card = manageSpaceModal(page).getByTestId('manage-space-public-access-card');
    const row =
      title === 'Workspace owners'
        ? card.getByTestId('manage-space-workspace-owners-row')
        : card.getByTestId('manage-space-workspace-members-row');

    await expectPrincipalRow(row, title, description, accessLabel);
  }
);

Then(
  'the Custom permissions card lists {string} with {string} and {string}',
  async ({ page }, title: string, description: string, accessLabel: string) => {
    const card = manageSpaceModal(page).getByTestId('manage-space-custom-permissions-card');
    const row =
      title === 'Space owners'
        ? card.getByTestId('manage-space-custom-owners-row')
        : card.getByTestId('manage-space-custom-members-row');

    await expectPrincipalRow(row, title, description, accessLabel);
  }
);

Then(
  'the Custom permissions card lists everyone else in the workspace with {string} and {string}',
  async ({ page }, description: string, accessLabel: string) => {
    const { workspaceName } = requireFixture(page);
    const row = manageSpaceModal(page).getByTestId('manage-space-everyone-else-row');

    await expectPrincipalRow(row, `Everyone else in ${workspaceName}`, description, accessLabel);
  }
);

Then(
  'the Custom permissions card shows Space members {string} and everyone else {string}',
  async ({ page }, membersLabel: string, everyoneElseLabel: string) => {
    await expectCustomLevels(page, membersLabel, everyoneElseLabel, 15000);
  }
);

Then(
  'the Custom permissions card shows Space members {string} and everyone else {string} without reload',
  async ({ page }, membersLabel: string, everyoneElseLabel: string) => {
    const live = requireLiveSession(page);

    await expectCustomLevels(page, membersLabel, everyoneElseLabel, LIVE_REFRESH_TIMEOUT_MS);

    const elapsedMs = Date.now() - live.mutatedAt;

    await page.waitForTimeout(LIVE_REFRESH_SETTLE_MS);
    await expectCustomLevels(page, membersLabel, everyoneElseLabel, 5000);
    await expectNoReloadSince(page, live);
    console.log(`[scp0822 live] Manage Space showed ${membersLabel} / ${everyoneElseLabel} ${elapsedMs}ms after ${live.label}`);
  }
);

When('I set the Public access workspace members level to {string}', async ({ page }, accessLabel: string) => {
  await chooseAccessLevel(page, 'manage-space-workspace-members-access', accessLabel);
});

When('I set the Custom permissions space members level to {string}', async ({ page }, accessLabel: string) => {
  await chooseAccessLevel(page, 'manage-space-custom-members-access', accessLabel);
});

When('I set the Custom permissions everyone else level to {string}', async ({ page }, accessLabel: string) => {
  await chooseAccessLevel(page, 'manage-space-everyone-else-access', accessLabel);
});

When('I click Switch to Custom in the Public access card', async ({ page }) => {
  await manageSpaceModal(page).getByTestId('manage-space-switch-to-custom').click();
});

When('I choose the {string} space access card', async ({ page }, visibilityLabel: string) => {
  const visibility = visibilityFromLabel(visibilityLabel);
  const option = manageSpaceModal(page).getByTestId(`manage-space-visibility-option-${visibility}`);

  await expect(option).toBeEnabled({ timeout: 15000 });
  await option.click();
});

Then(
  'the Manage Space confirmation asks {string} with the action {string}',
  async ({ page }, title: string, action: string) => {
    const dialog = page.getByTestId('manage-space-confirm-dialog');

    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByTestId('manage-space-confirm-ok')).toHaveText(action);
  }
);

Then('the Manage Space confirmation explains {string}', async ({ page }, description: string) => {
  await expect(page.getByTestId('manage-space-confirm-description')).toHaveText(description);
});

When('I confirm the Manage Space dialog', async ({ page }) => {
  await page.getByTestId('manage-space-confirm-ok').click();
  await expect(page.getByTestId('manage-space-confirm-dialog')).toHaveCount(0, { timeout: 15000 });
});

When('I save the Manage Space panel', async ({ page }) => {
  const modal = manageSpaceModal(page);
  const save = modal.getByTestId('modal-ok-button');

  await expect(save).toBeEnabled({ timeout: 15000 });
  await save.click();
  // A successful save closes the panel; a failure keeps it open with a toast.
  await expect(modal).toHaveCount(0, { timeout: 20000 });
});

Then(
  'the Manage Space members list shows seeded scp0822 {string} as {string} with the subtitle {string}',
  async ({ page }, accountAliasValue: string, roleLabel: string, subtitle: string) => {
    const fixture = requireFixture(page);
    const row = spaceMemberRow(page, scpUid(fixture, accountAliasValue));

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(roleLabel, { exact: true }).first()).toBeVisible();
    await expect(row.getByTestId('space-member-subtitle')).toContainText(subtitle);
    // The email shows on the name line (no display name) or in the subtitle.
    await expect(row).toContainText(scpAccountEmail(accountAliasValue));
  }
);

Then(
  'the Manage Space members list does not show seeded scp0822 {string}',
  async ({ page }, accountAliasValue: string) => {
    const fixture = requireFixture(page);

    await expect(spaceMemberRow(page, scpUid(fixture, accountAliasValue))).toHaveCount(0, { timeout: 15000 });
  }
);

Then(
  'the Manage Space members list shows the seeded scp0822 Editors group as {string} with {string}',
  async ({ page }, roleLabel: string, memberCount: string) => {
    const fixture = requireFixture(page);
    const row = manageSpaceModal(page).getByTestId(`space-group-row-${fixture.editorsGroupId}`);

    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(SCP_EDITORS_GROUP_NAME, { exact: true })).toBeVisible();
    await expect(row.getByTestId('space-group-subtitle')).toHaveText(`Group · ${memberCount}`);
    await expect(row.getByText(roleLabel, { exact: true }).first()).toBeVisible();
  }
);

When('I remove seeded scp0822 {string} from the Manage Space members list', async ({ page }, accountAliasValue: string) => {
  const fixture = requireFixture(page);
  const row = spaceMemberRow(page, scpUid(fixture, accountAliasValue));
  const roleButton = row.getByRole('button', { name: /^(Space owner|Space member)$/ });

  await expect(roleButton).toBeEnabled({ timeout: 15000 });
  await roleButton.click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
});

Then(
  'the seeded scp0822 {string} is {string} via the API',
  async ({ page, request }, spaceAliasValue: string, visibility: string) => {
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);

    await expect
      .poll(async () => (await getSpacePermission(request, fixture, seededSpace.viewId)).permission.visibility, {
        timeout: 15000,
        message: `expected ${spaceAliasValue} to be ${visibility}`,
      })
      .toBe(visibility);
  }
);

Then(
  'the seeded scp0822 {string} members level is {string} via the API',
  async ({ page, request }, spaceAliasValue: string, accessLabel: string) => {
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);

    await expect
      .poll(
        async () => (await getSpacePermission(request, fixture, seededSpace.viewId)).permission.member_default_access_level,
        { timeout: 15000, message: `expected ${spaceAliasValue} members to be ${accessLabel}` }
      )
      .toBe(accessLevelFromLabel(accessLabel));
  }
);

Then(
  'the seeded scp0822 {string} everyone else level is {string} via the API',
  async ({ page, request }, spaceAliasValue: string, accessLabel: string) => {
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);

    await expect
      .poll(
        async () =>
          (await getSpacePermission(request, fixture, seededSpace.viewId)).permission.everyone_else_access_level ?? null,
        { timeout: 15000, message: `expected ${spaceAliasValue} everyone else to be ${accessLabel}` }
      )
      .toBe(accessLevelFromLabel(accessLabel));
  }
);

Then(
  'the seeded scp0822 {string} roster does not list seeded scp0822 {string} via the API',
  async ({ page, request }, spaceAliasValue: string, accountAliasValue: string) => {
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);
    const uid = scpUid(fixture, accountAliasValue);

    await expect
      .poll(
        async () =>
          (await listSpaceMembers(request, fixture, seededSpace.viewId)).members.some(
            (member) => String(member.uid) === uid
          ),
        { timeout: 15000, message: `expected ${accountAliasValue} to leave the ${spaceAliasValue} roster` }
      )
      .toBe(false);
  }
);

When(
  'the owner sets the seeded scp0822 {string} members level to {string} via the API',
  async ({ page, request }, spaceAliasValue: string, accessLabel: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);
    const current = (await getSpacePermission(request, fixture, seededSpace.viewId)).permission;

    await markLiveSession(page, state, `setting ${spaceAliasValue} members to ${accessLabel}`);
    await updateSpacePermission(request, fixture, seededSpace.viewId, {
      ...current,
      member_default_access_level: accessLevelFromLabel(accessLabel),
    });
  }
);

When(
  'the owner sets the seeded scp0822 {string} everyone else level to {string} via the API',
  async ({ page, request }, spaceAliasValue: string, accessLabel: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);
    const current = (await getSpacePermission(request, fixture, seededSpace.viewId)).permission;

    await markLiveSession(page, state, `setting ${spaceAliasValue} everyone else to ${accessLabel}`);
    await updateSpacePermission(request, fixture, seededSpace.viewId, {
      ...current,
      everyone_else_access_level: accessLevelFromLabel(accessLabel),
    });
  }
);

When(
  'the owner switches the seeded scp0822 {string} to {string} via the API',
  async ({ page, request }, spaceAliasValue: string, visibility: string) => {
    const state = requireState(page);
    const fixture = requireFixture(page);
    const seededSpace = scpSpace(spaceAliasValue);
    const current = (await getSpacePermission(request, fixture, seededSpace.viewId)).permission;

    await markLiveSession(page, state, `switching ${spaceAliasValue} to ${visibility}`);
    await updateSpacePermission(request, fixture, seededSpace.viewId, {
      ...current,
      visibility,
      member_default_access_level: current.member_default_access_level ?? ACCESS_LEVEL_READ_AND_WRITE,
      everyone_else_access_level: visibility === 'custom' ? (current.everyone_else_access_level ?? null) : null,
    });
  }
);

// The page stays open while the owner mutates permissions over the API; the
// server's permission-changed push must flip the rendered access in place.
Then('the open seeded scp0822 page becomes {string} without reload', async ({ page }, access: string) => {
  const seededPage = requireCurrentSeededPage(page);
  const live = requireLiveSession(page);

  await expectSeededPageAccess(page, seededPage, access, LIVE_REFRESH_TIMEOUT_MS);

  const elapsedMs = Date.now() - live.mutatedAt;

  await page.waitForTimeout(LIVE_REFRESH_SETTLE_MS);
  await expectSeededPageAccess(page, seededPage, access, 5000);
  await expectNoReloadSince(page, live);
  console.log(`[scp0822 live] ${seededPage.title} became ${access} ${elapsedMs}ms after ${live.label}`);
});

Then(
  'the seeded scp0822 {string} space navigation becomes {string} without reload',
  async ({ page }, spaceAliasValue: string, visibility: string) => {
    const seededSpace = scpSpace(spaceAliasValue);
    const live = requireLiveSession(page);
    const spaceItem = SpaceSelectors.itemByName(page, seededSpace.name);

    await expectSpaceNavigation(page, spaceItem, visibility, LIVE_REFRESH_TIMEOUT_MS);

    const elapsedMs = Date.now() - live.mutatedAt;

    await page.waitForTimeout(LIVE_REFRESH_SETTLE_MS);
    await expectSpaceNavigation(page, spaceItem, visibility, 5000);
    await expectNoReloadSince(page, live);
    console.log(`[scp0822 live] ${seededSpace.name} navigation became ${visibility} ${elapsedMs}ms after ${live.label}`);
  }
);

async function expectPrincipalRow(row: Locator, title: string, description: string, accessLabel: string) {
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText(title, { exact: true })).toBeVisible();
  await expect(row.getByText(description, { exact: true })).toBeVisible();
  await expect(row.getByText(accessLabel, { exact: true }).first()).toBeVisible();
}

async function expectCustomLevels(page: Page, membersLabel: string, everyoneElseLabel: string, timeout: number) {
  const modal = manageSpaceModal(page);

  await expect(modal.getByTestId('manage-space-custom-members-access')).toHaveText(membersLabel, { timeout });
  await expect(modal.getByTestId('manage-space-everyone-else-access')).toHaveText(everyoneElseLabel, { timeout });
}

async function chooseAccessLevel(page: Page, triggerTestId: string, accessLabel: string) {
  const trigger = manageSpaceModal(page).getByTestId(triggerTestId);
  const level = accessLevelFromLabel(accessLabel);

  await expect(trigger).toBeEnabled({ timeout: 15000 });
  await trigger.click();
  await page.getByTestId(`${triggerTestId}-option-${level ?? 'none'}`).click();
  await expect(trigger).toHaveText(accessLabel, { timeout: 15000 });
}

async function expectSpaceNavigation(page: Page, spaceItem: Locator, visibility: string, timeout: number) {
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
      throw new Error(`Unsupported seeded scp0822 space navigation visibility: ${visibility}`);
  }
}

async function expectSeededPageAccess(page: Page, seededPage: SeededScpPage, access: string, timeout = 30000) {
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
      break;
    case 'denied':
      await expect(page.getByText('No access to this page', { exact: true }).first()).toBeVisible({ timeout });
      await expect(title).toHaveCount(0);
      await expect(titleInput).toHaveCount(0);
      break;
    default:
      throw new Error(`Unsupported seeded scp0822 page access expectation: ${access}`);
  }
}

// Stamp the open page right before an owner API mutation: a reload would
// recreate `window` and lose the marker, a navigation would change the URL.
async function markLiveSession(page: Page, state: ScenarioState, label: string) {
  const marker = `scp0822-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await page.evaluate((value) => {
    (window as LiveMarkerWindow).__scp0822LiveMarker = value;
  }, marker);
  state.liveSession = { label, url: page.url(), marker, mutatedAt: Date.now() };
}

async function expectNoReloadSince(page: Page, live: LiveSession) {
  expect(page.url(), `the page must not navigate while ${live.label} refreshes it live`).toBe(live.url);

  const marker = await page.evaluate(() => (window as LiveMarkerWindow).__scp0822LiveMarker);

  expect(marker, `the page must not reload while ${live.label} refreshes it live`).toBe(live.marker);
}

function requireLiveSession(page: Page): LiveSession {
  const live = requireState(page).liveSession;

  if (!live) {
    throw new Error('No owner API mutation has been issued against the open seeded scp0822 page');
  }

  return live;
}

function requireState(page: Page): ScenarioState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Seeded scp0822 scenario state has not been initialized');
  }

  return state;
}

function requireFixture(page: Page): FixtureContext {
  const fixture = requireState(page).fixture;

  if (!fixture) {
    throw new Error('The seeded scp0822 fixture context has not been resolved for this scenario');
  }

  return fixture;
}

function requireCurrentSeededPage(page: Page): SeededScpPage {
  const seededPage = requireState(page).currentSeededPage;

  if (!seededPage) {
    throw new Error('No seeded scp0822 page has been opened directly');
  }

  return seededPage;
}

function manageSpaceModal(page: Page) {
  return page.getByTestId('manage-space-modal');
}

function spaceMemberRow(page: Page, uid: string) {
  return manageSpaceModal(page).getByTestId(`space-member-row-${uid}`);
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
  // The space access cards enable once the structured settings have loaded.
  await expect(modal.getByTestId('manage-space-visibility-option-public')).toBeEnabled({ timeout: 15000 });
}

async function openManageSpaceMembersTab(page: Page) {
  const modal = manageSpaceModal(page);

  await modal.getByRole('tab', { name: 'Members' }).click();
  // Every seeded space lists at least its owner once the roster has loaded.
  await expect(modal.locator('[data-testid^="space-member-row-"]').first()).toBeVisible({ timeout: 15000 });
}

async function waitForResolvedFolderOutline(page: Page) {
  const folderViews = page.locator('.folder-views');

  await expect(folderViews).toBeVisible({ timeout: 30000 });
  await expect(folderViews.locator('.animate-pulse')).toHaveCount(0, { timeout: 30000 });
}

async function resolveFixtureContext(request: APIRequestContext): Promise<FixtureContext> {
  const ownerToken = await signInViaApi(request, SCP_ACCOUNTS.owner);
  const { workspaceId, workspaceName } = await findSeededWorkspace(request, ownerToken);
  const groups = await getApi<WorkspaceGroupsPayload>(request, ownerToken, `/api/workspace/${workspaceId}/groups`);
  const editorsGroup = groups.groups.find((candidate) => candidate.name === SCP_EDITORS_GROUP_NAME);

  if (!editorsGroup) {
    throw new Error(`Seeded workspace group "${SCP_EDITORS_GROUP_NAME}" not found; run the scp0822 seed (see the Given step)`);
  }

  const members = await getApiPreservingUid<WorkspaceMemberPayload[]>(
    request,
    ownerToken,
    `/api/workspace/${workspaceId}/member?include_pending=true`
  );
  const uids = {} as Record<ScpAccountAlias, string>;

  for (const alias of Object.keys(SCP_ACCOUNTS) as ScpAccountAlias[]) {
    const email = SCP_ACCOUNTS[alias];
    const member = members.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());

    if (member?.uid === undefined || member.uid === null) {
      throw new Error(`Seeded scp0822 workspace member uid not found for ${email}`);
    }

    uids[alias] = String(member.uid);
  }

  return { ownerToken, workspaceId, workspaceName, editorsGroupId: editorsGroup.group_id, uids };
}

// The seeded owner's workspace is the one that hosts the custom space. Prefer
// the workspaces the owner owns and confirm the seeded space answers there.
async function findSeededWorkspace(
  request: APIRequestContext,
  ownerToken: string
): Promise<{ workspaceId: string; workspaceName: string }> {
  const payload = await getApi<UserWorkspaceInfoPayload>(request, ownerToken, '/api/user/workspace');
  const candidates = [
    ...(payload.workspaces || []).filter(
      (workspace) =>
        workspace.role === 'Owner' && workspace.owner_email?.toLowerCase() === SCP_ACCOUNTS.owner.toLowerCase()
    ),
    ...(payload.visiting_workspace ? [payload.visiting_workspace] : []),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const workspaceId = candidate.workspace_id;

    if (!workspaceId || seen.has(workspaceId)) continue;
    seen.add(workspaceId);

    const hostsSeededSpace = await getApi<SpacePermissionResponsePayload>(
      request,
      ownerToken,
      spacePermissionApiPath(workspaceId, SCP_SPACES['custom space'].viewId)
    )
      .then(() => true)
      .catch(() => false);

    if (hostsSeededSpace) return { workspaceId, workspaceName: candidate.workspace_name || '' };
  }

  throw new Error(`No workspace of ${SCP_ACCOUNTS.owner} hosts the seeded scp0822 spaces; run the seed (see the Given step)`);
}

// Put the three spaces back into the deterministic seeded shape: types and
// collective levels first (switching back to custom may materialize rows the
// roster pass removes again), then the rosters.
async function restoreSeededShape(request: APIRequestContext, fixture: FixtureContext) {
  for (const space of Object.values(SCP_SPACES)) {
    const current = (await getSpacePermission(request, fixture, space.viewId)).permission;
    const expected = seededSettings(space.seededVisibility);

    if (!sameSettings(current, expected)) {
      await updateSpacePermission(request, fixture, space.viewId, expected);
    }
  }

  // Custom roster: owner (creator) + member as Space member + Editors group as Space member.
  const customSpaceId = SCP_SPACES['custom space'].viewId;
  const roster = await listSpaceMembers(request, fixture, customSpaceId);
  let memberListed = false;

  for (const row of roster.members) {
    const uid = String(row.uid);

    if (uid === fixture.uids.owner) continue;
    if (uid === fixture.uids.member) {
      memberListed = true;
      if (row.role !== 'member') {
        await patchApi(request, fixture.ownerToken, `${spaceMembersApiPath(fixture.workspaceId, customSpaceId)}/${uid}`, {
          role: 'member',
          access_level: ACCESS_LEVEL_READ_AND_WRITE,
        });
      }

      continue;
    }

    if (row.source === 'workspace_default' || row.source === 'page_share') continue;
    await deleteApi(request, fixture.ownerToken, `${spaceMembersApiPath(fixture.workspaceId, customSpaceId)}/${uid}`);
  }

  if (!memberListed) {
    await postRawApi(
      request,
      fixture.ownerToken,
      spaceMembersApiPath(fixture.workspaceId, customSpaceId),
      `{"uid":${fixture.uids.member},"role":"member","access_level":${ACCESS_LEVEL_READ_AND_WRITE}}`
    );
  }

  const customGroups = await listSpaceGroups(request, fixture, customSpaceId);
  const editorsGrant = customGroups.find((candidate) => candidate.group_id === fixture.editorsGroupId);
  const editorsPayload = { role: 'member', access_level: ACCESS_LEVEL_READ_AND_WRITE };

  if (!editorsGrant) {
    await postApi(request, fixture.ownerToken, spaceGroupApiPath(fixture.workspaceId, customSpaceId, fixture.editorsGroupId), editorsPayload);
  } else if (editorsGrant.role !== editorsPayload.role || editorsGrant.access_level !== editorsPayload.access_level) {
    await patchApi(request, fixture.ownerToken, spaceGroupApiPath(fixture.workspaceId, customSpaceId, fixture.editorsGroupId), editorsPayload);
  }

  // The public and private spaces carry no explicit rows besides the owner and no groups.
  for (const space of [SCP_SPACES['public space'], SCP_SPACES['private space']]) {
    const spaceRoster = await listSpaceMembers(request, fixture, space.viewId);

    for (const row of spaceRoster.members) {
      const uid = String(row.uid);

      if (uid === fixture.uids.owner || row.source === 'workspace_default' || row.source === 'page_share') continue;
      await deleteApi(request, fixture.ownerToken, `${spaceMembersApiPath(fixture.workspaceId, space.viewId)}/${uid}`);
    }

    for (const grant of await listSpaceGroups(request, fixture, space.viewId)) {
      await deleteApi(request, fixture.ownerToken, spaceGroupApiPath(fixture.workspaceId, space.viewId, grant.group_id));
    }
  }

  for (const space of Object.values(SCP_SPACES)) {
    const restored = (await getSpacePermission(request, fixture, space.viewId)).permission;

    if (!sameSettings(restored, seededSettings(space.seededVisibility))) {
      throw new Error(`Seeded scp0822 ${space.name} is not in its seeded shape after restore: ${JSON.stringify(restored)}`);
    }
  }
}

function sameSettings(left: SpacePermissionSettingsPayload, right: SpacePermissionSettingsPayload): boolean {
  return (
    left.visibility === right.visibility &&
    left.owner_access_level === right.owner_access_level &&
    left.member_default_access_level === right.member_default_access_level &&
    (left.everyone_else_access_level ?? null) === (right.everyone_else_access_level ?? null) &&
    left.invite_policy === right.invite_policy &&
    left.sidebar_edit_policy === right.sidebar_edit_policy &&
    left.invite_link_enabled === right.invite_link_enabled
  );
}

async function getSpacePermission(request: APIRequestContext, fixture: FixtureContext, spaceId: string) {
  return getApi<SpacePermissionResponsePayload>(
    request,
    fixture.ownerToken,
    spacePermissionApiPath(fixture.workspaceId, spaceId)
  );
}

async function updateSpacePermission(
  request: APIRequestContext,
  fixture: FixtureContext,
  spaceId: string,
  settings: SpacePermissionSettingsPayload
) {
  const response = await patchApi<SpacePermissionResponsePayload>(
    request,
    fixture.ownerToken,
    spacePermissionApiPath(fixture.workspaceId, spaceId),
    settings as unknown as Record<string, unknown>
  );

  if (response.permission.visibility !== settings.visibility) {
    throw new Error(`Space ${spaceId} did not switch to ${settings.visibility}: ${JSON.stringify(response.permission)}`);
  }
}

async function listSpaceMembers(request: APIRequestContext, fixture: FixtureContext, spaceId: string) {
  return getApiPreservingUid<SpaceMembersPayload>(
    request,
    fixture.ownerToken,
    spaceMembersApiPath(fixture.workspaceId, spaceId)
  );
}

async function listSpaceGroups(request: APIRequestContext, fixture: FixtureContext, spaceId: string) {
  const payload = await getApi<SpaceGroupPermissionsPayload>(
    request,
    fixture.ownerToken,
    spaceGroupApiPath(fixture.workspaceId, spaceId)
  );

  return payload.groups;
}

function spacePermissionApiPath(workspaceId: string, spaceId: string): string {
  return `/api/workspace/${workspaceId}/spaces/${spaceId}/permission`;
}

function spaceMembersApiPath(workspaceId: string, spaceId: string): string {
  return `/api/workspace/${workspaceId}/spaces/${spaceId}/members`;
}

function spaceGroupApiPath(workspaceId: string, spaceId: string, groupId?: string): string {
  const base = `/api/workspace/${workspaceId}/spaces/${spaceId}/group`;

  return groupId ? `${base}/${groupId}` : base;
}

async function signInViaApi(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      email,
      password: PASSWORD,
    },
    failOnStatusCode: false,
  });
  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Could not authenticate the seeded scp0822 account ${email}: HTTP ${response.status()} ${text}`);
  }

  const token = (parseJson(text) as { access_token?: string } | null)?.access_token;

  if (!token) {
    throw new Error(`Seeded scp0822 sign-in response for ${email} has no access token: ${text}`);
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

function scpAccountEmail(accountAliasValue: string): string {
  const alias = accountAliasValue as ScpAccountAlias;
  const email = SCP_ACCOUNTS[alias];

  if (!email) {
    throw new Error(`Unknown scp0822 account alias: ${accountAliasValue}`);
  }

  return email;
}

function scpUid(fixture: FixtureContext, accountAliasValue: string): string {
  const alias = accountAliasValue as ScpAccountAlias;
  const uid = fixture.uids[alias];

  if (!uid) {
    throw new Error(`Unknown scp0822 account alias: ${accountAliasValue}`);
  }

  return uid;
}

function scpSpace(spaceAliasValue: string): SeededScpSpace {
  const alias = spaceAliasValue as ScpSpaceAlias;
  const space = SCP_SPACES[alias];

  if (!space) {
    throw new Error(`Unknown scp0822 space alias: ${spaceAliasValue}`);
  }

  return space;
}

function scpPage(pageAliasValue: string): SeededScpPage {
  const alias = pageAliasValue as ScpPageAlias;
  const page = SCP_PAGES[alias];

  if (!page) {
    throw new Error(`Unknown scp0822 page alias: ${pageAliasValue}`);
  }

  return page;
}

function accessLevelFromLabel(label: string): number | null {
  switch (label) {
    case 'No access':
      return null;
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

function visibilityFromLabel(label: string): string {
  switch (label) {
    case 'Public':
      return 'public';
    case 'Private':
      return 'private';
    case 'Custom':
      return 'custom';
    default:
      throw new Error(`Unsupported space access label: ${label}`);
  }
}
