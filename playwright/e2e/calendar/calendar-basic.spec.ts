/**
 * Calendar Basic Tests (Desktop Parity)
 *
 * Tests basic calendar view functionality.
 * Migrated from: cypress/e2e/calendar/calendar-basic.cy.ts
 */
import { test, expect } from '@playwright/test';
import {
  AddPageSelectors,
  CalendarSelectors,
  DatabaseGridSelectors,
} from '../../support/selectors';
import {
  generateRandomEmail,
  setupCalendarTest,
  loginAndCreateCalendar,
  waitForCalendarLoad,
  doubleClickCalendarDay,
  clickEvent,
  editEventTitle,
  deleteEventFromPopover,
  closeEventPopover,
  assertTotalEventCount,
  assertEventExists,
  getToday,
  formatDateForCalendar,
} from '../../support/calendar-test-helpers';

test.describe('Calendar Basic Tests (Desktop Parity)', () => {
  test('create calendar view', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);

    // Create another calendar view
    await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
    await page.waitForTimeout(800);

    const hasCalendarButton = await AddPageSelectors.addCalendarButton(page).count();
    if (hasCalendarButton > 0) {
      await AddPageSelectors.addCalendarButton(page).click({ force: true });
    } else {
      await page.locator('[role="menuitem"]').filter({ hasText: /calendar/i }).first().click({ force: true });
    }

    await page.waitForTimeout(7000);

    // Verify calendar is loaded
    await expect(CalendarSelectors.calendarContainer(page)).toBeVisible();
    await expect(CalendarSelectors.toolbar(page)).toBeVisible();
  });

  test('update calendar layout to board and grid', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    // Open database settings
    const settingsButton = page.locator('[data-testid="database-settings-button"], button:has-text("Settings")').first();
    await settingsButton.click({ force: true });
    await page.waitForTimeout(500);

    // Click layout option
    const layoutButton = page.locator('[data-testid="database-layout-button"], button:has-text("Layout")').first();
    await layoutButton.click({ force: true });
    await page.waitForTimeout(500);

    // Select Board layout
    await page.locator('[role="menuitem"], button').filter({ hasText: /board/i }).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify Board layout is active
    await expect(page.locator('[data-testid*="board"], .board-view')).toBeVisible();

    // Switch back to Grid
    await page.locator('[data-testid="database-settings-button"], button:has-text("Settings")').first().click({ force: true });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="database-layout-button"], button:has-text("Layout")').first().click({ force: true });
    await page.waitForTimeout(500);
    await page.locator('[role="menuitem"], button').filter({ hasText: /grid/i }).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify Grid layout is active
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible();
  });

  test('create event via double-click', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Double-click on today to create event
    await doubleClickCalendarDay(page, today);

    // Event editor/popover should open
    await expect(page.locator('[data-radix-popper-content-wrapper]')).toBeVisible();

    // Close the popover
    await closeEventPopover(page);

    // Verify event was created
    await assertTotalEventCount(page, 1);
  });

  test('create event via add button on hover', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();
    const dateStr = formatDateForCalendar(today);

    // Hover over today's cell
    await CalendarSelectors.dayCellByDate(page, dateStr).hover();
    await page.waitForTimeout(500);

    // Click the add button if visible, otherwise double-click
    const addButton = page.locator('[data-testid="calendar-add-button"], .add-event-button');
    const addButtonCount = await addButton.count();
    if (addButtonCount > 0 && await addButton.first().isVisible()) {
      await addButton.first().click({ force: true });
    } else {
      await doubleClickCalendarDay(page, today);
    }

    await page.waitForTimeout(1000);

    // Close any open popover
    await closeEventPopover(page);

    // Verify event exists
    await expect(CalendarSelectors.event(page).first()).toBeVisible();
  });

  test('edit event title', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create an event
    await doubleClickCalendarDay(page, today);

    // Edit the title
    await editEventTitle(page, 'My Custom Event');

    // Close the popover
    await closeEventPopover(page);

    // Verify the event shows the new title
    await assertEventExists(page, 'My Custom Event');
  });

  test('delete event from popover', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create an event
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Event To Delete');
    await closeEventPopover(page);

    // Verify event exists
    await assertTotalEventCount(page, 1);

    // Click on the event to open popover
    await clickEvent(page, 0);

    // Delete the event
    await deleteEventFromPopover(page);

    // Verify event is deleted
    await assertTotalEventCount(page, 0);
  });

  test('multiple events on same day', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create first event
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'First Event');
    await closeEventPopover(page);

    // Create second event
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Second Event');
    await closeEventPopover(page);

    // Verify both events exist
    await assertTotalEventCount(page, 2);
    await assertEventExists(page, 'First Event');
    await assertEventExists(page, 'Second Event');
  });
});
