/**
 * Row Detail helpers for database E2E tests (Playwright)
 * Migrated from: cypress/support/row-detail-helpers.ts
 *
 * Provides utilities for testing row detail modal/page functionality
 */
import { Page, expect } from '@playwright/test';
import { DatabaseGridSelectors, RowDetailSelectors } from './selectors';

/**
 * Common beforeEach setup for row detail tests
 */
export function setupRowDetailTest(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return;
    }
  });
}

/**
 * Open row detail modal by hovering a row and clicking the expand button
 * @param rowIndex - Index of the row to open (0-based, data rows only)
 */
export async function openRowDetail(page: Page, rowIndex: number = 0): Promise<void> {
  const row = DatabaseGridSelectors.dataRows(page).nth(rowIndex);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(500);

  // Wait for expand button to appear
  const expandButton = page.getByTestId('row-expand-button').first();
  await expect(expandButton).toBeVisible({ timeout: 5000 });
  await expandButton.click({ force: true });
  await page.waitForTimeout(1000);

  // Verify modal is open
  await expect(RowDetailSelectors.modal(page)).toBeVisible();
}

/**
 * Open row detail by hovering over a cell to reveal the expand button
 */
export async function openRowDetailViaCell(
  page: Page,
  rowIndex: number,
  fieldId: string
): Promise<void> {
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  await page.waitForTimeout(500);

  await page.getByTestId('row-expand-button').first().click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Close row detail modal
 */
export async function closeRowDetail(page: Page): Promise<void> {
  const modalCount = await page.locator('.MuiDialog-paper').count();
  if (modalCount > 0) {
    await RowDetailSelectors.closeButton(page).click({ force: true });
  }
  await page.waitForTimeout(500);
}

/**
 * Close row detail by pressing Escape.
 * Presses Escape up to 3 times because the first press may be consumed by the
 * Slate editor (e.g. to blur or deselect) rather than closing the dialog.
 */
export async function closeRowDetailWithEscape(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const dialogCount = await page.locator('.MuiDialog-paper').count();
    if (dialogCount === 0) break;
  }

  // If Escape didn't close the dialog, fall back to clicking the close button
  if ((await page.locator('.MuiDialog-paper').count()) > 0) {
    await RowDetailSelectors.closeButton(page).click({ force: true });
  }

  await expect(page.locator('.MuiDialog-paper')).toHaveCount(0, { timeout: 10000 });
}

/**
 * Assert row detail modal is open
 */
export async function assertRowDetailOpen(page: Page): Promise<void> {
  await expect(RowDetailSelectors.modal(page)).toBeVisible();
}

/**
 * Assert row detail modal is closed
 */
export async function assertRowDetailClosed(page: Page): Promise<void> {
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
}

/**
 * Type text into the row document
 */
export async function typeInRowDocument(page: Page, text: string): Promise<void> {
  const editor = RowDetailSelectors.documentArea(page)
    .locator(
      '[data-testid="editor-content"], [role="textbox"][contenteditable="true"], [contenteditable="true"]'
    )
    .first();
  await editor.click({ force: true });
  await editor.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(500);
}

/**
 * Clear and type text into the row document
 */
export async function clearAndTypeInRowDocument(page: Page, text: string): Promise<void> {
  const editor = RowDetailSelectors.documentArea(page)
    .locator('[contenteditable="true"], .editor-content, .ProseMirror')
    .first();
  await editor.click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await editor.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(500);
}

/**
 * Assert document content contains text
 */
export async function assertDocumentContains(page: Page, text: string): Promise<void> {
  await expect(RowDetailSelectors.documentArea(page)).toContainText(text);
}

/**
 * Open more actions menu in row detail
 */
export async function openMoreActionsMenu(page: Page): Promise<void> {
  await RowDetailSelectors.moreActionsButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Duplicate row from row detail
 */
export async function duplicateRowFromDetail(page: Page): Promise<void> {
  await openMoreActionsMenu(page);
  await RowDetailSelectors.duplicateMenuItem(page).click({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Delete row from row detail
 */
export async function deleteRowFromDetail(page: Page): Promise<void> {
  await openMoreActionsMenu(page);
  await RowDetailSelectors.deleteMenuItem(page).click({ force: true });
  await page.waitForTimeout(500);

  // Handle confirmation if present
  const confirmButtons = page.getByRole('button', { name: 'Delete' });
  if ((await confirmButtons.count()) > 1) {
    await confirmButtons.last().click({ force: true });
    await page.waitForTimeout(500);
  }
}

/**
 * Edit row title
 */
export async function editRowTitle(page: Page, newTitle: string): Promise<void> {
  const titleInput = RowDetailSelectors.titleInput(page);
  await titleInput.click({ force: true });
  await page.keyboard.press('Control+A');
  await titleInput.pressSequentially(newTitle, { delay: 30 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Get row title text
 */
export async function getRowTitle(page: Page): Promise<string> {
  return (await RowDetailSelectors.titleInput(page).textContent()) || '';
}

/**
 * Add a new property/field in row detail
 */
export async function addPropertyInRowDetail(page: Page, fieldType: string): Promise<void> {
  await page.getByTestId('add-property-button').first().click({ force: true });
  await page.waitForTimeout(500);

  await page
    .locator('[role="menuitem"], [data-testid^="field-type"]')
    .filter({ hasText: new RegExp(fieldType, 'i') })
    .click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Assert property exists in row detail
 */
export async function assertPropertyExists(page: Page, propertyName: string): Promise<void> {
  await expect(
    page
      .locator('[data-testid="property-name"], .property-name')
      .filter({ hasText: propertyName })
  ).toBeVisible();
}

/**
 * Assert property does not exist (hidden)
 */
export async function assertPropertyNotVisible(page: Page, propertyName: string): Promise<void> {
  await expect(
    page
      .locator('[data-testid="property-name"], .property-name')
      .filter({ hasText: propertyName })
  ).toHaveCount(0);
}
