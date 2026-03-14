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
    const addBtn = page.getByTestId('add-view-button');
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(500);
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.locator('[role="menuitem"]').filter({ hasText: viewType }).click({ force: true });
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

    // Click the day cell first (FullCalendar select handler creates a new event)
    await calCell.click({ force: true });
    await page.waitForTimeout(2000);

    // Check if a popover with an input appeared (EventWithPopover auto-opens for new events)
    const popover = page.locator('[data-radix-popper-content-wrapper]').last();
    const popoverVisible = await popover.isVisible().catch(() => false);

    if (popoverVisible) {
      const titleInput = popover.locator('input').first();
      const inputVisible = await titleInput.isVisible().catch(() => false);
      if (inputVisible) {
        await titleInput.fill('');
        await titleInput.pressSequentially(eventName, { delay: 30 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(2000);
        return;
      }
    }

    // Fallback: try double-click
    await calCell.dblclick({ force: true });
    await page.waitForTimeout(1500);

    // Look for any visible input
    const visibleInput = page.locator('input:visible').last();
    const hasInput = await visibleInput.isVisible().catch(() => false);
    if (hasInput) {
      await visibleInput.fill('');
      await visibleInput.pressSequentially(eventName, { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
  }

  test('should maintain data consistency across Grid, Board, and Calendar views', async ({
    page,
    request,
  }) => {
    // Given: a database grid with a row named gridRow
    const testEmail = generateRandomEmail();
    const gridRow = `GridItem-${uuidv4().substring(0, 6)}`;
    const boardCard = `BoardItem-${uuidv4().substring(0, 6)}`;
    const calendarEvent = `CalItem-${uuidv4().substring(0, 6)}`;

    await createGridAndWait(page, request, testEmail);

    await editRowInGrid(page, 0, gridRow);
    await expect(page.locator('.database-grid')).toContainText(gridRow, { timeout: 10000 });

    // When: adding a Board view
    await addViewToDatabase(page, 'Board');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Then: the grid row appears in the Board view
    await expect(BoardSelectors.boardContainer(page)).toContainText(gridRow, { timeout: 10000 });

    // And: creating a new card in Board view shows it immediately
    await createCardInBoard(page, boardCard);
    await expect(BoardSelectors.boardContainer(page)).toContainText(boardCard, { timeout: 10000 });

    // When: adding a Calendar view and creating an event
    await addViewToDatabase(page, 'Calendar');
    await expect(page.locator('.database-calendar:not(.sticky-header-wrapper)').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    await createEventInCalendar(page, calendarEvent);

    // Then: the calendar event is visible
    await expect(page.locator('.database-calendar:not(.sticky-header-wrapper)').first()).toContainText(calendarEvent, { timeout: 10000 });

    // When: switching back to the Grid view
    await switchToView(page, 'Grid');
    await expect(page.locator('.database-grid')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Then: all items from every view are present in the grid
    await expect(page.locator('.database-grid')).toContainText(gridRow, { timeout: 10000 });
    await expect(page.locator('.database-grid')).toContainText(boardCard, { timeout: 10000 });
    await expect(page.locator('.database-grid')).toContainText(calendarEvent, { timeout: 10000 });

    // When: switching to the Board view
    await switchToView(page, 'Board');
    await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Then: all items from every view are present in the board
    await expect(BoardSelectors.boardContainer(page)).toContainText(gridRow, { timeout: 10000 });
    await expect(BoardSelectors.boardContainer(page)).toContainText(boardCard, { timeout: 10000 });
    await expect(BoardSelectors.boardContainer(page)).toContainText(calendarEvent, { timeout: 10000 });

    // When: switching back to the Calendar view
    await switchToView(page, 'Calendar');
    await expect(page.locator('.database-calendar:not(.sticky-header-wrapper)').first()).toBeVisible({ timeout: 15000 });

    // Then: the calendar event is still visible
    await expect(page.locator('.database-calendar:not(.sticky-header-wrapper)').first()).toContainText(calendarEvent, { timeout: 10000 });
  });
});
