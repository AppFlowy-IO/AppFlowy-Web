/**
 * Calendar Row Loading Tests
 *
 * Tests for calendar event creation, display, and persistence.
 *
 * Migrated from: cypress/e2e/database/calendar-edit-operations.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  DatabaseViewSelectors,
  CalendarSelectors,
  DatabaseGridSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { v4 as uuidv4 } from 'uuid';

/**
 * Helper: Wait for calendar to fully load.
 * Uses the `.database-calendar` container (outer wrapper) which contains the
 * FullCalendar widget. We exclude the sticky header wrapper to target the
 * real calendar content.
 */
async function waitForCalendarReady(page: import('@playwright/test').Page) {
  await expect(page.locator('.database-calendar:not(.sticky-header-wrapper)').first()).toBeVisible({ timeout: 15000 });
  // Ensure at least 28 day cells are rendered (a full month)
  const dayCellCount = await CalendarSelectors.dayCell(page).count();
  expect(dayCellCount).toBeGreaterThanOrEqual(28);
}

/**
 * Helper: Create an event by clicking a day cell.
 * Matches Cypress flow: click cell -> if input visible type into it,
 * else try hover/double-click -> type into visible input.
 */
async function createEventOnCell(page: import('@playwright/test').Page, cellIndex: number, eventName: string) {
  // Click the day cell to trigger FullCalendar's select handler which creates a new event
  const dayCell = CalendarSelectors.dayCell(page).nth(cellIndex);
  await dayCell.click({ force: true });
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

  // Fallback: try double-clicking the cell
  await dayCell.dblclick({ force: true });
  await page.waitForTimeout(1500);

  // Look for any visible input (from popover or inline)
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

test.describe('Calendar Row Loading', () => {
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

  test('should create calendar and display multiple events immediately', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const eventName1 = `Event-${uuidv4().substring(0, 6)}`;
    const eventName2 = `Meeting-${uuidv4().substring(0, 6)}`;

    // Given: a signed-in user with a calendar database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Calendar', { createWaitMs: 8000 });
    await waitForCalendarReady(page);

    // When: creating the first event on a day cell
    await createEventOnCell(page, 10, eventName1);

    // Then: the first event should appear in the calendar
    const calendarContent = page.locator('.database-calendar:not(.sticky-header-wrapper)').first();
    await expect(calendarContent.getByText(eventName1)).toBeVisible({ timeout: 10000 });

    // When: creating a second event on a different day cell
    await createEventOnCell(page, 15, eventName2);

    // Then: the second event should appear in the calendar
    await expect(calendarContent.getByText(eventName2)).toBeVisible({ timeout: 10000 });

    // And: both events should still be visible
    await expect(calendarContent.getByText(eventName1)).toBeVisible();
    await expect(calendarContent.getByText(eventName2)).toBeVisible();
  });

  test('should display calendar events in Grid view when switching views', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();
    const eventName = `Event-${uuidv4().substring(0, 6)}`;

    // Given: a signed-in user with a calendar database
    await signInAndCreateDatabaseView(page, request, testEmail, 'Calendar', { createWaitMs: 8000 });
    await waitForCalendarReady(page);

    // When: creating an event in the Calendar view
    await createEventOnCell(page, 10, eventName);

    // Then: the event should appear in the calendar
    const calContent = page.locator('.database-calendar:not(.sticky-header-wrapper)').first();
    await expect(calContent.getByText(eventName)).toBeVisible({ timeout: 10000 });

    // When: adding a Grid view via the database tabbar "+" button
    const addBtn = DatabaseViewSelectors.addViewButton(page);
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(500);
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await menu.locator('[role="menuitem"]').filter({ hasText: 'Grid' }).click({ force: true });
    await page.waitForTimeout(3000);

    // Then: the Grid view should load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    // And: the event should appear in the Grid view
    await expect(DatabaseGridSelectors.grid(page).getByText(eventName)).toBeVisible({ timeout: 10000 });

    // When: switching back to the Calendar view via tab
    await page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Calendar' }).click({ force: true });
    await page.waitForTimeout(2000);

    // Then: the calendar should still show the event
    await expect(calContent).toBeVisible({ timeout: 15000 });
    await expect(calContent.getByText(eventName)).toBeVisible({ timeout: 10000 });
  });
});
