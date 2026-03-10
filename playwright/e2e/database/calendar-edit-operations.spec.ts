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
 * Uses the FullCalendar container (.fc) which is unique, unlike .database-calendar
 * which matches both the FC widget and its parent wrapper.
 */
async function waitForCalendarReady(page: import('@playwright/test').Page) {
  await expect(CalendarSelectors.calendarContainer(page).first()).toBeVisible({ timeout: 15000 });
  // Ensure at least 28 day cells are rendered (a full month)
  const dayCellCount = await CalendarSelectors.dayCell(page).count();
  expect(dayCellCount).toBeGreaterThanOrEqual(28);
}

/**
 * Helper: Create an event by clicking a day cell
 */
async function createEventOnCell(page: import('@playwright/test').Page, cellIndex: number, eventName: string) {
  // Click the day cell to trigger FullCalendar's select handler which creates a new event
  const dayCell = CalendarSelectors.dayCell(page).nth(cellIndex);
  await dayCell.click({ force: true });
  await page.waitForTimeout(2000);

  // The event popover should auto-open for new events (EventWithPopover handles this)
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  await expect(popover).toBeVisible({ timeout: 10000 });

  // Type the event name into the title field
  const titleInput = popover.locator('input, textarea, [contenteditable="true"]').first();
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await titleInput.fill('');
  await titleInput.pressSequentially(eventName, { delay: 30 });
  await page.waitForTimeout(500);

  // Close the popover
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
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName1)).toBeVisible({ timeout: 10000 });

    // When: creating a second event on a different day cell
    await createEventOnCell(page, 15, eventName2);

    // Then: the second event should appear in the calendar
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName2)).toBeVisible({ timeout: 10000 });

    // And: both events should still be visible
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName1)).toBeVisible();
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName2)).toBeVisible();
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
    await expect(CalendarSelectors.calendarContainer(page).first().getByText(eventName)).toBeVisible({ timeout: 10000 });

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
    await expect(CalendarSelectors.calendarContainer(page).first()).toBeVisible({ timeout: 15000 });
    await expect(CalendarSelectors.calendarContainer(page).first().getByText(eventName)).toBeVisible({ timeout: 10000 });
  });
});
