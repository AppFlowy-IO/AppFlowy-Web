import { Page, APIRequestContext, expect } from '@playwright/test';

import { signInAndCreateDatabaseView } from './database-ui-helpers';
import { seedProSubscriptionForUser } from './pro-seed-helpers';
import {
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  FormSelectors,
} from './selectors';

/**
 * Field-type ids used by the form question type picker. Mirrors the
 * `FieldType` enum in `src/application/database-yjs/database.type.ts`
 * and the `formQuestionFieldTypes` allow-list in
 * `FormQuestionTypePicker.tsx`. Adding a new type to the picker means
 * adding it here too — otherwise tests can't request it by name.
 */
export const FormFieldType = {
  RichText: 0,
  Number: 1,
  DateTime: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  Checkbox: 5,
  URL: 6,
  Media: 14,
} as const;

export type FormFieldTypeName = keyof typeof FormFieldType;

/**
 * Sign in, create a default Grid, then add a Form view via the tab-bar
 * `+` button. Returns the page focused on the new Form view.
 *
 * Web has no sidebar-create-Form path (the `+` page menu only ships
 * Grid / Board / Calendar / Chart) so every form scenario starts with
 * a Grid and layers a linked Form on top. This is the same posture as
 * the desktop's `form_from_tab_bar.feature`.
 *
 * The Pro-plan gate is bypassed by Vite DEV mode
 * (`useCanAuthorFormView`), so freshly-registered Free-plan users can
 * still reach the Form authoring UI under `pnpm dev`. The cloud's
 * server-side share-mint gate still applies — share-popover scenarios
 * either need a Pro seed or should target only the local builder
 * (preview, add-question, question card) which doesn't touch the
 * cloud share endpoint.
 */
export async function signInAndAddFormViewViaTabBar(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await signInAndCreateDatabaseView(page, request, email, 'Grid', {
    verify: async (p) => {
      await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({
        timeout: 10000,
      });
    },
  });
  await addFormViewToTabBar(page);
}

/**
 * Sign in, seed Pro on the workspace, then layer a Form view on the
 * starter Grid via the tab bar. Required for any scenario that needs
 * the cloud's form-share endpoints to succeed — Free workspaces are
 * refused by `is_workspace_on_paid_plan` and would leave the popover
 * stuck on `errorKind: 'plan_required'`.
 *
 * The Pro seed happens AFTER signin (so the user + workspace rows
 * exist) but BEFORE the Form-view add (which is the first action the
 * cloud gate evaluates).
 */
export async function signInAddProAndOpenForm(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await signInAndCreateDatabaseView(page, request, email, 'Grid', {
    verify: async (p) => {
      await expect(p.locator('[class*="appflowy-database"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(DatabaseViewSelectors.viewTab(p).first()).toBeVisible({
        timeout: 10000,
      });
    },
  });
  await seedProSubscriptionForUser(email);
  await addFormViewToTabBar(page);
}

/**
 * Click the database tab-bar `+` button and pick `Form` from the
 * dropdown. Waits for the form-builder toolbar to mount so subsequent
 * actions don't race the layout swap.
 *
 * If the auto-create modal fires (it does whenever the underlying
 * database has > 2 supported fields, i.e. always for a default Grid
 * w/ Name/Type/Done), dismiss it via Start-from-scratch so callers
 * land on an empty form. Scenarios that want to exercise the modal
 * itself should use `addFormViewToTabBarRaw` instead and assert on
 * `FormSelectors.autoCreateDialog`.
 */
export async function addFormViewToTabBar(page: Page): Promise<void> {
  await addFormViewToTabBarRaw(page);
  await dismissAutoCreateDialogIfPresent(page);
}

/**
 * Same as `addFormViewToTabBar` but does NOT dismiss the auto-create
 * modal — exposes the same posture the desktop's
 * `form_from_tab_bar.feature` asserts on.
 */
export async function addFormViewToTabBarRaw(page: Page): Promise<void> {
  const addBtn = DatabaseViewSelectors.addViewButton(page);
  await addBtn.scrollIntoViewIfNeeded();
  await expect(addBtn).toBeVisible({ timeout: 10000 });
  await addBtn.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await FormSelectors.addFormViewOption(page).click({ force: true });

  // FormBuilderView's toolbar mounts after the layout swap. The Preview
  // button is mounted unconditionally in the authoring header, so
  // anchoring on it gives a deterministic "form layout is active" signal.
  await expect(FormSelectors.previewButton(page)).toBeVisible({ timeout: 15000 });
}

