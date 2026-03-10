/**
 * Calendar Reschedule Tests (Desktop Parity)
 *
 * Tests for rescheduling calendar events.
 * Migrated from: cypress/e2e/calendar/calendar-reschedule.cy.ts
 */
import { test, expect } from '@playwright/test';
import { CalendarSelectors } from '../../support/selectors';
import {
  generateRandomEmail,
  setupCalendarTest,
  loginAndCreateCalendar,
  waitForCalendarLoad,
  doubleClickCalendarDay,
  clickEvent,
  editEventTitle,
  closeEventPopover,
  dragEventToDate,
  openUnscheduledEventsPopup,
  clickUnscheduledEvent,
  assertTotalEventCount,
  assertEventCountOnDay,
  assertUnscheduledEventCount,
  getToday,
  getRelativeDate,
} from '../../support/calendar-test-helpers';

test.describe('Calendar Reschedule Tests (Desktop Parity)', () => {
  test('drag event to reschedule', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();
    const tomorrow = getRelativeDate(1);

    // Create an event on today
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Drag Test Event');
    await closeEventPopover(page);

    // Verify event is on today
    await assertEventCountOnDay(page, today, 1);

    // Drag the event to tomorrow
    await dragEventToDate(page, 0, tomorrow);

    // Verify event is now on tomorrow
    await assertEventCountOnDay(page, tomorrow, 1);
    await assertEventCountOnDay(page, today, 0);
  });

  test('reschedule via date picker in event popover', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create an event
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Date Picker Test');
    await closeEventPopover(page);

    // Click on the event
    await clickEvent(page, 0);
    await page.waitForTimeout(500);

    // Find and click the date field in the popover
    const popover = page.locator('[data-radix-popper-content-wrapper]').last();
    const dateButton = popover.locator('button, [role="button"]').filter({ hasText: /date/i }).first();
    await dateButton.click({ force: true });
    await page.waitForTimeout(500);

    // Select day 20 from the date picker
    const dayButton = page.locator('.react-datepicker__day, [role="gridcell"], button').filter({ hasText: /^20$/ }).first();
    await dayButton.click({ force: true });
    await page.waitForTimeout(500);

    await closeEventPopover(page);

    // Verify event was rescheduled to day 20
    const targetDate = new Date(today.getFullYear(), today.getMonth(), 20);
    await assertEventCountOnDay(page, targetDate, 1);
  });

  test('clear date makes event unscheduled', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create an event
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Unschedule Test');
    await closeEventPopover(page);

    // Verify event exists
    await assertTotalEventCount(page, 1);

    // Click on the event
    await clickEvent(page, 0);
    await page.waitForTimeout(500);

    // Find and click clear/remove date button
    const popover = page.locator('[data-radix-popper-content-wrapper]').last();
    const clearButton = popover.locator('button').filter({ hasText: /clear|remove|no date/i }).first();
    await clearButton.click({ force: true });
    await page.waitForTimeout(500);

    await closeEventPopover(page);

    // Verify event is removed from calendar view
    await assertTotalEventCount(page, 0);

    // Verify unscheduled event count
    await assertUnscheduledEventCount(page, 1);
  });

  test('reschedule from unscheduled popup', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create an event and make it unscheduled
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Reschedule From Unscheduled');
    await closeEventPopover(page);

    // Clear the date
    await clickEvent(page, 0);
    await page.waitForTimeout(500);
    const popover = page.locator('[data-radix-popper-content-wrapper]').last();
    const clearButton = popover.locator('button').filter({ hasText: /clear|remove|no date/i }).first();
    await clearButton.click({ force: true });
    await page.waitForTimeout(500);
    await closeEventPopover(page);

    // Verify it's unscheduled
    await assertTotalEventCount(page, 0);
    await assertUnscheduledEventCount(page, 1);

    // Open unscheduled popup
    await openUnscheduledEventsPopup(page);

    // Click on the unscheduled event
    await clickUnscheduledEvent(page, 0);
    await page.waitForTimeout(500);

    // Set a new date (day 15)
    const eventPopover = page.locator('[data-radix-popper-content-wrapper], .MuiDialog-paper').last();
    const dateButton = eventPopover.locator('button, [role="button"]').filter({ hasText: /date/i }).first();
    await dateButton.click({ force: true });
    await page.waitForTimeout(500);

    await page.locator('.react-datepicker__day, [role="gridcell"], button').filter({ hasText: /^15$/ }).first().click({ force: true });
    await page.waitForTimeout(500);

    // Close everything
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify event is back on calendar
    const targetDate = new Date(today.getFullYear(), today.getMonth(), 15);
    await assertEventCountOnDay(page, targetDate, 1);

    // Verify no unscheduled events
    await assertUnscheduledEventCount(page, 0);
  });

  test('unscheduled events popup shows correct count', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();
    const tomorrow = getRelativeDate(1);

    // Create two events
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Event 1');
    await closeEventPopover(page);

    await doubleClickCalendarDay(page, tomorrow);
    await editEventTitle(page, 'Event 2');
    await closeEventPopover(page);

    // Clear date on first event
    await CalendarSelectors.event(page).filter({ hasText: 'Event 1' }).click({ force: true });
    await page.waitForTimeout(500);
    let popover = page.locator('[data-radix-popper-content-wrapper]').last();
    await popover.locator('button').filter({ hasText: /clear/i }).first().click({ force: true });
    await page.waitForTimeout(500);
    await closeEventPopover(page);

    // Verify count is 1
    await assertUnscheduledEventCount(page, 1);

    // Clear date on second event
    await CalendarSelectors.event(page).filter({ hasText: 'Event 2' }).click({ force: true });
    await page.waitForTimeout(500);
    popover = page.locator('[data-radix-popper-content-wrapper]').last();
    await popover.locator('button').filter({ hasText: /clear/i }).first().click({ force: true });
    await page.waitForTimeout(500);
    await closeEventPopover(page);

    // Verify count is 2
    await assertUnscheduledEventCount(page, 2);
  });
});
