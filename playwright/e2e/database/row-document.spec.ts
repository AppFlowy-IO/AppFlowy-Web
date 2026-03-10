/**
 * Row Document Tests (Board view)
 *
 * Tests for row document content persistence, focus behavior,
 * and document indicator on cards.
 * Migrated from: cypress/e2e/database/row-document.cy.ts
 */
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import {
  BoardSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { generateRandomEmail } from '../../support/test-config';

test.describe('Row Document Test', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return;
      }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * Helper: create a Board and wait for it to be ready
   */
  async function createBoardAndWait(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testEmail: string
  ) {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Board', {
      createWaitMs: 7000,
      verify: async (p) => {
        await expect(BoardSelectors.boardContainer(p)).toBeVisible({ timeout: 15000 });
        await p.waitForTimeout(3000);
        await expect(BoardSelectors.cards(p).first()).toBeVisible({ timeout: 15000 });
      },
    });
  }

  /**
   * Helper: add a new card to the "To Do" column and return the card name
   */
  async function addNewCard(page: import('@playwright/test').Page, cardName: string) {
    // Find the "To Do" column and click "New"
    const todoColumn = BoardSelectors.boardContainer(page)
      .locator('[data-column-id]')
      .filter({ hasText: 'To Do' });
    await todoColumn.getByText('New').click({ force: true });
    await page.waitForTimeout(1000);

    // Type the card name
    await page.keyboard.type(cardName, { delay: 30 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }

  /**
   * Helper: open a card's row detail modal by clicking on it
   */
  async function openCard(page: import('@playwright/test').Page, cardName: string) {
    await BoardSelectors.boardContainer(page).getByText(cardName).click({ force: true });
    await expect(RowDetailSelectors.modal(page)).toBeVisible();
  }

  /**
   * Helper: click into the row document editor
   */
  async function clickIntoEditor(page: import('@playwright/test').Page) {
    // Wait for editor to load
    await page.waitForTimeout(3000);

    // Scroll down to make sure editor is visible
    const scrollContainer = page.locator('[role="dialog"]').locator('.appflowy-scroll-container');
    if ((await scrollContainer.count()) > 0) {
      await scrollContainer.scrollTo(0, 9999);
      await page.waitForTimeout(1000);
    }

    // Wait for editor to be ready and click into it
    const editor = page
      .locator('[role="dialog"]')
      .locator('[data-testid="editor-content"], [role="textbox"][contenteditable="true"]')
      .first();
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click({ force: true });
  }

  test('should persist row document content after closing and reopening modal', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const cardName = `Persist-${uuidv4().substring(0, 6)}`;
    const docText = `persist-test-${uuidv4().substring(0, 6)}`;

    await createBoardAndWait(page, request, testEmail);

    // Add a new card
    await addNewCard(page, cardName);

    // Open row detail modal
    await openCard(page, cardName);

    // Click into editor
    await clickIntoEditor(page);

    // Type multiple lines
    const line1 = `Line1-${docText}`;
    const line2 = `Line2-${docText}`;
    const line3 = `Line3-${docText}`;
    await page.keyboard.type(`${line1}`, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${line2}`, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${line3}`, { delay: 50 });
    await page.waitForTimeout(2000);

    // Verify all lines are there before closing
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText(line1);
    await expect(dialog).toContainText(line2);
    await expect(dialog).toContainText(line3);

    // Close the modal
    // Click outside editor first to remove focus
    await dialog
      .locator('.MuiDialogTitle-root, [data-testid="row-detail-header"]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(500);
    await closeRowDetailWithEscape(page);
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(3000);

    // Reopen the same card
    await openCard(page, cardName);
    await page.waitForTimeout(3000);

    // Scroll down to make editor visible
    const scrollContainer = page.locator('[role="dialog"]').locator('.appflowy-scroll-container');
    if ((await scrollContainer.count()) > 0) {
      await scrollContainer.scrollTo(0, 9999);
      await page.waitForTimeout(1000);
    }

    // Verify content persisted
    await expect(page.locator('[role="dialog"]')).toContainText(`Line1-${docText}`);
    await expect(page.locator('[role="dialog"]')).toContainText(`Line2-${docText}`);
    await expect(page.locator('[role="dialog"]')).toContainText(`Line3-${docText}`);
  });

  test('should maintain focus while typing continuously', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const cardName = `Focus-${uuidv4().substring(0, 6)}`;

    await createBoardAndWait(page, request, testEmail);

    // Add a new card
    await addNewCard(page, cardName);

    // Open row detail modal
    await openCard(page, cardName);

    // Click into editor
    await clickIntoEditor(page);

    // Type a long sentence with delays to simulate real typing
    const longText =
      'This is a test sentence that should be typed without losing focus even after several seconds of typing';
    await page.keyboard.type(longText, { delay: 50 }); // ~5 seconds of typing

    // Verify the full text was typed (focus was maintained)
    await expect(page.locator('[role="dialog"]')).toContainText(longText);

    // Close and verify content persisted
    const dialog = page.locator('[role="dialog"]');
    await dialog
      .locator('.MuiDialogTitle-root, [data-testid="row-detail-header"]')
      .first()
      .click({ force: true });
    await page.waitForTimeout(500);
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(2000);

    // Reopen and verify
    await openCard(page, cardName);
    await page.waitForTimeout(3000);
    await expect(page.locator('[role="dialog"]')).toContainText(longText);
  });

  test('shows row document indicator after editing row document', async ({ page, request }) => {
    const testEmail = generateRandomEmail();
    const cardName = `RowDoc-${uuidv4().substring(0, 6)}`;
    const docText = `row-doc-${uuidv4().substring(0, 6)}`;

    await createBoardAndWait(page, request, testEmail);

    // Add a new card
    await addNewCard(page, cardName);

    // Verify card is visible
    await expect(BoardSelectors.boardContainer(page).getByText(cardName)).toBeVisible({
      timeout: 10000,
    });

    // Open row detail modal
    await openCard(page, cardName);

    // Click into editor and type
    await clickIntoEditor(page);
    await page.keyboard.type(docText, { delay: 30 });
    await page.waitForTimeout(1000);

    // Close modal
    await closeRowDetailWithEscape(page);
    await page.waitForTimeout(1000);

    // Verify document indicator appears on the card
    await expect(
      BoardSelectors.boardContainer(page)
        .locator('.board-card')
        .filter({ hasText: cardName })
        .locator('.custom-icon')
    ).toBeVisible({ timeout: 15000 });
  });
});
