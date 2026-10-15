import { writeFile } from 'node:fs/promises';

import { Browser, BrowserContext, expect, Page, test, TestInfo } from '@playwright/test';

import { galleryLaunchOptions, GalleryRealtime, newGalleryContext } from '../../support/permission-gallery-browser';
import {
  deleteGalleryWorkspace,
  GALLERY_PEOPLE,
  GALLERY_WORKSPACE_NAME,
  galleryConfigFromEnv,
  GalleryConfig,
  GalleryFixture,
  galleryPageText,
  GalleryPerson,
  isOwnSpaceMemberRow,
  listGalleryWorkspaces,
  pageCapability,
  readPageDocument,
  readPageLines,
  readSpaceAssignments,
  restorePageText,
  seedPermissionGallery,
  setDirectSpaceMember,
  setSpaceCreationPolicy,
  spaceCreationCapability,
} from '../../support/permission-gallery-seed';

/**
 * Videos of the workspace permission flows on the synthetic "Demo" workspace of the screenshot
 * gallery: the same seed, stack and network guard as permission-gallery.capture.spec.ts.
 *
 * Opt-in only (skipped otherwise): APPFLOWY_PERMISSION_VIDEOS=1 together with the gallery's
 * variables (APPFLOWY_PERMISSION_GALLERY=1, APPFLOWY_GALLERY_CLOUD, APPFLOWY_GALLERY_GOTRUE,
 * BASE_URL) on an isolated loopback stack. Each test records one browser window per person into its
 * output folder (window-<n>-<person>.webm) and writes timeline.json: when each window opened and
 * closed, the captions shown and the checks that passed. playwright/support/permission-videos-encode.py
 * joins a test's windows in the order they were on screen and encodes one MP4 and one GIF.
 *
 * The caption banner and the dot that marks the pointer (headless recordings show no cursor) are
 * drawn by this harness, not by the app: hidden from assistive technology, ignoring the pointer,
 * and with the caption text in CSS generated content, so no locator can match it. Each test puts
 * back, in a `finally`, the settings it changes and the text of any page it edits; a page's edit
 * history stays, so on a reused database view-group-reads-only opens a page with deletions in its
 * history (and asserts that the reader is still never told about edits waiting for access).
 */
const config = process.env.APPFLOWY_PERMISSION_VIDEOS === '1' ? galleryConfigFromEnv() : undefined;
const SLOW_MO_MS = 200;

// Recording is on in this spec only (the gallery spec and the config keep it off). launchOptions
// replaces the project's, so the gallery's Chromium and flags are given again, with slowMo.
test.use({
  video: { mode: 'on', size: { width: 1280, height: 800 } },
  viewport: { width: 1280, height: 800 },
  launchOptions: galleryLaunchOptions({ slowMo: SLOW_MO_MS }),
});

const CAN_VIEW = 10;
const CAN_COMMENT = 20;
const WORKSPACE_DENIED = "Your administrator hasn't allowed you to create workspaces.";
const SPACE_DENIED = "You can't create spaces in this workspace.";
/** Typed by Sam in V3 and removed again; plain ASCII so it reads the same in the server's JSON. */
const SAM_SENTENCE = 'Sam added this line through the HR group';
/** Onboarding checklist's one line, as seeded. */
const ONBOARDING_TEXT = galleryPageText('onboarding');
const NEW_WORKSPACE = 'Video demo workspace';
const NEW_SPACE = 'Marketing';
/** The notice about edits waiting for edit access (or being saved); in the DOM only while shown. */
const PENDING_EDITS_NOTICE = '[data-testid="pending-permission-edits"]';

/**
 * Caption banner and pointer dot, drawn by the recording harness (installed in every page). Browser
 * spell-check marks are not app UI, so they are turned off, as the screenshot gallery does.
 */
