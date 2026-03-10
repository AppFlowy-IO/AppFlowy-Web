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
  assertTotalEventCount,
  assertEventCountOnDay,
  assertUnscheduledEventCount,
  openDatePickerInEventPopover,
  selectDayInDatePicker,
  clearDateInPicker,
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

    // Click on the event to open popover
    await clickEvent(page, 0);
    await page.waitForTimeout(500);

    // Open the date picker by clicking on the DateTime property cell
    await openDatePickerInEventPopover(page);

    // Select day 20 from the date picker
    await selectDayInDatePicker(page, 20);
    await page.waitForTimeout(500);

    // Close the date picker and event popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

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

    // Click on the event to open popover
    await clickEvent(page, 0);
    await page.waitForTimeout(500);

    // Open the date picker
    await openDatePickerInEventPopover(page);

    // Click "Clear date" to unschedule
    await clearDateInPicker(page);
    await page.waitForTimeout(500);

    // Close the event popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify event is removed from calendar view
    await assertTotalEventCount(page, 0);

    // Verify unscheduled event count
    await assertUnscheduledEventCount(page, 1);
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
    await openDatePickerInEventPopover(page);
    await clearDateInPicker(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify count is 1
    await assertUnscheduledEventCount(page, 1);

    // Clear date on second event
    await CalendarSelectors.event(page).filter({ hasText: 'Event 2' }).click({ force: true });
    await page.waitForTimeout(500);
    await openDatePickerInEventPopover(page);
    await clearDateInPicker(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify count is 2
    await assertUnscheduledEventCount(page, 2);
  });
});
