import { Page, APIRequestContext, expect } from '@playwright/test';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  BoardSelectors,
  FieldType,
  PageSelectors,
  PropertyMenuSelectors,
  GridFieldSelectors,
} from './selectors';
import { signInAndWaitForApp } from './auth-flow-helpers';

export type DatabaseViewType = 'Grid' | 'Board' | 'Calendar' | 'Chart';

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
  await expect(
    page.locator('[data-testid="inline-add-page"], [data-testid="new-page-button"]').first()
  ).toBeVisible({ timeout: 20000 });
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
  // Try inline add button first, fallback to new page button
  const inlineAddCount = await AddPageSelectors.inlineAddButton(page).count();
  if (inlineAddCount > 0) {
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  } else {
    const newPageCount = await PageSelectors.newPageButton(page).count();
    if (newPageCount > 0) {
      await PageSelectors.newPageButton(page).first().click({ force: true });
    } else {
      // Wait for UI to stabilize and retry
      await page.waitForTimeout(3000);
      await expect(AddPageSelectors.inlineAddButton(page).first()).toBeVisible({ timeout: 15000 });
      await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    }
  }

  await page.waitForTimeout(1000);

  // Click the appropriate view type button
  if (viewType === 'Grid') {
    await AddPageSelectors.addGridButton(page).click({ force: true });
  } else if (viewType === 'Board') {
    await page.locator('[role="menuitem"]').filter({ hasText: 'Board' }).click({ force: true });
  } else if (viewType === 'Calendar') {
    await page.locator('[role="menuitem"]').filter({ hasText: 'Calendar' }).click({ force: true });
  } else if (viewType === 'Chart') {
    await AddPageSelectors.addChartButton(page).click({ force: true });
  }

  await page.waitForTimeout(createWaitMs);
}

/**
 * Add a new property column to the grid and change its type.
 * Robust version with retry and fallback via field header context menu.
 * Matches Cypress flow: click newPropertyButton → propertyTypeTrigger → select type.
 */
export async function addPropertyColumn(
  page: Page,
  fieldType: number
): Promise<void> {
  // Click new property button via JS click to bypass the footer bar that covers it.
  // dispatchEvent('click') would bubble and create duplicates, so use evaluate instead.
  await PropertyMenuSelectors.newPropertyButton(page).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="grid-new-property-button"]');
    if (el) (el as HTMLElement).click();
  });
  await page.waitForTimeout(2000);

  // Wait for property-type-trigger (auto-opened PropertyMenu from setActivePropertyId)
  const trigger = PropertyMenuSelectors.propertyTypeTrigger(page).first();
  try {
    await expect(trigger).toBeVisible({ timeout: 5000 });
  } catch {
    // Fallback: open PropertyMenu via field header context menu → "Edit Property"
    await GridFieldSelectors.allFieldHeaders(page).last().click({ force: true });
    await page.waitForTimeout(1000);

    const editProp = PropertyMenuSelectors.editPropertyMenuItem(page);
    if (await editProp.count() > 0) {
      await editProp.click({ force: true });
      await page.waitForTimeout(1000);
    }

    await expect(trigger).toBeVisible({ timeout: 5000 });
  }

  // Change field type
  await trigger.click({ force: true });
  await page.waitForTimeout(1000);
  await PropertyMenuSelectors.propertyTypeOption(page, fieldType).click({ force: true });

  if (fieldType === FieldType.Relation) {
    // After commit ee602e8b, picking the Relation option opens
    // RelationCreationDialog instead of switching directly. Auto-pick the
    // first candidate database so this helper still produces a usable
    // Relation column for tests that don't care which database it points to.
    const dialog = page.getByTestId('relation-creation-dialog');

    await expect(dialog).toBeVisible({ timeout: 15000 });
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
