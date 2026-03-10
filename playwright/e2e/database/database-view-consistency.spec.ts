/**
 * Database View Consistency E2E Tests
 *
 * Tests for verifying data consistency across different database views
 * (Grid, Board, Calendar). Creates rows in one view and verifies they
 * appear correctly in other views.
 *
 * Migrated from: cypress/e2e/database/database-view-consistency.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { v4 as uuidv4 } from 'uuid';

test.describe('Database View Consistency', () => {
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

    await page.setViewportSize({ width: 1280, height: 900 });
  });

  async function createGridAndWait(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
    testEmail: string
  ) {
    await signInAndCreateDatabaseView(page, request, testEmail, 'Grid', {
      verify: async (p) => {
        await expect(p.locator('.database-grid')).toBeVisible({ timeout: 15000 });
        await expect(DatabaseGridSelectors.dataRows(p).first()).toBeVisible({ timeout: 10000 });
        await p.waitForTimeout(2000);
      },
    });
  }

  async function addViewToDatabase(page: import('@playwright/test').Page, viewType: 'Grid' | 'Board' | 'Calendar') {
    await page.getByTestId('add-view-button').click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').filter({ hasText: viewType }).click({ force: true });
    await page.waitForTimeout(3000);
  }

  async function switchToView(page: import('@playwright/test').Page, viewType: string) {
    await DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType }).click({ force: true });
    await page.waitForTimeout(2000);
  }

  async function editRowInGrid(page: import('@playwright/test').Page, rowIndex: number, rowName: string) {
    const firstCell = DatabaseGridSelectors.dataRows(page).nth(rowIndex).locator('.grid-row-cell').first();
    await firstCell.scrollIntoViewIfNeeded();
    await firstCell.click({ force: true });
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+A');
    await page.keyboard.type(rowName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }

  async function createCardInBoard(page: import('@playwright/test').Page, cardName: string) {
    const newButton = BoardSelectors.boardContainer(page).locator('text=/^\\s*New\\s*$/i').first();
    await newButton.click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type(cardName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }

  async function createEventInCalendar(page: import('@playwright/test').Page, eventName: string, cellIndex: number = 15) {
    const calCell = page.locator('.fc-daygrid-day').nth(cellIndex);
    await calCell.click({ force: true });
    await page.waitForTimeout(1500);

    const visibleInputCount = await page.locator('input:visible').count();
    if (visibleInputCount > 0) {
      await page.locator('input:visible').last().clear();
      await page.locator('input:visible').last().fill(eventName);
      await page.keyboard.press('Enter');
    } else {
      await calCell.dblclick({ force: true });
      await page.waitForTimeout(500);
      await page.locator('input:visible').last().clear();
      await page.locator('input:visible').last().fill(eventName);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);
  }

  test('should maintain data consistency across Grid, Board, and Calendar views', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const gridRow = `GridItem-${uuidv4().substring(0, 6)}`;
    const boardCard = `BoardItem-${uuidv4().substring(0, 6)}`;
    const calendarEvent = `CalItem-${uuidv4().substring(0, 6)}`;

    await createGridAndWait(page, request, testEmail);

    // Step 1: Edit first row in Grid view
    await editRowInGrid(page, 0, gridRow);
    await expect(page.locator('.database-grid')).toContainText(gridRow, { timeout: 10000 });

    // Step 2: Add Board view and verify grid row appears, then create a card
    await addViewToDatabase(page, 'Board');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    await expect(BoardSelectors.boardContainer(page)).toContainText(gridRow, { timeout: 10000 });

    await createCardInBoard(page, boardCard);
    await expect(BoardSelectors.boardContainer(page)).toContainText(boardCard, { timeout: 10000 });

    // Step 3: Add Calendar view and create an event
    await addViewToDatabase(page, 'Calendar');
    await expect(page.locator('.database-calendar')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    await createEventInCalendar(page, calendarEvent);
    await expect(page.locator('.database-calendar')).toContainText(calendarEvent, { timeout: 10000 });

    // Step 4: Switch to Grid view and verify all items exist
    await switchToView(page, 'Grid');
    await expect(page.locator('.database-grid')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('.database-grid')).toContainText(gridRow, { timeout: 10000 });
    await expect(page.locator('.database-grid')).toContainText(boardCard, { timeout: 10000 });
    await expect(page.locator('.database-grid')).toContainText(calendarEvent, { timeout: 10000 });

    // Step 5: Switch to Board view and verify all items exist
    await switchToView(page, 'Board');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await expect(BoardSelectors.boardContainer(page)).toContainText(gridRow, { timeout: 10000 });
    await expect(BoardSelectors.boardContainer(page)).toContainText(boardCard, { timeout: 10000 });
    await expect(BoardSelectors.boardContainer(page)).toContainText(calendarEvent, { timeout: 10000 });

    // Step 6: Switch back to Calendar view to verify it still works
    await switchToView(page, 'Calendar');
    await expect(page.locator('.database-calendar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.database-calendar')).toContainText(calendarEvent, { timeout: 10000 });
  });
});