function installRecordingOverlays() {
  const CAPTION = 'permission-video-caption';
  const POINTER = 'permission-video-pointer';
  const EDITABLE = '[contenteditable], input, textarea';
  const place = { x: -100, y: -100, pressed: false };
  const noSpellCheck = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(EDITABLE)) node.spellcheck = false;
    node.querySelectorAll<HTMLElement>(EDITABLE).forEach((element) => {
      element.spellcheck = false;
    });
  };

  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') noSpellCheck(record.target);
      record.addedNodes.forEach(noSpellCheck);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable'] });
  const install = () => {
    if (!document.body || document.getElementById(CAPTION)) return;
    const style = document.createElement('style');

    style.textContent = [
      `#${CAPTION}{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;`,
      'pointer-events:none;max-width:calc(100% - 48px);box-sizing:border-box;padding:7px 18px 7px 14px;',
      'border-left:6px solid #ffb800;border-radius:8px;background:rgba(15,23,42,0.94);color:#fff;',
      'font:600 17px/24px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 18px rgba(15,23,42,0.28)}',
      `#${CAPTION}::before{content:attr(data-caption)}`,
      `#${CAPTION}:not([data-caption]){display:none}`,
      `#${POINTER}{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;`,
      'box-sizing:border-box;border-radius:50%;border:2px solid rgba(15,23,42,0.9);',
      'background:rgba(255,184,0,0.45);z-index:2147483647;pointer-events:none;display:none}',
      `#${POINTER}[data-pressed]{background:rgba(255,184,0,0.95);border-width:3px}`,
    ].join('');
    const caption = document.createElement('div');
    const pointer = document.createElement('div');
    const saved = sessionStorage.getItem(CAPTION);

    caption.id = CAPTION;
    caption.setAttribute('aria-hidden', 'true');
    if (saved) caption.setAttribute('data-caption', saved);
    pointer.id = POINTER;
    pointer.setAttribute('aria-hidden', 'true');
    document.head.appendChild(style);
    document.body.append(caption, pointer);
  };

  const movePointer = () => {
    install();
    const pointer = document.getElementById(POINTER);

    if (!pointer) return;
    pointer.style.display = 'block';
    pointer.style.transform = `translate(${place.x}px, ${place.y}px)`;
    if (place.pressed) pointer.setAttribute('data-pressed', '');
    else pointer.removeAttribute('data-pressed');
  };

  window.addEventListener(
    'mousemove',
    (event) => {
      place.x = event.clientX;
      place.y = event.clientY;
      movePointer();
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    'mousedown',
    () => {
      place.pressed = true;
      movePointer();
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    'mouseup',
    () => {
      place.pressed = false;
      movePointer();
    },
    { capture: true, passive: true }
  );
  (window as Window & { __permissionVideoCaption?: (text: string) => void }).__permissionVideoCaption = (text) => {
    sessionStorage.setItem(CAPTION, text);
    install();
    document.getElementById(CAPTION)?.setAttribute('data-caption', text);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

interface ClipWindow {
  index: number;
  person: GalleryPerson;
  file: string;
  /** Milliseconds since the clip began when the page, and so its recording, was created. */
  opened_ms: number;
  closed_ms?: number;
  context: BrowserContext;
  page: Page;
}

interface ClipEvent {
  at_ms: number;
  /** Index of the window it happened in; 0 for checks made through the API only. */
  window: number;
  kind: 'caption' | 'check';
  text: string;
}

/** The clip of the running test; afterEach closes its windows and writes its timeline. */
let currentClip: Clip | undefined;

/**
 * One video: a recorded browser window per person, opened and closed in the order of the story,
 * and a timeline of the captions shown and the checks that passed.
 */
class Clip {
  private readonly browser: Browser;
  private readonly testInfo: TestInfo;
  private readonly cfg: GalleryConfig;
  private readonly fixture: GalleryFixture;
  private readonly viewport: { width: number; height: number };
  private readonly started = Date.now();
  private readonly windows: ClipWindow[] = [];
  private readonly events: ClipEvent[] = [];

  constructor(
    browser: Browser,
    testInfo: TestInfo,
    cfg: GalleryConfig,
    fixture: GalleryFixture,
    viewport: { width: number; height: number }
  ) {
    this.browser = browser;
    this.testInfo = testInfo;
    this.cfg = cfg;
    this.fixture = fixture;
    this.viewport = viewport;
  }

  private now() {
    return Date.now() - this.started;
  }

  private windowOf(page: Page) {
    const entry = this.windows.find((candidate) => candidate.page === page);

    if (!entry) throw new Error('This page is not a window of the clip');
    return entry;
  }

  /** Open a recorded window for `person` at `path`: signed in, or on the login screen. */
  async open(person: GalleryPerson, path: string, options: { realtime?: GalleryRealtime; signedOut?: boolean } = {}) {
    const index = this.windows.length + 1;
    const context = await newGalleryContext(this.browser, this.cfg, this.fixture, person, {
      viewport: this.viewport,
      realtime: options.realtime,
      signedOut: options.signedOut,
      recordVideo: { dir: this.testInfo.outputPath('recordings'), size: this.viewport },
    });

    await context.addInitScript(installRecordingOverlays);
    const opened_ms = this.now();
    const page = await context.newPage();

    this.windows.push({ index, person, file: `window-${index}-${person}.webm`, opened_ms, context, page });
    await page.goto(`${this.cfg.web}${path}`, { waitUntil: 'domcontentloaded' });
    return page;
  }

  /** Show `text` in the window's caption banner, then leave time to read it. */
  async caption(page: Page, text: string, readMs = 1800) {
    const entry = this.windowOf(page);

    await page.evaluate(
      (value) => (window as Window & { __permissionVideoCaption?: (text: string) => void }).__permissionVideoCaption?.(value),
      text
    );
    this.events.push({ at_ms: this.now(), window: entry.index, kind: 'caption', text });
    await page.waitForTimeout(readMs);
  }

  /** Run an assertion; only checks that passed reach the timeline. */
  async check(page: Page | null, text: string, assertion: () => Promise<unknown>) {
    await assertion();
    this.events.push({ at_ms: this.now(), window: page ? this.windowOf(page).index : 0, kind: 'check', text });
  }

  /** Keep the last state on screen for a moment, close the window and keep its recording. */
  async close(page: Page, holdMs = 1800) {
    const entry = this.windowOf(page);

    await page.waitForTimeout(holdMs);
    await this.finish(entry);
  }

  private async finish(entry: ClipWindow) {
    if (entry.closed_ms !== undefined) return;
    entry.closed_ms = this.now();
    await entry.context.close();
    await entry.page.video()?.saveAs(this.testInfo.outputPath(entry.file));
  }

  /** Close what is still open (after a failure too), keeping the recordings. */
  async closeAll() {
    for (const entry of this.windows) await this.finish(entry);
  }

  /** Write timeline.json; `status` is the test's final status (only known after the test). */
  async writeTimeline(status: string) {
    const timeline = {
      test: this.testInfo.title,
      status,
      viewport: this.viewport,
      slow_mo_ms: SLOW_MO_MS,
      windows: this.windows.map(({ index, person, file, opened_ms, closed_ms }) => ({
        index,
        person,
        file,
        opened_ms,
        closed_ms,
      })),
      events: this.events,
    };

    await writeFile(this.testInfo.outputPath('timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  }
}

/** A new clip for the running test, registered so afterEach can finish it. */
function startClip(browser: Browser, testInfo: TestInfo, fixture: GalleryFixture, viewport: { width: number; height: number } | null) {
  currentClip = new Clip(browser, testInfo, config as GalleryConfig, fixture, viewport ?? { width: 1280, height: 800 });
  return currentClip;
}

async function waitForApp(page: Page) {
  await expect(page.getByTestId('workspace-dropdown-trigger')).toBeVisible({ timeout: 60000 });
  // Let the sidebar and the page settle before the first caption.
  await page.waitForTimeout(1200);
}

/** Click with a short pause first, so a viewer can follow where the pointer goes. */
async function press(page: Page, testId: string) {
  const target = page.getByTestId(testId);

  await target.hover();
  await page.waitForTimeout(450);
  await target.click();
}

function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

interface NoticeWatch {
  watching: boolean;
  seen: boolean;
  text: string;
}

/**
 * Watch a window for the pending-edits notice from now on: every DOM change is checked, so a notice
 * that comes and goes between two assertions is caught too. Returns a reader of what was seen;
 * `watching` is false if the page was reloaded since (the watch would have been lost).
 */
async function watchPendingEditsNotice(page: Page) {
  await page.evaluate((selector) => {
    const state: NoticeWatch = { watching: true, seen: false, text: '' };
    const look = () => {
      const notice = document.querySelector(selector);

      if (notice && !state.seen) {
        state.seen = true;
        state.text = notice.textContent ?? '';
      }
    };

    (window as Window & { __pendingEditsNotice?: NoticeWatch }).__pendingEditsNotice = state;
    look();
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
  }, PENDING_EDITS_NOTICE);
  return () =>
    page.evaluate(
      (): NoticeWatch =>
        (window as Window & { __pendingEditsNotice?: NoticeWatch }).__pendingEditsNotice ?? {
          watching: false,
          seen: false,
          text: '',
        }
    );
}

/**
 * A test's clean-up, run from its `finally`. If it fails, the test fails, except that it never
 * replaces the error that ended the test early: that one is reported, this one is annotated.
 */
async function cleanUp(failed: boolean, steps: () => Promise<void>) {
  try {
    await steps();
  } catch (error) {
    if (!failed) throw error;
    test.info().annotations.push({ type: 'clean-up failed too', description: String(error) });
  }
}

test.describe('Workspace permission videos', () => {
  test.skip(!config, 'Opt-in: APPFLOWY_PERMISSION_VIDEOS=1 with the permission gallery stack variables');

  let fixture: GalleryFixture;

  test.beforeAll(async () => {
    fixture = await seedPermissionGallery(config as GalleryConfig);
  });

  test.afterEach(async () => {
    const clip = currentClip;

    currentClip = undefined;
    if (!clip) return;
    await clip.closeAll();
    await clip.writeTimeline(test.info().status ?? 'unknown');
  });

  test('groups-two-levels: the HR group can edit HR, the Users group can view it', async ({ browser, viewport }, testInfo) => {
    const cfg = config as GalleryConfig;
    const clip = startClip(browser, testInfo, fixture, viewport);
    const usersOverride = async () =>
      (await readSpaceAssignments(cfg, fixture, 'HR')).groups.find((group) => group.group_id === fixture.groups.Users)
        ?.access_level_override;
    let changed = false;
    let failed = true;

    try {
      await clip.check(null, 'server: the Users group has Can view in HR before the clip', async () =>
        expect(await usersOverride()).toBe(CAN_VIEW)
      );
      const page = await clip.open('olivia', `/app/${fixture.workspaceId}/${fixture.pages.onboarding}`);

      await waitForApp(page);
      await clip.caption(page, 'Olivia (owner) opens the HR space settings: Manage space');
      const space = page.getByTestId(`space-${fixture.spaces.HR}`);

      await space.hover();
      await page.waitForTimeout(600);
      await space.getByTestId('inline-more-actions').click();
      await page.waitForTimeout(600);
      await press(page, 'space-action-manage');
      await expect(page.getByTestId('space-settings-panel')).toBeVisible();
      await page.waitForTimeout(900);
      await clip.caption(page, 'The Members tab lists people and groups with their access');
      const membersTab = page.getByRole('tab', { name: 'Members' });

      await membersTab.hover();
      await page.waitForTimeout(450);
      await membersTab.click();
      const hrAccess = page.getByTestId(`space-group-access-${fixture.groups.HR}`);
      const usersAccess = page.getByTestId(`space-group-access-${fixture.groups.Users}`);

      await clip.check(page, 'HR group row shows Can edit', () => expect(hrAccess).toHaveText('Can edit'));
      await clip.check(page, 'Users group row shows Can view', () => expect(usersAccess).toHaveText('Can view'));
      await page.mouse.move(640, 760, { steps: 6 });
      await clip.caption(page, 'Two groups, two levels: the HR group can edit, the Users group can view', 3200);

      await clip.caption(page, "Olivia opens the Users group's Access menu and picks Can comment");
      changed = true;
      await press(page, `space-group-access-${fixture.groups.Users}`);
      await page.waitForTimeout(900);
      await press(page, `space-group-access-${fixture.groups.Users}-option-${CAN_COMMENT}`);
      await clip.check(page, 'toast "Access updated" after choosing Can comment', () =>
        expect(toast(page, 'Access updated')).toBeVisible()
      );
      await clip.check(page, 'Users group row shows Can comment', () => expect(usersAccess).toHaveText('Can comment'));
      await clip.check(page, 'server: the Users group has Can comment (20) in HR', () =>
        expect.poll(usersOverride).toBe(CAN_COMMENT)
      );
      await clip.caption(page, 'Saved: the Users group can now comment in HR', 2400);
      // The next toast must be a new one.
      await expect(toast(page, 'Access updated')).toHaveCount(0, { timeout: 15000 });

      await clip.caption(page, 'Olivia sets the Users group back to Can view');
      await press(page, `space-group-access-${fixture.groups.Users}`);
      await page.waitForTimeout(900);
      await press(page, `space-group-access-${fixture.groups.Users}-option-${CAN_VIEW}`);
      await clip.check(page, 'toast "Access updated" after choosing Can view', () =>
        expect(toast(page, 'Access updated')).toBeVisible()
      );
      await clip.check(page, 'Users group row shows Can view again', () => expect(usersAccess).toHaveText('Can view'));
      await clip.check(page, 'server: the Users group has Can view (10) in HR again', () =>
        expect.poll(usersOverride).toBe(CAN_VIEW)
      );
      await clip.check(page, 'HR group row still shows Can edit', () => expect(hrAccess).toHaveText('Can edit'));
      changed = false;
      await clip.caption(page, 'Saved: back to the HR group editing and the Users group viewing', 2400);
      await clip.close(page);
      failed = false;
    } finally {
      // An interrupted run leaves Can comment behind: the seed puts the group back to Can view.
      await cleanUp(failed, async () => {
        if (changed) await seedPermissionGallery(cfg);
      });
    }
  });

  test('view-group-reads-only: through the Users group, Alex can read an HR page but not edit it', async ({ browser, viewport }, testInfo) => {
    const cfg = config as GalleryConfig;
    const clip = startClip(browser, testInfo, fixture, viewport);
    const alex = fixture.people.alex;
    const directRow = async () =>
      (await readSpaceAssignments(cfg, fixture, 'HR')).members.find(
        (member) => member.user_uuid === alex.uuid && isOwnSpaceMemberRow(member)
      );
    let failed = true;

    // Setup (owner, API): Alex keeps HR only through the Users group, which has Can view there.
    await setDirectSpaceMember(cfg, fixture, 'HR', 'alex', false);
    try {
      await clip.check(null, 'setup: Alex is no longer a direct member of HR', async () =>
        expect(await directRow()).toBeUndefined()
      );
      await clip.check(null, 'setup: the Users group (with Alex in it) has Can view in HR', async () =>
        expect(
          (await readSpaceAssignments(cfg, fixture, 'HR')).groups.find((group) => group.group_id === fixture.groups.Users)
            ?.access_level_override
        ).toBe(CAN_VIEW)
      );
      await clip.check(null, 'server: Alex can read Onboarding checklist but not write it', () =>
        expect
          .poll(async () => pageCapability(cfg, fixture, 'alex', 'onboarding'))
          .toMatchObject({ can_read: true, can_write: false })
      );
      const page = await clip.open('alex', `/app/${fixture.workspaceId}/${fixture.pages.onboarding}`);
      // A reader makes no edits, so the app must never tell him about edits waiting for access.
      const noticeSeen = await watchPendingEditsNotice(page);
      const noNotice: NoticeWatch = { watching: true, seen: false, text: '' };
      const editor = page.locator('[data-slate-editor="true"]');

      await waitForApp(page);
      await clip.check(page, 'the page text is shown', () => expect(editor).toContainText('Welcome aboard'));
      await clip.caption(page, 'Alex (member) reaches HR only through the Users group, which can view');
      await clip.caption(page, 'He has opened Onboarding checklist in HR');
      await clip.check(page, 'the editor is read-only (contenteditable is false)', () =>
        expect(editor).toHaveAttribute('contenteditable', 'false')
      );
      await clip.check(page, 'the title is not editable (no title input)', () =>
        expect(page.getByTestId('page-title-input')).toHaveCount(0)
      );
      await page.getByTestId('view-meta-hover-area').hover();
      await page.waitForTimeout(700);
      await clip.check(page, 'no Add icon or cover buttons over the title', () =>
        expect(page.getByTestId('add-icon-button')).toHaveCount(0)
      );
      await editor.getByText('Welcome aboard!').hover();
      await page.waitForTimeout(700);
      await clip.check(page, 'no block handles (add or drag) beside the text', async () => {
        await expect(page.getByTestId('add-block')).toHaveCount(0);
        await expect(page.getByTestId('drag-block')).toHaveCount(0);
      });
      await clip.caption(page, 'No title editing, no block handles: the page is read-only');
      await clip.check(page, 'no notice about edits waiting for edit access since the page opened', async () => {
        expect(await noticeSeen()).toEqual(noNotice);
        await expect(page.locator(PENDING_EDITS_NOTICE)).toHaveCount(0);
      });
      await clip.caption(page, 'Alex clicks into the text and types "Hello"');
      const before = await editor.innerText();

      await editor.getByText('Welcome aboard!').click();
      // The pointer dot moves to the margin, so the line stays readable while he types.
      await page.mouse.move(1110, 360, { steps: 6 });
      await page.keyboard.type('Hello', { delay: 160 });
      await page.waitForTimeout(900);
      await clip.check(page, 'typing changed nothing on screen', async () => {
        await expect(editor).not.toContainText('Hello');
        expect(await editor.innerText()).toBe(before);
      });
      await clip.check(page, 'server: the document has no "Hello"', async () =>
        expect(JSON.stringify(await readPageDocument(cfg, fixture, 'olivia', 'onboarding'))).not.toContain('Hello')
      );
      await clip.caption(page, 'Nothing changed: Alex can read this page but not edit it', 2600);
      // The last moments on screen are watched too: hold, check, then close without another hold.
      await page.waitForTimeout(1800);
      await clip.check(page, 'no notice about edits waiting for edit access at any moment, typing included', async () => {
        expect(await noticeSeen()).toEqual(noNotice);
        await expect(page.locator(PENDING_EDITS_NOTICE)).toHaveCount(0);
      });
      await clip.close(page, 0);
      failed = false;
    } finally {
      // Teardown (owner, API): Alex is a direct HR member at the space default again, as seeded.
      await cleanUp(failed, async () => {
        await setDirectSpaceMember(cfg, fixture, 'HR', 'alex', true);
        await clip.check(null, 'teardown: Alex is a direct HR member at the space default again', async () => {
          const row = await directRow();

          expect(row?.role).toBe('member');
          expect(row?.access_level_override ?? null).toBeNull();
        });
        await clip.check(null, 'teardown: Alex can write Onboarding checklist again', () =>
          expect.poll(async () => (await pageCapability(cfg, fixture, 'alex', 'onboarding'))?.can_write).toBe(true)
        );
      });
    }
  });

  test('edit-group-edits: through the HR group, Sam edits an HR page and the edit is saved', async ({ browser, viewport }, testInfo) => {
    const cfg = config as GalleryConfig;
    const clip = startClip(browser, testInfo, fixture, viewport);
    const lines = () => readPageLines(cfg, fixture, 'onboarding');
    let failed = true;

    try {
      await clip.check(null, 'server: Sam can write Onboarding checklist (HR group: Can edit)', () =>
        expect.poll(async () => (await pageCapability(cfg, fixture, 'sam', 'onboarding'))?.can_write).toBe(true)
      );
      await clip.check(null, 'server: Sam is not a direct member of HR', async () =>
        expect(
          (await readSpaceAssignments(cfg, fixture, 'HR')).members.some(
            (member) => member.user_uuid === fixture.people.sam.uuid && isOwnSpaceMemberRow(member)
          )
        ).toBe(false)
      );
      await clip.check(null, 'server: the page holds only its seeded line', async () =>
        expect(await lines()).toEqual([ONBOARDING_TEXT])
      );
      const page = await clip.open('sam', `/app/${fixture.workspaceId}/${fixture.pages.onboarding}`);
      const editor = page.locator('[data-slate-editor="true"]');

      await waitForApp(page);
      await clip.check(page, 'the page text is shown', () => expect(editor).toContainText('Welcome aboard'));
      await clip.caption(page, 'Sam (member) reaches HR only through the HR group, which can edit');
      await clip.caption(page, 'He has opened Onboarding checklist in HR');
      await clip.check(page, 'the editor is editable (contenteditable is true)', () =>
        expect(editor).toHaveAttribute('contenteditable', 'true')
      );
      // What view-group-reads-only finds missing, looked for in the same way (same locators, hovers
      // and 700 ms pauses): its positive control. Each caption is up before the pointer moves.
      await clip.check(page, 'the title is editable (title input present)', () =>
        expect(page.getByTestId('page-title-input')).toBeVisible()
      );
      await clip.caption(page, 'Pointing at the title shows Add icon and Add cover', 0);
      await page.getByTestId('view-meta-hover-area').hover();
      await page.waitForTimeout(700);
      await clip.check(page, 'Add icon and Add cover buttons appear over the title', async () => {
        await expect(page.getByTestId('add-icon-button')).toBeVisible();
        await expect(page.getByTestId('view-meta-hover-area').getByRole('button', { name: 'Add cover' })).toBeVisible();
      });
      await page.waitForTimeout(1800);
      await clip.caption(page, 'Pointing at the text shows the block handles: the page is editable', 0);
      await editor.getByText('Welcome aboard!').hover();
      await page.waitForTimeout(700);
      await clip.check(page, 'block handles (add and drag) appear beside the text', async () => {
        await expect(page.getByTestId('hover-controls')).toHaveCSS('opacity', '1');
        await expect(page.getByTestId('add-block')).toBeVisible();
        await expect(page.getByTestId('drag-block')).toBeVisible();
      });
      await page.waitForTimeout(1800);
      await clip.caption(page, 'He adds a sentence under the first line');
      await editor.getByText('Welcome aboard!').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(SAM_SENTENCE, { delay: 70 });
      await clip.check(page, 'the sentence appears in the page', () => expect(editor).toContainText(SAM_SENTENCE));
      await clip.check(null, 'server: the sentence is saved as the second line', () =>
        expect.poll(lines, { timeout: 30000 }).toEqual([ONBOARDING_TEXT, SAM_SENTENCE])
      );
      await clip.caption(page, 'The server has it. Sam reloads the page');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      await clip.check(page, 'after the reload the sentence is still there', () => expect(editor).toContainText(SAM_SENTENCE));
      await clip.caption(page, 'After the reload the sentence is still there', 2400);

      await clip.caption(page, 'Cleanup: Sam deletes the sentence again');
      await editor.getByText(SAM_SENTENCE).click();
      await page.keyboard.press('End');
      await page.waitForTimeout(400);
      await page.keyboard.press('Shift+Home');
      await page.waitForTimeout(700);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);
      await page.keyboard.press('Backspace');
      await clip.check(page, 'the sentence is gone from the page', () => expect(editor).not.toContainText(SAM_SENTENCE));
      await clip.check(page, 'the original paragraph is unchanged', () => expect(editor).toContainText(ONBOARDING_TEXT));
      await clip.check(null, 'server: the page holds only its seeded line again', () =>
        expect.poll(lines, { timeout: 30000 }).toEqual([ONBOARDING_TEXT])
      );
      await clip.caption(page, 'The page is back as it was', 2400);
      await clip.close(page);
      failed = false;
    } finally {
      // After a failure the page can keep Sam's line, whole or half typed: the windows are closed,
      // and the owner puts the seeded text back through the API (see restorePageText).
      await cleanUp(failed, async () => {
        if (!failed) return;
        await clip.closeAll();
        // Leave time for an update sent just before a window closed to reach the server.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await restorePageText(cfg, fixture, 'onboarding');
        await clip.check(null, 'cleanup: the page holds only its seeded line', async () =>
          expect(await lines()).toEqual([ONBOARDING_TEXT])
        );
      });
    }
  });

  test('workspace-creation-control: who may create workspaces', async ({ browser, viewport }, testInfo) => {
    const cfg = config as GalleryConfig;
    const clip = startClip(browser, testInfo, fixture, viewport);
    const created = async () =>
      (await listGalleryWorkspaces(cfg, fixture, 'olivia')).filter((workspace) => workspace.workspace_name === NEW_WORKSPACE);

    let failed = true;

    // A workspace left by an interrupted run is removed first.
    for (const workspace of await created()) await deleteGalleryWorkspace(cfg, fixture, workspace.workspace_id);
    try {
      // (a) Sam: both creation entries of the workspace menu are unavailable, with the reason.
      const sam = await clip.open('sam', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

      await waitForApp(sam);
      await clip.caption(sam, 'Sam (member) opens the workspace menu');
      await press(sam, 'workspace-dropdown-trigger');
      const create = sam.getByTestId('create-workspace');
      const importWorkspace = sam.getByTestId('import-workspace-trigger');

      await clip.check(sam, 'Create workspace is marked unavailable (aria-disabled)', () =>
        expect(create).toHaveAttribute('aria-disabled', 'true')
      );
      await clip.check(sam, 'Import workspace is marked unavailable (aria-disabled)', () =>
        expect(importWorkspace).toHaveAttribute('aria-disabled', 'true')
      );
      await clip.caption(sam, 'Create workspace and Import workspace are unavailable to him');
      await create.hover();
      await clip.check(sam, `Create workspace explains: "${WORKSPACE_DENIED}"`, () =>
        expect(sam.getByRole('tooltip')).toHaveText(WORKSPACE_DENIED)
      );
      await clip.caption(sam, 'Pointing at Create workspace shows why', 2400);
      await importWorkspace.hover();
      await clip.check(sam, `Import workspace explains: "${WORKSPACE_DENIED}"`, async () => {
        await expect(sam.getByRole('tooltip')).toHaveCount(1);
        await expect(sam.getByRole('tooltip')).toHaveText(WORKSPACE_DENIED);
      });
      await clip.caption(sam, 'Import workspace gives the same reason', 2400);
      await clip.close(sam, 600);

      // (b) Jordan: no workspace, signs in, sees why and his pending guest invitation.
      const jordan = await clip.open('jordan', '/login', { signedOut: true });

      await expect(jordan.getByTestId('login-email-input')).toBeVisible({ timeout: 60000 });
      await jordan.waitForTimeout(1000);
      await clip.caption(jordan, 'Jordan has an account but no workspace. He signs in');
      await jordan.getByTestId('login-email-input').pressSequentially(GALLERY_PEOPLE.jordan.email, { delay: 60 });
      await press(jordan, 'login-password-button');
      await jordan.getByTestId('password-input').pressSequentially(cfg.password, { delay: 45 });
      await press(jordan, 'password-submit-button');
      await clip.check(jordan, '"You\'re not in a workspace yet" is shown', () =>
        expect(jordan.getByText("You're not in a workspace yet")).toBeVisible({ timeout: 60000 })
      );
      await clip.check(jordan, `the reason is shown: "${WORKSPACE_DENIED}"`, () =>
        expect(jordan.getByText(WORKSPACE_DENIED)).toBeVisible()
      );
      await clip.check(jordan, 'the pending invitation to Demo is shown with "Invited as a guest"', async () => {
        await expect(jordan.getByText(GALLERY_WORKSPACE_NAME, { exact: true })).toBeVisible();
        await expect(jordan.getByText('Invited as a guest', { exact: true })).toBeVisible();
      });
      await clip.check(null, 'server: Jordan has no workspace and one pending Guest invitation to Demo', async () => {
        expect(await listGalleryWorkspaces(cfg, fixture, 'jordan')).toEqual([]);
        const invitations = await fetch(`${cfg.cloud}/api/workspace/invite?status=Pending`, {
          headers: { Authorization: `Bearer ${fixture.people.jordan.auth.access_token}` },
        }).then((response) => response.json() as Promise<{ data?: { workspace_id: string; role?: unknown }[] }>);

        expect(invitations.data?.filter((item) => item.workspace_id === fixture.workspaceId).map((item) => item.role)).toEqual([
          'Guest',
        ]);
      });
      await jordan.mouse.move(640, 760, { steps: 6 });
      await clip.caption(jordan, "No workspace yet: why he can't create one, and his guest invitation to Demo", 3400);
      await clip.close(jordan, 600);

      // (c) Olivia, the one selected creator: creates a workspace and lands in it.
      const olivia = await clip.open('olivia', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

      await waitForApp(olivia);
      await clip.caption(olivia, 'Olivia is the one person the administrator allows to create workspaces');
      await press(olivia, 'workspace-dropdown-trigger');
      await clip.check(olivia, 'Create workspace is available to Olivia', () =>
        expect(olivia.getByTestId('create-workspace')).not.toHaveAttribute('aria-disabled', 'true')
      );
      await press(olivia, 'create-workspace');
      const name = olivia.getByLabel('Workspace name');

      await expect(name).toBeVisible();
      await olivia.waitForTimeout(700);
      await clip.check(olivia, '"You\'ll be the owner of the new workspace." is shown', () =>
        expect(olivia.getByText("You'll be the owner of the new workspace.")).toBeVisible()
      );
      await clip.caption(olivia, `She names it "${NEW_WORKSPACE}" and presses Create`);
      await name.fill('');
      await name.pressSequentially(NEW_WORKSPACE, { delay: 60 });
      const submit = olivia.getByRole('button', { name: 'Create', exact: true });

      await submit.hover();
      await olivia.waitForTimeout(450);
      await submit.click();
      await clip.check(olivia, 'the workspace menu now shows the new workspace', () =>
        expect(olivia.getByTestId('workspace-dropdown-trigger')).toContainText(NEW_WORKSPACE, { timeout: 60000 })
      );
      let createdId = '';

      await clip.check(null, 'server: Olivia has exactly one new workspace with that name', async () => {
        const rows = await created();

        expect(rows).toHaveLength(1);
        createdId = rows[0].workspace_id;
      });
      await clip.check(olivia, 'the address is in the new workspace', () => expect(olivia).toHaveURL(new RegExp(`/app/${createdId}`)));
      await olivia.mouse.move(900, 500, { steps: 6 });
      await clip.caption(olivia, 'Created: Olivia is now in her new workspace', 3000);
      await clip.close(olivia);
      failed = false;
    } finally {
      // Cleanup (owner, API): the new workspace is deleted.
      await cleanUp(failed, async () => {
        for (const workspace of await created()) await deleteGalleryWorkspace(cfg, fixture, workspace.workspace_id);
        await clip.check(null, 'cleanup: the new workspace is deleted', async () => expect(await created()).toEqual([]));
      });
    }
  });

  test('space-creation-control: the owner narrows who can create spaces', async ({ browser, viewport }, testInfo) => {
    const cfg = config as GalleryConfig;
    const clip = startClip(browser, testInfo, fixture, viewport);
    const spaceNames = async () => {
      const response = await fetch(`${cfg.cloud}/api/workspace/${fixture.workspaceId}/spaces`, {
        headers: { Authorization: `Bearer ${fixture.people.olivia.auth.access_token}` },
      });
      const body = (await response.json()) as { data?: { spaces?: { name: string }[] } };

      return (body.data?.spaces ?? []).map((space) => space.name);
    };

    // Alex's live connection is relayed; from the owner's change on, server pushes are held back.
    const realtime: GalleryRealtime = { muted: false };
    let failed = true;

    try {
      await clip.check(null, 'server: owners and selected members may create spaces; Alex may', async () => {
        const capability = await spaceCreationCapability(cfg, fixture, 'alex');

        expect(capability?.policy).toBe('owners_and_selected_members');
        expect(capability?.can_create_space).toBe(true);
      });
      await clip.check(null, `server: no space is called ${NEW_SPACE}`, async () =>
        expect(await spaceNames()).not.toContain(NEW_SPACE)
      );
      const alex = await clip.open('alex', `/app/${fixture.workspaceId}/${fixture.pages.roadmap}`, { realtime });

      await waitForApp(alex);
      await expect(alex.locator('[data-slate-editor="true"]')).toContainText('Three themes for next year');
      await clip.caption(alex, 'Alex (member) may create spaces. He opens New page > Create space');
      await press(alex, 'new-page-button');
      await alex.waitForTimeout(700);
      await press(alex, 'new-page-create-space-button');
      await alex.getByTestId('space-name-input').pressSequentially(NEW_SPACE, { delay: 90 });
      await clip.check(alex, 'Create is enabled for Alex', () => expect(alex.getByTestId('create-space-submit')).toBeEnabled());
      await clip.caption(alex, `He names the space "${NEW_SPACE}" and leaves the dialog open`, 2200);
      realtime.muted = true;

      const olivia = await clip.open('olivia', `/app/${fixture.workspaceId}/${fixture.pages.handbook}`);

      await waitForApp(olivia);
      await clip.caption(olivia, 'Meanwhile Olivia (owner) opens Settings > Permissions');
      await press(olivia, 'workspace-dropdown-trigger');
      await press(olivia, 'settings-button');
      await expect(olivia.getByTestId('settings-dialog')).toBeVisible();
      await olivia.waitForTimeout(600);
      await press(olivia, 'settings-menu-permissions');
      await clip.check(olivia, 'Owners and selected members is the current choice', () =>
        expect(olivia.getByTestId('space-creation-policy-owners_and_selected_members')).toHaveAttribute('aria-pressed', 'true')
      );
      await clip.check(olivia, 'the selected members and groups are listed: Alex and Super_Users', async () => {
        await expect(olivia.getByTestId(`space-creator-row-user-${fixture.people.alex.uuid}`)).toBeVisible();
        await expect(olivia.getByTestId(`space-creator-row-group-${fixture.groups.Super_Users}`)).toBeVisible();
        await expect(olivia.getByText("We couldn't load the selected members and groups.")).toHaveCount(0);
      });
      await clip.caption(olivia, 'She sets Who can create spaces to Owners only');
      await press(olivia, 'space-creation-policy-owners_only');
      const confirmation = olivia.getByTestId('space-creation-restrict-confirmation');

      await clip.check(olivia, 'the question before narrowing is shown', () => expect(confirmation).toBeVisible());
      await clip.caption(olivia, 'The app asks first; she confirms', 2400);
      await press(olivia, 'space-creation-restrict-confirm');
      await clip.check(olivia, 'toast "Space creation updated"', () => expect(toast(olivia, 'Space creation updated')).toBeVisible());
      await clip.check(olivia, 'Owners only is now the selected choice', () =>
        expect(olivia.getByTestId('space-creation-policy-owners_only')).toHaveAttribute('aria-pressed', 'true')
      );
      await clip.check(null, 'server: the policy is Owners only and Alex may not create spaces', () =>
        expect
          .poll(async () => spaceCreationCapability(cfg, fixture, 'alex'))
          .toMatchObject({ policy: 'owners_only', can_create_space: false })
      );
      await clip.caption(olivia, 'Saved: only owners can create spaces now', 2400);
      await clip.close(olivia, 600);

      await clip.caption(alex, 'Back to Alex: the harness held back the live update, so Create is still offered', 2800);
      await clip.check(alex, 'Alex\'s dialog still offers Create (the live update was held back)', () =>
        expect(alex.getByTestId('create-space-submit')).toBeEnabled()
      );
      await clip.caption(alex, 'He presses Create; the app checks with the server first');
      await press(alex, 'create-space-submit');
      const denied = alex.getByTestId('create-space-denied');

      await clip.check(alex, `the answer is shown: "${SPACE_DENIED}"`, async () => {
        await expect(denied).toBeVisible();
        await expect(denied).toContainText(SPACE_DENIED);
      });
      await clip.check(alex, 'the form and Create are gone; Close is the only action', async () => {
        await expect(alex.getByTestId('space-name-input')).toHaveCount(0);
        await expect(alex.getByTestId('create-space-submit')).toHaveCount(0);
        await expect(alex.getByTestId('create-space-denied-close')).toBeVisible();
      });
      await clip.caption(alex, "Refused: he can't create spaces in this workspace any more", 2800);
      await press(alex, 'create-space-denied-close');
      await clip.check(alex, 'Close hides the dialog', () => expect(alex.getByTestId('create-space-modal')).toBeHidden());
      await clip.check(null, `server: no space called ${NEW_SPACE} was created`, async () =>
        expect(await spaceNames()).not.toContain(NEW_SPACE)
      );
      await clip.caption(alex, 'New page now offers Create space as unavailable, with the reason');
      await press(alex, 'new-page-button');
      await clip.check(alex, 'Create space is disabled in New page', () =>
        expect(alex.getByTestId('new-page-create-space-button')).toBeDisabled()
      );
      await clip.check(alex, `New page shows the reason: "${SPACE_DENIED}"`, () => expect(alex.getByText(SPACE_DENIED)).toBeVisible());
      await clip.close(alex, 2600);
      failed = false;
    } finally {
      // Restore the seed's rule (owner, API) and read it back.
      await cleanUp(failed, async () => {
        await setSpaceCreationPolicy(cfg, fixture, 'owners_and_selected_members');
        realtime.muted = false;
        await clip.check(null, 'cleanup: the policy is Owners and selected members again and Alex may create spaces', () =>
          expect
            .poll(async () => spaceCreationCapability(cfg, fixture, 'alex'))
            .toMatchObject({ policy: 'owners_and_selected_members', can_create_space: true })
        );
      });
    }
  });
});
