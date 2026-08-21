import { Page, APIRequestContext, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  BoardSelectors,
  FieldType,
  PropertyMenuSelectors,
  GridFieldSelectors,
} from './selectors';
import { signInAndWaitForApp } from './auth-flow-helpers';

export type DatabaseViewType = 'Grid' | 'Board' | 'Calendar' | 'Chart' | 'List' | 'Gallery';

interface CreateDatabaseViewOptions {
  appReadyWaitMs?: number;
  createWaitMs?: number;
  verify?: (page: Page) => Promise<void>;
}

/**
 * Wait until the app shell is ready for creating/opening pages.
 * Playwright equivalent of cypress/support/database-ui-helpers.ts waitForAppReady
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for either inline-add-page or new-page-button to be visible
  await expect(page.locator('[data-testid="inline-add-page"], [data-testid="new-page-button"]').first()).toBeVisible({
    timeout: 20000,
  });
}

/**
 * Wait until a grid database is rendered and has at least one cell.
 * Playwright equivalent of cypress/support/database-ui-helpers.ts waitForGridReady
 */
export async function waitForGridReady(page: Page): Promise<void> {
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });
  await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible({ timeout: 30000 });
}

/**
 * Create a database view from the add-page menu.
 * Playwright equivalent of cypress/support/database-ui-helpers.ts createDatabaseView
 */
export async function createDatabaseView(
  page: Page,
  viewType: DatabaseViewType,
  createWaitMs: number = 5000
): Promise<void> {
  // Hydration can briefly leave hidden/stale inline buttons in the outline.
  // Only target visible buttons and retry until the actual layout action menu
  // is mounted; otherwise the subsequent layout click can wait on a menu that
  // was never opened.
  const visibleInlineAddButtons = page.locator('[data-testid="inline-add-page"]:visible');
  let addPageActionsOpen = false;

  if ((await visibleInlineAddButtons.count()) === 0) {
    const newPageButton = page.locator('[data-testid="new-page-button"]:visible').first();

    await expect(newPageButton).toBeVisible({ timeout: 15_000 });
    await newPageButton.click();

    // The alternate shell trigger opens the space-selection modal rather than
    // AddPageActions directly. Create a disposable document in the isolated
    // test workspace, then use its hydrated outline action to open the layout
    // menu. This preserves the pre-existing fallback without assuming that the
    // modal itself contains database layout actions.
    const newPageModal = page.getByTestId('new-page-modal');

    await expect(newPageModal).toBeVisible({ timeout: 10_000 });
    await newPageModal.getByTestId('space-item').first().click();
    await newPageModal.getByTestId('modal-ok-button').click();
    await expect(newPageModal).toBeHidden({ timeout: 15_000 });
  }

  for (let attempt = 0; attempt < 3 && !addPageActionsOpen; attempt += 1) {
    await expect(visibleInlineAddButtons.first()).toBeVisible({ timeout: 15_000 });
    const buttonCount = await visibleInlineAddButtons.count();
    const button = visibleInlineAddButtons.nth(Math.min(attempt, buttonCount - 1));

    await button.click({ force: true });
    addPageActionsOpen = await AddPageSelectors.addDocumentButton(page)
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);

    if (!addPageActionsOpen) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }

  await expect(AddPageSelectors.addDocumentButton(page)).toBeVisible({ timeout: 10_000 });

  // Click the appropriate view type button
  if (viewType === 'Grid') {
    await AddPageSelectors.addGridButton(page).click({ force: true });
  } else if (viewType === 'Board') {
    await page.locator('[role="menuitem"]').filter({ hasText: 'Board' }).click({ force: true });
  } else if (viewType === 'Calendar') {
    await page.locator('[role="menuitem"]').filter({ hasText: 'Calendar' }).click({ force: true });
  } else if (viewType === 'Chart') {
    await AddPageSelectors.addChartButton(page).click({ force: true });
  } else if (viewType === 'List') {
    await AddPageSelectors.addListButton(page).click({ force: true });
  } else if (viewType === 'Gallery') {
    await AddPageSelectors.addGalleryButton(page).click({ force: true });
  }

  await page.waitForTimeout(createWaitMs);
}

