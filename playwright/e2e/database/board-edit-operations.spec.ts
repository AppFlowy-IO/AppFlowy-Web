/**
 * Board Operations E2E Tests
 *
 * Comprehensive tests for Board view functionality:
 * - Card operations (add, modify, delete, duplicate)
 * - Card persistence and collaboration sync
 * - Consecutive board creation regression test
 *
 * Migrated from: cypress/e2e/database/board-edit-operations.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  BoardSelectors,
  RowDetailSelectors,
  DropdownSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { signInAndCreateDatabaseView, createDatabaseView } from '../../support/database-ui-helpers';
import { v4 as uuidv4 } from 'uuid';

test.describe('Board Operations', () => {
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
   * Helper: Create a Board and wait for it to load
   */
  const createBoardAndWait = async (
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testEmail: string
  ) => {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Board', {
      verify: async (p) => {
        await expect(BoardSelectors.boardContainer(p)).toBeVisible({ timeout: 15000 });
        await p.waitForTimeout(3000);
        await expect(BoardSelectors.cards(p).first()).toBeVisible({ timeout: 15000 });
        await expect(BoardSelectors.boardContainer(p).getByText('To Do')).toBeVisible();
        await expect(BoardSelectors.boardContainer(p).getByText('Doing')).toBeVisible();
        await expect(BoardSelectors.boardContainer(p).getByText('Done')).toBeVisible();
      },
    });
  };

  test.describe('Board Creation', () => {
    test('should display cards correctly when creating two Boards consecutively', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();

      // Given: a signed-in user in the app
      await signInAndWaitForApp(page, request, testEmail);
      await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
      await page.waitForTimeout(3000);

      // When: creating the first Board database
      await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
      await page.waitForTimeout(1000);
      await page.locator('[role="menuitem"]').filter({ hasText: 'Board' }).click({ force: true });
      await page.waitForTimeout(5000);

      // Then: the first board should load with default columns and cards
      await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(3000);
      await expect(BoardSelectors.cards(page).first()).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.boardContainer(page).getByText('To Do')).toBeVisible();

      // When: creating a second Board database
      await createDatabaseView(page, 'Board', 5000);

      // Then: the second board should also load correctly (regression: not blank)
      await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(3000);
      await expect(BoardSelectors.cards(page).first()).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.boardContainer(page).getByText('To Do')).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText('Doing')).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText('Done')).toBeVisible();
    });
  });

  test.describe('Card Operations', () => {
    test('should add cards to different columns', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const todoCard = `Todo-${uuidv4().substring(0, 6)}`;
      const doingCard = `Doing-${uuidv4().substring(0, 6)}`;
      const doneCard = `Done-${uuidv4().substring(0, 6)}`;

      // Given: a signed-in user with a Board database
      await createBoardAndWait(page, request, testEmail);

      // When: adding a card to the "To Do" column
      const todoColumn = BoardSelectors.boardContainer(page)
        .locator('[data-column-id]')
        .filter({ hasText: 'To Do' });
      await todoColumn.getByText('New').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${todoCard}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);

      // And: adding a card to the "Doing" column
      const doingColumn = BoardSelectors.boardContainer(page)
        .locator('[data-column-id]')
        .filter({ hasText: 'Doing' });
      await doingColumn.getByText('New').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${doingCard}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);

      // And: adding a card to the "Done" column
      const doneColumn = BoardSelectors.boardContainer(page)
        .locator('[data-column-id]')
        .filter({ hasText: 'Done' });
      await doneColumn.getByText('New').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${doneCard}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);

      // Then: all three cards should be visible on the board
      await expect(BoardSelectors.boardContainer(page).getByText(todoCard)).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText(doingCard)).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText(doneCard)).toBeVisible();
    });

    test('should modify card title through detail view', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const originalName = `Original-${uuidv4().substring(0, 6)}`;
      const modifiedName = `Modified-${uuidv4().substring(0, 6)}`;

      // Given: a Board with a card named originalName
      await createBoardAndWait(page, request, testEmail);
      await BoardSelectors.boardContainer(page).getByText('New').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${originalName}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // When: opening the card detail modal
      await BoardSelectors.boardContainer(page).getByText(originalName).click({ force: true });
      await page.waitForTimeout(1500);

      // Then: the modal should show the original title
      const dialog = page.locator('.MuiDialog-paper').filter({ has: page.getByTestId('row-title-input') }).first();
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(dialog.getByTestId('row-title-input')).toHaveValue(originalName, { timeout: 10000 });

      // When: modifying the title and closing the modal
      const titleInput = RowDetailSelectors.titleInput(page);
      await expect(titleInput).toBeVisible();
      await titleInput.click({ force: true });
      await titleInput.clear();
      await titleInput.fill(modifiedName);
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);

      // Then: the modified name should appear on the board
      await expect(
        BoardSelectors.boardContainer(page).getByText(modifiedName)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should delete a card from the board', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const cardToDelete = `DeleteMe-${uuidv4().substring(0, 6)}`;

      // Given: a Board with a card to delete
      await createBoardAndWait(page, request, testEmail);
      await BoardSelectors.boardContainer(page).getByText('New').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${cardToDelete}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      await expect(BoardSelectors.boardContainer(page).getByText(cardToDelete)).toBeVisible();

      // When: hovering over the card and clicking the more button
      const card = BoardSelectors.boardContainer(page)
        .locator('[class*="board-card"]')
        .filter({ hasText: cardToDelete })
        .first();
      await card.hover({ force: true });
      await page.waitForTimeout(500);
      await card.locator('button').last().click({ force: true });
      await page.waitForTimeout(500);

      // And: selecting delete and confirming
      await page.locator('[role="menuitem"]').filter({ hasText: /delete/i }).click({ force: true });
      await page.waitForTimeout(500);
      await RowDetailSelectors.deleteRowConfirmButton(page).click({ force: true });
      await page.waitForTimeout(2000);

      // Then: the card should no longer be visible
      await expect(
        BoardSelectors.boardContainer(page).getByText(cardToDelete)
      ).toBeHidden({ timeout: 15000 });
    });

    /**
     * Regression test for issue #145:
     * Duplicating a card should not cause select option data to disappear from original cards.
     */
    test('should preserve original card data after duplicating a card (#145)', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const cardName = `Card-${uuidv4().substring(0, 6)}`;

      // Given: a Board with a card in the "To Do" column
      await createBoardAndWait(page, request, testEmail);
      const todoColumn = BoardSelectors.boardContainer(page)
        .locator('[data-column-id]')
        .filter({ hasText: 'To Do' });
      await todoColumn.getByText('New').click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${cardName}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      await expect(todoColumn.getByText(cardName)).toBeVisible();

      const cardCountBefore = await BoardSelectors.cards(page).count();

      // When: duplicating the card via the toolbar menu
      const card = BoardSelectors.boardContainer(page)
        .locator('[class*="board-card"]')
        .filter({ hasText: cardName })
        .first();
      await card.hover({ force: true });
      await page.waitForTimeout(500);
      await card.locator('button').last().click({ force: true });
      await page.waitForTimeout(500);
      await page
        .locator('[role="menuitem"]')
        .filter({ hasText: /duplicate/i })
        .click({ force: true });
      await page.waitForTimeout(3000);

      // Then: the card count should increase by one
      await expect(BoardSelectors.cards(page)).toHaveCount(cardCountBefore + 1);

      // And: the original card should still be visible in the To Do column
      await expect(todoColumn.getByText(cardName).first()).toBeVisible();

      // And: all default columns should still have their headers
      await expect(BoardSelectors.boardContainer(page).getByText('To Do')).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText('Doing')).toBeVisible();
      await expect(BoardSelectors.boardContainer(page).getByText('Done')).toBeVisible();
    });

    test('should handle rapid card creation', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const cardPrefix = `Rapid-${uuidv4().substring(0, 4)}`;
      const cardCount = 5;

      // Given: a signed-in user with a Board database
      await createBoardAndWait(page, request, testEmail);

      // When: adding multiple cards rapidly
      for (let i = 1; i <= cardCount; i++) {
        await BoardSelectors.boardContainer(page).getByText('New').first().click({ force: true });
        await page.waitForTimeout(300);
        await page.keyboard.type(`${cardPrefix}-${i}`);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }

      await page.waitForTimeout(3000);

      // Then: all cards should be visible on the board
      for (let i = 1; i <= cardCount; i++) {
        await expect(
          BoardSelectors.boardContainer(page).getByText(`${cardPrefix}-${i}`)
        ).toBeVisible({ timeout: 10000 });
      }

      const totalCards = await BoardSelectors.cards(page).count();
      expect(totalCards).toBeGreaterThanOrEqual(cardCount);
    });

    test('should preserve row document content when reopening card multiple times', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const cardName = `Reopen-${uuidv4().substring(0, 6)}`;
      const documentContent = `Content-${uuidv4().substring(0, 8)}`;
      const reopenCount = 3;

      // Given: a Board with a card containing document content
      await createBoardAndWait(page, request, testEmail);
      await BoardSelectors.boardContainer(page).getByText('New').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${cardName}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      await expect(BoardSelectors.boardContainer(page).getByText(cardName)).toBeVisible();

      // When: opening the card and adding document content
      await BoardSelectors.boardContainer(page).getByText(cardName).click({ force: true });
      await page.waitForTimeout(1500);

      const dialog = page.locator('.MuiDialog-paper').filter({ has: page.getByTestId('row-title-input') }).first();
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await dialog.locator('[data-block-type]').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(documentContent);
      await page.waitForTimeout(2000);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);

      // Then: the content should persist across multiple reopens
      for (let i = 1; i <= reopenCount; i++) {
        // When: reopening the card
        await BoardSelectors.boardContainer(page).getByText(cardName).click({ force: true });
        await page.waitForTimeout(1500);

        // Then: the document content should still be visible
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog.getByText(documentContent)).toBeVisible({ timeout: 10000 });

        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
      }
    });
  });

  test.describe('Card Persistence', () => {
    test('should persist card after page refresh', async ({ page, request }) => {
      const testEmail = generateRandomEmail();
      const persistentCard = `Persist-${uuidv4().substring(0, 6)}`;

      // Given: a Board with a newly created card
      await createBoardAndWait(page, request, testEmail);
      await BoardSelectors.boardContainer(page).getByText('New').first().click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type(`${persistentCard}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      await expect(BoardSelectors.boardContainer(page).getByText(persistentCard)).toBeVisible();

      // When: refreshing the page
      await page.waitForTimeout(3000);
      await page.reload();
      await page.waitForTimeout(5000);

      // Then: the card should still be visible after refresh
      await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(3000);
      await expect(
        BoardSelectors.boardContainer(page).getByText(persistentCard)
      ).toBeVisible({ timeout: 10000 });
    });

    test('should sync new cards between collaborative sessions (iframe simulation)', async ({
      page,
      request,
    }) => {
      const testEmail = generateRandomEmail();
      const newCardName = `Collab-${uuidv4().substring(0, 6)}`;

      // Given: a Board with a collaborative iframe session
      await createBoardAndWait(page, request, testEmail);
      const currentUrl = page.url();

      await page.evaluate((url) => {
        const iframe = document.createElement('iframe');
        iframe.id = 'collab-iframe';
        iframe.src = url;
        iframe.style.cssText =
          'position: fixed; bottom: 0; right: 0; width: 600px; height: 400px; border: 2px solid blue; z-index: 9999;';
        document.body.appendChild(iframe);
      }, currentUrl);

      await expect(page.locator('#collab-iframe')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(8000);

      const iframe = page.frameLocator('#collab-iframe');
      await expect(iframe.locator('.database-board')).toBeVisible({ timeout: 15000 });

      // When: adding a card in the main window
      await BoardSelectors.boardContainer(page).getByText(/^\s*New\s*$/i).first().click({ force: true });
      await page.waitForTimeout(1000);
      await page.keyboard.type(`${newCardName}`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // Then: the card should be visible in the main window
      await expect(BoardSelectors.boardContainer(page).getByText(newCardName)).toBeVisible();

      // And: the card should sync to the iframe
      await page.waitForTimeout(5000);
      await expect(
        iframe.locator('.database-board').getByText(newCardName)
      ).toBeVisible({ timeout: 20000 });

      // Cleanup
      await page.evaluate(() => {
        const iframe = document.getElementById('collab-iframe');
        if (iframe) iframe.remove();
      });
    });
  });
});
