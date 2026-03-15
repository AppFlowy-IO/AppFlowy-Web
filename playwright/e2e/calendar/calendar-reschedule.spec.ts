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
    // Given: a calendar with an event on today
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();
    const tomorrow = getRelativeDate(1);

    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Drag Test Event');
    await closeEventPopover(page);
    await assertEventCountOnDay(page, today, 1);

    // When: dragging the event to tomorrow
    await dragEventToDate(page, 0, tomorrow);

    // Then: the event appears on tomorrow
    await assertEventCountOnDay(page, tomorrow, 1);
    // And: the event is removed from today
    await assertEventCountOnDay(page, today, 0);
  });

  test('reschedule via date picker in event popover', async ({ page, request }) => {
    // Given: a calendar with an event created on today
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Date Picker Test');
    await closeEventPopover(page);

    // When: opening the event popover and selecting a different day in the date picker
    await clickEvent(page, 0);
    await page.waitForTimeout(500);
    await openDatePickerInEventPopover(page);

    const targetDay = today.getDate() === 15 ? 16 : 15;

    // Calendar events default to range mode (End date ON).
    // Disable it so clicking a day changes the single date, not the end date.
    const pickerPopover = page.getByTestId('datetime-picker-popover');
    const endDateSwitch = pickerPopover.locator('button[role="switch"]').first();
    if ((await endDateSwitch.getAttribute('data-state')) === 'checked') {
      await endDateSwitch.click({ force: true });
      await page.waitForTimeout(500);
    }

    await selectDayInDatePicker(page, targetDay);
    await page.waitForTimeout(1000);

    // And: closing the date picker and event popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Then: the event is rescheduled to the target day
    const targetDate = new Date(today.getFullYear(), today.getMonth(), targetDay);
    await assertEventCountOnDay(page, targetDate, 1);
  });

  test('clear date makes event unscheduled', async ({ page, request }) => {
    // Given: a calendar with one scheduled event
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Unschedule Test');
    await closeEventPopover(page);
    await assertTotalEventCount(page, 1);

    // When: clearing the date via the event popover date picker
    await clickEvent(page, 0);
    await page.waitForTimeout(500);
    await openDatePickerInEventPopover(page);
    await clearDateInPicker(page);
    await page.waitForTimeout(500);

    // And: closing the event popover
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the event is removed from the calendar view
    await assertTotalEventCount(page, 0);
    // And: the event appears in the unscheduled list
    await assertUnscheduledEventCount(page, 1);
  });

  test('unscheduled events popup shows correct count', async ({ page, request }) => {
    // Given: a calendar with two scheduled events
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();
    const tomorrow = getRelativeDate(1);

    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Event 1');
    await closeEventPopover(page);

    await doubleClickCalendarDay(page, tomorrow);
    await editEventTitle(page, 'Event 2');
    await closeEventPopover(page);

    // When: clearing the date on the first event
    await CalendarSelectors.event(page).filter({ hasText: 'Event 1' }).click({ force: true });
    await page.waitForTimeout(500);
    await openDatePickerInEventPopover(page);
    await clearDateInPicker(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the unscheduled count is 1
    await assertUnscheduledEventCount(page, 1);

    // When: clearing the date on the second event
    await CalendarSelectors.event(page).filter({ hasText: 'Event 2' }).click({ force: true });
    await page.waitForTimeout(500);
    await openDatePickerInEventPopover(page);
    await clearDateInPicker(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Then: the unscheduled count is 2
    await assertUnscheduledEventCount(page, 2);
  });
});
