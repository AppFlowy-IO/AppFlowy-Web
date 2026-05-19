import { Page, APIRequestContext, expect } from '@playwright/test';

import { signInAndCreateDatabaseView } from './database-ui-helpers';
import {
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