/**
 * Add a new property column to the grid and change its type.
 * Robust version with retry and fallback via field header context menu.
 * Matches Cypress flow: click newPropertyButton → propertyTypeTrigger → select type.
 */
export async function addPropertyColumn(page: Page, fieldType: number): Promise<void> {
  // A grouped or recently rerendered Grid can retain multiple mounted controls.
  // Use the newest/topmost control and dispatch directly to it so a sticky footer
  // cannot intercept the coordinate-based click.
  const newPropertyButton = PropertyMenuSelectors.newPropertyButton(page).last();

  await newPropertyButton.scrollIntoViewIfNeeded();
  await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
  await page.waitForTimeout(2000);

  // Wait for property-type-trigger (auto-opened PropertyMenu from setActivePropertyId)
  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).last();
  try {
    await expect(trigger).toBeVisible({ timeout: 5000 });
  } catch {
    // Fallback: open PropertyMenu via field header context menu → "Edit Property"
    await GridFieldSelectors.allFieldHeaders(page).last().click({ force: true });
    await page.waitForTimeout(1000);

    const editProp = PropertyMenuSelectors.editPropertyMenuItem(page);
    if ((await editProp.count()) > 0) {
      await editProp.click({ force: true });
      await page.waitForTimeout(1000);
    }

    await expect(trigger).toBeVisible({ timeout: 5000 });
  }

  // Change field type through the topmost submenu. The newly inserted column can
  // still be animating, so dispatch directly once the option is mounted.
  await trigger.hover({ force: true });
  const typeOption = PropertyMenuSelectors.propertyTypeOption(page, fieldType).last();

  await typeOption.waitFor({ state: 'attached', timeout: 10_000 });
  await typeOption.evaluate((element) => (element as HTMLElement).click());

  if (fieldType === FieldType.Relation) {
    // After commit ee602e8b, picking the Relation option opens
    // RelationCreationDialog instead of switching directly. Auto-pick the
    // first candidate database so this helper still produces a usable
    // Relation column for tests that don't care which database it points to.
    const dialog = page.getByTestId('relation-creation-dialog');

    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The target list lives behind a dropdown trigger (desktop parity with
    // `AFDropDownMenu`), so open it before the candidates exist in the DOM.
    const databaseTrigger = page.getByTestId('relation-database-trigger');

    await expect(databaseTrigger).toBeVisible({ timeout: 15000 });
    await databaseTrigger.click({ force: true });

    const firstCandidate = page.locator('[data-testid^="relation-candidate-"]').first();

    await expect(firstCandidate).toBeVisible({ timeout: 15000 });
    await firstCandidate.click({ force: true });
    await page.getByTestId('modal-ok-button').last().click({ force: true });
    await expect(dialog).toBeHidden({ timeout: 15000 });
  } else {
    await page.waitForTimeout(2000);
    // Close menus
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
}

/**
 * Sign in, wait for app shell, then create a database view.
 * Playwright equivalent of cypress/support/database-ui-helpers.ts signInAndCreateDatabaseView
 */
export async function signInAndCreateDatabaseView(
  page: Page,
  request: APIRequestContext,
  testEmail: string,
  viewType: DatabaseViewType,
  options?: CreateDatabaseViewOptions
): Promise<void> {
  const appReadyWaitMs = options?.appReadyWaitMs ?? 3000;
  const createWaitMs = options?.createWaitMs ?? 5000;

  await signInAndWaitForApp(page, request, testEmail);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(appReadyWaitMs);
  await createDatabaseView(page, viewType, createWaitMs);
  if (options?.verify) {
    await options.verify(page);
  }
}