/**
 * Dismiss the auto-create modal via Start-from-scratch if it's mounted.
 * No-op if the modal isn't present (e.g. database has ≤ 2 supported
 * fields, so `FormAutoCreate` silent-seeds instead of prompting).
 *
 * Bounded poll — gives the modal up to 2s to mount after the layout
 * swap. The hydration sentinel inside `FormAutoCreate` (a one-render
 * `useEffect`) usually settles within a single frame, but slow CI
 * machines may need a moment longer.
 */
async function dismissAutoCreateDialogIfPresent(page: Page): Promise<void> {
  const dialog = FormSelectors.autoCreateDialog(page);

  try {
    await dialog.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    return; // Dialog never mounted — silent-seed path; nothing to dismiss.
  }
  await FormSelectors.autoCreateStartFromScratch(page).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

/**
 * Open the question-type picker and pick a New-question field type.
 * Always targets the "New question" section (not Existing properties)
 * by going through the type-specific testid.
 *
 * Returns after the picker closes and the new question card appears.
 */
export async function addFormQuestion(
  page: Page,
  type: FormFieldTypeName,
): Promise<void> {
  const before = await FormSelectors.questionCards(page).count();
  await FormSelectors.addQuestionButton(page).click();
  await FormSelectors.questionTypeOption(page, FormFieldType[type]).click();
  // New card propagation: addQuestion writes to the YJS snapshot, the
  // FormBuilderView re-renders, and the card mounts. Wait for the card
  // count to grow rather than a fixed sleep so we don't race the YJS
  // event loop on slow CI.
  await expect(FormSelectors.questionCards(page)).toHaveCount(before + 1, {
    timeout: 10000,
  });
}

/**
 * Open the live preview dialog. The preview is local-only — schema is
 * built from the YJS snapshot, no cloud round-trip — so this works on
 * any plan tier.
 */
export async function openFormPreview(page: Page): Promise<void> {
  await FormSelectors.previewButton(page).click();
  await expect(FormSelectors.previewDialog(page)).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Dismiss the preview dialog. MUI's Dialog responds to Escape; we use
 * it instead of clicking a close glyph because the dialog has no
 * dedicated close button (the user clicks the backdrop on desktop).
 */
export async function closeFormPreview(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(FormSelectors.previewDialog(page)).toBeHidden({ timeout: 5000 });
}

/**
 * Open the 3-dot menu on the Nth question card and click a labeled
 * menu row (Required / Description / Long answer / Move up / Move down
 * / Remove from form). The Radix dropdown closes itself on `onSelect`
 * for navigation actions but stays open for toggle rows (which call
 * `e.preventDefault()`) — wait briefly after the click so the YJS
 * observer has time to fan out the state change before the caller
 * polls a `data-*` attribute.
 */
export async function toggleQuestionMenuItem(
  page: Page,
  questionIndex: number,
  label: string,
): Promise<void> {
  await FormSelectors.questionMenuTriggerAt(page, questionIndex).click();
  // Radix renders menus in a portal — scope the lookup to the open
  // menu surface so we don't match a stray duplicate (e.g. the
  // tab-bar `+` picker if it's still mounted).
  const menu = page.locator('[role="menu"]').first();

  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.getByRole('menuitem', { name: label }).click();
  // Toggle rows preventDefault — close the dropdown explicitly so the
  // next interaction (e.g. clicking the add-question button) isn't
  // blocked by the menu's outside-click guard.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden({ timeout: 5000 });
}

// ── Share popover actions ───────────────────────────────────────────

/**
 * Open the share popover from the toolbar. Waits for either the share
 * controls (Pro path) or the upgrade prompt (Free path) to appear so
 * the caller doesn't race the bootstrap.
 *
 * Distinct "fully bootstrapped" anchor: the popover surface flashes
 * the loading skeleton during the GET / mint round-trip; clicks on the
 * skeleton can't navigate to actual controls. After the popover
 * mounts, wait until either the share controls OR the upgrade prompt
 * land before returning — both indicate the bootstrap settled.
 */
export async function openSharePopover(page: Page): Promise<void> {
  await FormSelectors.shareButton(page).click();
  // First wait — popover surface exists at all.
  await expect(page.locator('[data-slot="popover-content"]').first()).toBeVisible({
    timeout: 10000,
  });
  // Second wait — bootstrap settled. Race the two terminal states so
  // either branch unblocks the caller. The loading skeleton is
  // explicitly NOT a settled state.
  //
  // Anchor on the Anonymous toggle (rows path) and the upgrade prompt
  // (Free path) — both are mounted exclusively, with the skeleton in
  // between. Once one of them appears the bootstrap has resolved.
  await page.waitForFunction(
    () => {
      const upgrade = document.querySelector(
        '[data-testid="form-share-popover-upgrade-prompt"]',
      );
      const rows = document.querySelector(
        '[data-testid="form-share-anonymous-toggle"]',
      );

      return !!(upgrade || rows);
    },
    undefined,
    { timeout: 15000 },
  );
}

/**
 * Select a tier (Workspace / Public / Closed) from the share popover's
 * "Who can fill out" submenu. Each row mutates the cloud token via
 * `patchFormShare` and refreshes `info` on success.
 *
 * Anchors on per-choice testids (`form-share-tier-choice-*`) because
 * the popover's submission-access row also surfaces "No access" copy
 * — a visible-text query would be ambiguous for the `closed` tier.
 */
export async function selectShareTier(
  page: Page,
  tier: 'workspace' | 'public' | 'closed',
): Promise<void> {
  await page.getByRole('button', { name: /Who can fill out/i }).click();
  const choice = page.getByTestId(`form-share-tier-choice-${tier}`);

  await expect(choice).toBeVisible({ timeout: 5000 });
  await choice.click();
  // Wait briefly for the patch round-trip to settle so the next step
  // sees the new `info` and `data-tier` reflects the choice.
  await page.waitForTimeout(800);
}

/**
 * Click the Anonymous toggle in the share popover. Radix's `<Switch>`
 * renders as a button with `role="switch"`; the per-row `data-testid`
 * we added gives us a stable handle without depending on the visible
 * label (which is wrapped in a span sibling).
 *
 * Server-side `useFormShare.setAnonymous` short-circuits when
 * `tier === 'public'` (cloud forces it). For Workspace tier, toggling
 * Anonymous ON auto-promotes the tier to Public per the
 * "promotePublic" rule — caller should assert on `data-tier` after
 * to verify the promotion.
 */
export async function toggleAnonymousSwitch(page: Page): Promise<void> {
  await page.getByTestId('form-share-anonymous-toggle').click();
  // YJS observer + patch round-trip — wait for the banner to reflect
  // the new state rather than a fixed sleep.
  await page.waitForTimeout(800);
}

/**
 * Read the share URL out of the popover's read-only input. The cloud's
 * `share_url` field is empty when `APPFLOWY_WEB_URL` isn't configured;
 * the popover's `resolveShareUrl` falls back to `${origin}/form/${token}`
 * in that case, which is what we read here.
 */
export async function readShareUrl(page: Page): Promise<string> {
  const input = page.locator('input[readonly]').first();

  await expect(input).toBeVisible({ timeout: 10000 });
  const url = await input.inputValue();

  if (!url) throw new Error('share URL is empty');
  return url;
}

/**
 * Visit the public share URL in a FRESH BrowserContext so the request
 * is truly anonymous (no shared cookies / no `Authorization` header
 * carried from the authoring tab). Returns the new page so callers can
 * scope assertions to it without interfering with the authoring tab.
 *
 * Sharing the existing `page.context()` would make the request appear
 * as the authoring user — for Workspace-tier forms the cloud would
 * then return `kind: 'active'` (member!) instead of `auth_required`,
 * defeating the whole point of the access-level scenarios.
 *
 * The caller is responsible for closing the returned context when the
 * scenario finishes; Playwright tears down all contexts at test end
 * automatically so for one-shot scenario use the explicit cleanup is
 * optional.
 */
export async function openSharePageInNewTab(
  page: Page,
  shareUrl: string,
): Promise<Page> {
  const browser = page.context().browser();

  if (!browser) {
    throw new Error('no browser instance — cannot create anonymous context');
  }

  const anonymousContext = await browser.newContext();
  const newTab = await anonymousContext.newPage();

  await newTab.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  return newTab;
}

/**
 * Visit the public share URL in a new tab on the SAME BrowserContext
 * so the request carries the authoring user's session cookies. This
 * is the path that exercises identified Respondent stamping: for a
 * Workspace-tier form with anonymous=false, the cloud reads the
 * caller's GoTrue session, looks up the workspace member, and stamps
 * the new submission row's Respondent column with that user's
 * Person reference. Manual repro on /form/<token>: image #48 shows
 * "Nathan Foo" once Anonymous toggle is OFF and the respondent is a
 * workspace member.
 */
export async function openSharePageInSameContext(
  page: Page,
  shareUrl: string,
): Promise<Page> {
  const newTab = await page.context().newPage();

  await newTab.goto(shareUrl, { waitUntil: 'domcontentloaded' });
  return newTab;
}

/**
 * Switch back to the form's Responses Grid tab and return the count of
 * "real" rows (i.e. rows the user has filled — excludes the "add new
 * row" placeholder cell). Used to verify a submission ended up in the
 * underlying database.
 *
 * Anchors on the row container so the count reflects what's painted,
 * not the YJS state — which is the user-visible truth we want.
 */
export async function countGridRows(page: Page): Promise<number> {
  // Switch to the Grid (index 0). The Form view was added as a
  // sibling of the starter Grid, so flipping to the first tab puts
  // us on the database's actual storage. `grid-row-*` testids on
  // each rendered row let us count without depending on cell-per-row
  // arithmetic.
  const tabs = DatabaseViewSelectors.viewTab(page);

  await tabs.first().click();
  await page.waitForTimeout(500);
  return DatabaseGridSelectors.rows(page).count();
}

/**
 * Wait until the grid renders at least `expected` rows. The collab
 * stream is asynchronous — a fresh public-form submission lands in the
 * cloud, fans out via the YJS WebSocket, and the React tree commits
 * the new row. That round-trip can take 1-3 seconds on a healthy local
 * stack; we poll up to 15s before giving up.
 *
 * Returns the final count once met (or the timed-out count for nicer
 * test failures).
 */
export async function waitForGridRowCount(
  page: Page,
  expected: number,
): Promise<number> {
  await page.waitForFunction(
    (target) => {
      const rows = document.querySelectorAll('[data-testid^="grid-row-"]');

      return rows.length >= target;
    },
    expected,
    { timeout: 15000 },
  );
  return DatabaseGridSelectors.rows(page).count();
}

/**
 * Find the grid row whose Name (first data cell) contains
 * `nameSubstring`, read its Respondent cell text, and return it. The
 * Respondent column is the rightmost data cell — its visible text is
 * either `Anonymous` (nil-UUID sentinel) or the workspace member's
 * display name doubled with the avatar initial (e.g. `NNathan Foo`).
 *
 * Polls up to 10s — submissions ride the YJS collab stream back to
 * the authoring tab, which can lag a beat behind the cloud's
 * persistence.
 */
export async function readRespondentForRowByName(
  page: Page,
  nameSubstring: string,
): Promise<string> {
  return page.waitForFunction(
    (substr) => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid^="grid-row-"]'),
      );

      for (const row of rows) {
        const cells = row.querySelectorAll('[data-testid^="grid-cell-"]');

        if (cells.length === 0) continue;
        // Scan every cell for the submission's text — a Form-added
        // question creates a new database field at the end of the
        // column order, so the submission can land in any cell.
        let matched = false;

        for (let i = 0; i < cells.length; i += 1) {
          if (cells[i].textContent?.includes(substr)) {
            matched = true;
            break;
          }
        }

        if (!matched) continue;
        // Find the Person cell within this row. The Person field
        // type renders an inner `<div data-testid="person-cell-…">`
        // wrapper that's unique to Person columns — the Respondent
        // field is a Person field seeded by `make_default_form`, so
        // there's exactly one per row. Anchoring on this testid
        // is more robust than "last grid-cell" because additional
        // Form question fields push Respondent out of the last
        // position.
        const personCell = row.querySelector('[data-testid^="person-cell-"]');

        if (!personCell) continue;
        return personCell.textContent ?? '';
      }

      return false;
    },
    nameSubstring,
    { timeout: 15000 },
  ).then((handle) => handle.jsonValue() as Promise<string>);
}
