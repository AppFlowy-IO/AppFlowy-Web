import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Browser, BrowserContext, expect, Locator, Page, test } from '@playwright/test';

import {
  GALLERY_WORKSPACE_NAME,
  galleryConfigFromEnv,
  GalleryConfig,
  GalleryFixture,
  GalleryPerson,
  pageCapability,
  refreshGallerySession,
  seedPermissionGallery,
  setGroupSpaceAccess,
  setSpaceCreationPolicy,
  spaceCreationCapability,
} from '../../support/permission-gallery-seed';

/**
 * Screenshot gallery of the workspace permission UI on a synthetic "Demo" workspace.
 *
 * Opt-in only (skipped otherwise): APPFLOWY_PERMISSION_GALLERY=1, APPFLOWY_GALLERY_CLOUD,
 * APPFLOWY_GALLERY_GOTRUE and BASE_URL (the Web dev server) on an isolated loopback stack. The seed
 * switches the installation's workspace creation policy, so it refuses developer stack ports.
 * Images go to APPFLOWY_GALLERY_OUTPUT_DIR (default: the evidence folder of this gallery).
 *
 * Permission changes are made by the owner through the API, except where a caption says
 * otherwise; confirmations are opened and cancelled, so the captures leave settings unchanged.
 */
const config = galleryConfigFromEnv();
const outputDir = resolve(
  process.env.APPFLOWY_GALLERY_OUTPUT_DIR ?? 'playwright/bdd/evidence/space-group-permission-lifecycle'
);

test.use({ trace: 'off', video: 'off' });

async function guardNetwork(context: BrowserContext, cfg: GalleryConfig) {
  const allowed = new Set([cfg.web, cfg.cloud, cfg.gotrue]);

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The dev server proxies these paths to developer ports; the app must only use the gallery stack.
    const devProxy = url.origin === cfg.web && /^\/(api|ws|gotrue|s3|billing)(\/|$)/.test(url.pathname);

    if (!allowed.has(url.origin) || devProxy) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

/**
 * The live connection of a browser session. While `muted`, what the server pushes (including
 * permission change hints) is held back, so the app only learns of a change when it asks itself.
 */
type Realtime = { muted: boolean };

async function openAs(
  browser: Browser,
  fixture: GalleryFixture,
  person: GalleryPerson,
  path: string,
  realtime?: Realtime
) {
  const cfg = config as GalleryConfig;
  const session = await refreshGallerySession(cfg, fixture.people[person]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  await guardNetwork(context, cfg);
  if (realtime) {
    // Relay the socket both ways, except that server pushes are dropped while muted.
    await context.routeWebSocket(() => true, (socket) => {
      const server = socket.connectToServer();

      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        if (!realtime.muted) socket.send(message);
      });
    });
  }

  // Same session setup as the permission lifecycle harness: runtime config plus a stored token.
  await context.addInitScript(
    ({ auth, cloud, gotrue }) => {
      (window as Window & { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__ = {
        APPFLOWY_BASE_URL: cloud,
        APPFLOWY_GOTRUE_BASE_URL: gotrue,
        APPFLOWY_WS_BASE_URL: `${cloud.replace(/^http/, 'ws')}/ws/v2`,
      };
      localStorage.setItem('token', JSON.stringify(auth));
    },
    { auth: session.auth, cloud: cfg.cloud, gotrue: cfg.gotrue }
  );
  const page = await context.newPage();

  await page.goto(`${cfg.web}${path}`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Viewport screenshot; or exactly the target element (dialogs); or the target with a margin that
 * stays inside `within` (a section of a settings panel).
 */
async function shoot(
  page: Page,
  file: string,
  viewer: GalleryPerson,
  target?: Locator,
  frame?: { within: Locator; margin: number }
) {
  // Let menus, toasts and dialog transitions settle; browser spell-check marks are not app UI.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('[contenteditable="true"], input, textarea').forEach((element) => {
      element.spellcheck = false;
    });
  });
  const path = resolve(outputDir, file);

  if (target && frame) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const bounds = await frame.within.boundingBox();

    if (!box || !bounds) throw new Error(`${file}: capture target is not visible`);
    const x = Math.max(bounds.x, box.x - frame.margin);
    const y = Math.max(bounds.y, box.y - frame.margin);
    const right = Math.min(bounds.x + bounds.width, box.x + box.width + frame.margin);
    const bottom = Math.min(bounds.y + bounds.height, box.y + box.height + frame.margin);

    await page.screenshot({
      path,
      animations: 'disabled',
      clip: { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(right - x), height: Math.ceil(bottom - y) },
    });
  } else if (target) {
    await target.screenshot({ path, animations: 'disabled' });
  } else {
    await page.screenshot({ path, animations: 'disabled' });
  }

  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');

  await appendFile(
    test.info().outputPath('shots.jsonl'),
    `${JSON.stringify({ file, viewer, crop: target ? 'element' : 'viewport', sha256, captured_at: new Date().toISOString() })}\n`
  );
}

async function waitForApp(page: Page) {
  await expect(page.getByTestId('workspace-dropdown-trigger')).toBeVisible({ timeout: 60000 });
}

async function openSettings(page: Page, item: 'permissions' | 'members' | 'account') {
  await page.getByTestId('workspace-dropdown-trigger').click();
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.getByTestId(`settings-menu-${item}`).click();
}

async function openManageSpace(page: Page, spaceId: string) {
  const space = page.getByTestId(`space-${spaceId}`);

  await expect(space).toBeVisible();
  await space.hover();
  await space.getByTestId('inline-more-actions').click();
  await page.getByTestId('space-action-manage').click();
  await expect(page.getByTestId('space-settings-panel')).toBeVisible();
}

test.describe('Workspace permission screenshot gallery', () => {
  test.skip(!config, 'Opt-in: APPFLOWY_PERMISSION_GALLERY=1 with an isolated gallery stack');

  let fixture: GalleryFixture;

  test.beforeAll(async () => {
    await mkdir(outputDir, { recursive: true });
    fixture = await seedPermissionGallery(config as GalleryConfig);
  });

  test('owner: Permissions panel, narrowing question and Access to all spaces summary', async ({ browser }) => {
    const { context, page } = await openAs(browser, fixture, 'olivia', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

    await waitForApp(page);
    await openSettings(page, 'permissions');
    await expect(page.getByTestId('space-creation-policy-owners_and_selected_members')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`space-creator-row-user-${fixture.people.alex.uuid}`)).toBeVisible();
    await expect(page.getByTestId(`space-creator-row-group-${fixture.groups.Super_Users}`)).toBeVisible();
    await shoot(page, 'permissions-owner-selected-members.png', 'olivia');

    // Add members or groups lists who can be chosen before anything is typed.
    await page.getByRole('button', { name: 'Add members or groups' }).click();
    const candidates = page.getByTestId('space-creator-candidates');

    await expect(candidates.getByTestId(`space-creator-candidate-user-${fixture.people.sam.uuid}`)).toBeVisible();
    await expect(candidates.getByTestId(`space-creator-candidate-group-${fixture.groups.HR}`)).toBeVisible();
    // Alex and Super_Users are already selected.
    await expect(candidates.getByTestId(`space-creator-candidate-user-${fixture.people.alex.uuid}`)).toHaveCount(0);
    await expect(candidates.getByTestId(`space-creator-candidate-group-${fixture.groups.Super_Users}`)).toHaveCount(0);
    await shoot(page, 'permissions-add-members-suggestions.png', 'olivia');
    await page.getByTestId('space-creator-search-input').press('Escape');
    await expect(candidates).toBeHidden();

    // Narrowing who can create spaces asks first; the question is cancelled.
    await page.getByTestId('space-creation-policy-owners_only').click();
    const confirmation = page.getByTestId('space-creation-restrict-confirmation');

    await expect(confirmation).toBeVisible();
    await shoot(page, 'permissions-narrowing-confirmation.png', 'olivia', confirmation);
    await page.getByTestId('space-creation-restrict-cancel').click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByTestId('space-creation-policy-owners_and_selected_members')).toHaveAttribute('aria-pressed', 'true');

    // The section: title, description, groups with access to all spaces and the Manage groups button.
    const summary = page.getByTestId('group-space-coverage-summary').locator('xpath=..');

    await expect(page.getByTestId(`group-space-coverage-summary-${fixture.groups.Users}`)).toBeVisible();
    await expect(summary.getByTestId('group-space-coverage-manage')).toBeVisible();
    // At the end of the panel, so its fade (shown while more is below) is gone.
    const panel = page.getByTestId('workspace-permissions-panel');

    await panel.locator('.overflow-y-auto').first().evaluate((area) => area.scrollTo({ top: area.scrollHeight }));
    await expect(panel.getByTestId('more-below-fade')).toHaveAttribute('data-visible', 'false');
    await shoot(page, 'permissions-access-to-all-spaces-summary.png', 'olivia', summary, {
      within: page.getByTestId('workspace-permissions-panel'),
      margin: 16,
    });

    // People > Groups > HR > General: the Access to all spaces menu, then the grant question.
    await page.getByTestId('group-space-coverage-manage').click();
    await page.getByTestId(`group-edit-${fixture.groups.HR}`).click();
    const groupDialog = page.getByTestId('group-detail-modal');

    await expect(groupDialog).toBeVisible();
    await expect(groupDialog.getByTestId('group-space-coverage-trigger')).toBeEnabled();
    await groupDialog.getByTestId('group-space-coverage-trigger').click();
    await expect(page.getByTestId('group-space-coverage-option-30')).toBeVisible();
    await shoot(page, 'group-dialog-access-to-all-spaces-menu.png', 'olivia');
    await page.getByTestId('group-space-coverage-option-30').click();
    const grant = page.getByTestId('group-space-coverage-confirmation');

    await expect(grant).toBeVisible();
    await shoot(page, 'group-access-to-all-spaces-confirmation.png', 'olivia', grant);
    await page.getByTestId('group-space-coverage-cancel').click();
    await expect(grant).toBeHidden();
    await expect(groupDialog.getByTestId('group-space-coverage-trigger')).toContainText('Off');
    await context.close();
  });

  test('member: Permissions panel is read-only', async ({ browser }) => {
    const { context, page } = await openAs(browser, fixture, 'sam', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

    await waitForApp(page);
    await openSettings(page, 'permissions');
    await expect(page.getByTestId('space-creation-policy-owners_and_selected_members')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('space-creation-policy-owners_only')).toBeDisabled();
    await shoot(page, 'permissions-member-read-only.png', 'sam');
    await context.close();
  });

  test('owner: Manage Space members and page setting in a Custom space, then Create Space', async ({ browser }) => {
    const { context, page } = await openAs(browser, fixture, 'olivia', `/app/${fixture.workspaceId}/${fixture.pages.onboarding}`);

    await waitForApp(page);
    await openManageSpace(page, fixture.spaces.HR);
    // The dialog takes the window's height: a Custom space's General tab fits at 1440x900, so "Who can
    // add pages to this space" is visible without scrolling and no fade says there is more.
    const general = page.getByTestId('space-settings-general');

    await expect(page.getByTestId('space-sidebar-policy')).toContainText('Only space owners');
    await expect(page.getByTestId('space-sidebar-policy-row')).toBeInViewport({ ratio: 1 });
    await expect(general.getByTestId('more-below-fade')).toHaveAttribute('data-visible', 'false');
    await shoot(page, 'manage-space-general-page-setting.png', 'olivia');

    // Changing the space type asks first, in sentence case; the question is cancelled.
    await page.getByTestId('manage-space-visibility-option-public').click();
    const typeChange = page.getByTestId('manage-space-confirm-dialog');

    await expect(typeChange).toContainText('Make this space public?');
    await shoot(page, 'manage-space-type-change-confirmation.png', 'olivia', typeChange);
    await typeChange.getByRole('button', { name: 'Cancel' }).click();
    await expect(typeChange).toBeHidden();
    await expect(page.getByTestId('manage-space-visibility-option-custom')).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('tab', { name: 'Members' }).click();
    const alexAccess = page.getByTestId(`space-member-access-${fixture.people.alex.uid}`);

    await expect(alexAccess).toBeVisible();
    await expect(page.getByTestId(`space-group-access-${fixture.groups.HR}`)).toBeVisible();
    await alexAccess.click();
    await expect(page.getByTestId(`space-member-access-${fixture.people.alex.uid}-option-default`)).toBeVisible();
    await shoot(page, 'manage-space-members-access-menu.png', 'olivia');
    await page.keyboard.press('Escape');
    // The one explanation of per-person access lives in the column header.
    await page.getByTestId('space-member-access-header').hover();
    await expect(page.getByTestId('space-member-access-header-hint').first()).toBeVisible();
    await shoot(page, 'manage-space-members-access-explanation.png', 'olivia');

    // Add people or groups lists who can be added before anything is typed: Sam reaches HR only
    // through the HR group, and Product and Super_Users are not in the space. The header's tooltip
    // covers the button until the pointer leaves.
    // (in steps: the tooltip closes once the pointer has moved on past its grace area).
    await page.mouse.move(700, 880, { steps: 8 });
    await expect(page.getByTestId('space-member-access-header-hint')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add people or groups' }).click();
    await expect(page.getByTestId('workspace-member-inline-search-result').filter({ hasText: 'Sam Leroy' })).toBeVisible();
    await expect(page.getByTestId(`space-group-inline-search-result-${fixture.groups.Product}`)).toBeVisible();
    await expect(page.getByTestId(`space-group-inline-search-result-${fixture.groups.Super_Users}`)).toBeVisible();
    await shoot(page, 'manage-space-add-suggestions.png', 'olivia');
    await page.getByTestId('workspace-member-inline-search-input').press('Escape');
    await expect(page.getByTestId(`space-group-inline-search-result-${fixture.groups.Product}`)).toBeHidden();
    await page.getByTestId('manage-space-modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('space-settings-panel')).toBeHidden();

    // Product: Olivia's own row is Can view, and the Product group gives her Can edit.
    await openManageSpace(page, fixture.spaces.Product);
    await page.getByRole('tab', { name: 'Members' }).click();
    const ownAccess = page.getByTestId(`space-member-access-${fixture.people.olivia.uid}`);
    const ownHint = page.getByTestId(`space-member-access-${fixture.people.olivia.uid}-extra-access`);

    await expect(ownAccess).toBeEnabled();
    // With the menu closed, an info icon beside it says where the extra access comes from.
    await expect(ownHint).toHaveAttribute('aria-label', /Product group/);
    await ownHint.hover();
    await expect(page.getByRole('tooltip')).toContainText('Product group');
    await shoot(page, 'manage-space-own-access-hint.png', 'olivia');
    await ownAccess.click();
    await expect(page.getByTestId(`space-member-access-${fixture.people.olivia.uid}-note`)).toContainText('Product group');
    await shoot(page, 'manage-space-own-access-explanation.png', 'olivia');
    await page.keyboard.press('Escape');
    await page.getByTestId('manage-space-modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('space-settings-panel')).toBeHidden();

    await page.getByTestId('new-page-button').click();
    await page.getByTestId('new-page-create-space-button').click();
    await expect(page.getByTestId('create-space-submit')).toBeVisible();
    await page.getByTestId('space-name-input').fill('Marketing');
    // A Public space's settings are taller than the dialog at 1440x900: a fade says there is more.
    const createGeneral = page.getByTestId('space-settings-general');

    await expect(createGeneral.getByTestId('more-below-fade')).toHaveAttribute('data-visible', 'true');
    await shoot(page, 'create-space.png', 'olivia');
    // Scrolled to the end of the tab (scrollIntoViewIfNeeded stops once the row is partly shown).
    await createGeneral.locator('.overflow-y-auto').first().evaluate((area) => area.scrollTo({ top: area.scrollHeight }));
    await expect(page.getByTestId('space-sidebar-policy-row')).toBeInViewport({ ratio: 1 });
    await expect(createGeneral.getByTestId('more-below-fade')).toHaveAttribute('data-visible', 'false');
    await shoot(page, 'create-space-page-setting.png', 'olivia');
    await context.close();
  });

  test('member: Create space refused after the owner narrows who can create spaces', async ({ browser }) => {
    const cfg = config as GalleryConfig;
    // Alex is a selected space creator: Create space opens for him with the Create button enabled.
    const realtime: Realtime = { muted: false };
    const { context, page } = await openAs(browser, fixture, 'alex', `/app/${fixture.workspaceId}/${fixture.pages.roadmap}`, realtime);

    try {
      await waitForApp(page);
      // The page syncs over the relayed connection, so the roadmap is on screen behind the dialog.
      await expect(page.locator('[data-slate-editor="true"]')).toContainText('Three themes for next year');
      await page.getByTestId('new-page-button').click();
      await page.getByTestId('new-page-create-space-button').click();
      await page.getByTestId('space-name-input').fill('Marketing');
      await expect(page.getByTestId('create-space-submit')).toBeEnabled();

      // The owner narrows the rule to Owners only while Alex's dialog is open. The live hint about
      // it is held back, as when it arrives late, so the dialog still offers Create; pressing it
      // rechecks with the server first, which now refuses.
      realtime.muted = true;
      await setSpaceCreationPolicy(cfg, fixture, 'owners_only');
      await expect.poll(async () => (await spaceCreationCapability(cfg, fixture, 'alex'))?.can_create_space).toBe(false);
      await expect(page.getByTestId('create-space-submit')).toBeEnabled();
      await page.getByTestId('create-space-submit').click();

      const denied = page.getByTestId('create-space-denied');

      await expect(denied).toBeVisible();
      await expect(denied).toContainText("You can't create spaces in this workspace.");
      await expect(denied).toContainText('Ask a workspace owner if you need a new space.');
      await expect(page.getByTestId('create-space-summary')).toContainText('Marketing');
      // The form and its Create button are gone; Close is the only action and has keyboard focus
      // (pressed with the mouse here, so no focus ring shows).
      await expect(page.getByTestId('space-name-input')).toHaveCount(0);
      await expect(page.getByTestId('create-space-submit')).toHaveCount(0);
      await expect(page.getByTestId('create-space-denied-close')).toBeFocused();
      await shoot(page, 'create-space-denied.png', 'alex');
      await page.getByTestId('create-space-denied-close').click();
      await expect(page.getByTestId('create-space-modal')).toBeHidden();
      // Nothing was created.
      const spaces = await fetch(`${cfg.cloud}/api/workspace/${fixture.workspaceId}/spaces`, {
        headers: { Authorization: `Bearer ${fixture.people.alex.auth.access_token}` },
      }).then((response) => response.json() as Promise<{ data?: { spaces?: { name: string }[] } }>);

      expect(spaces.data?.spaces?.some((space) => space.name === 'Marketing')).toBe(false);
    } finally {
      await setSpaceCreationPolicy(cfg, fixture, 'owners_and_selected_members');
      realtime.muted = false;
    }

    await expect.poll(async () => (await spaceCreationCapability(cfg, fixture, 'alex'))?.can_create_space).toBe(true);
    await context.close();
  });

  test('member: workspace menu with Create workspace unavailable', async ({ browser }) => {
    const { context, page } = await openAs(browser, fixture, 'alex', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

    await waitForApp(page);
    await page.getByTestId('workspace-dropdown-trigger').click();
    const create = page.getByTestId('create-workspace');

    await expect(create).toHaveAttribute('aria-disabled', 'true');
    await create.hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await shoot(page, 'workspace-menu-create-workspace-denied.png', 'alex');
    await context.close();
  });

  test('account without a workspace sees its pending invitation', async ({ browser }) => {
    const cfg = config as GalleryConfig;
    const { context, page } = await openAs(browser, fixture, 'jordan', '/app');

    await expect(page.getByText("You're not in a workspace yet")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(GALLERY_WORKSPACE_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText("Join a workspace you've been invited to below.")).toBeVisible();
    await expect(page.getByText('Ask a workspace owner to invite you')).toHaveCount(0);

    // Jordan's invitation is for a guest. The page says so under the workspace name once the server
    // sends the invited role (`role` on each pending invitation: "Owner", "Member" or "Guest"); a
    // server that sends none gets no line, and this capture is to be retaken once one does.
    const invitations = await fetch(`${cfg.cloud}/api/workspace/invite?status=Pending`, {
      headers: { Authorization: `Bearer ${fixture.people.jordan.auth.access_token}` },
    }).then((response) => response.json() as Promise<{ data?: { workspace_id: string; role?: unknown }[] }>);
    const invitation = invitations.data?.find((item) => item.workspace_id === fixture.workspaceId);
    const guestLine = page.getByText('Invited as a guest', { exact: true });

    expect(invitation).toBeDefined();
    if (invitation?.role === 'Guest') {
      await expect(guestLine).toBeVisible();
    } else {
      await expect(guestLine).toHaveCount(0);
      test.info().annotations.push({
        type: 'waits for the server',
        description: `the invitation list sends role ${JSON.stringify(invitation?.role ?? null)}; retake account-only-pending-invitation.png once it sends "Guest"`,
      });
    }

    await shoot(page, 'account-only-pending-invitation.png', 'jordan');
    await context.close();
  });

  test('open page loses and regains access when its group grant changes', async ({ browser }) => {
    const cfg = config as GalleryConfig;
    const { context, page } = await openAs(browser, fixture, 'sam', `/app/${fixture.workspaceId}/${fixture.pages.onboarding}`);
    const editor = page.locator('[data-slate-editor="true"]');

    await waitForApp(page);
    await expect(editor).toContainText('Welcome aboard');
    const marker = await page.evaluate(() => {
      const value = crypto.randomUUID();

      (window as Window & { __galleryMarker?: string }).__galleryMarker = value;
      return value;
    });

    try {
      await setGroupSpaceAccess(cfg, fixture, 'HR', 'HR', null);
      await expect.poll(async () => (await pageCapability(cfg, fixture, 'sam', 'onboarding'))?.can_read ?? false).toBe(false);
      await expect(page.getByText('No access to this page', { exact: true })).toBeVisible();
      await expect(editor).toHaveCount(0);
      // Nothing to share, favorite or act on for a page Sam can't open.
      await expect(page.getByTestId('share-button')).toHaveCount(0);
      await shoot(page, 'page-no-access-after-group-removed.png', 'sam');
    } finally {
      await setGroupSpaceAccess(cfg, fixture, 'HR', 'HR', 30);
    }

    await expect.poll(async () => (await pageCapability(cfg, fixture, 'sam', 'onboarding'))?.can_write ?? false).toBe(true);
    await expect(editor).toContainText('Welcome aboard');
    await expect(page.getByTestId('share-button')).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __galleryMarker?: string }).__galleryMarker)).toBe(marker);
    await shoot(page, 'page-access-restored-after-regrant.png', 'sam');
    await context.close();
  });

  test('sign-out question offers to remove this account’s data', async ({ browser }) => {
    const { context, page } = await openAs(browser, fixture, 'alex', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

    await waitForApp(page);
    await openSettings(page, 'account');
    await page.getByTestId('settings-logout-button').click();
    await expect(page.getByRole('switch', { name: 'Also remove page copies from this browser' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true }).last()).toBeVisible();
    await shoot(page, 'sign-out-remove-data.png', 'alex');
    await context.close();
  });
});
