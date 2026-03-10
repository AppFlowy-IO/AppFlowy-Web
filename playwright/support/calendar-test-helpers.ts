/**
 * Calendar test helpers for Playwright E2E tests
 * Migrated from: cypress/support/calendar-test-helpers.ts
 *
 * Provides utilities for calendar view testing using FullCalendar.
 */
import { Page, expect } from '@playwright/test';
import { CalendarSelectors, AddPageSelectors } from './selectors';
import { signInAndWaitForApp } from './auth-flow-helpers';
import { generateRandomEmail } from './test-config';

export { generateRandomEmail };

/**
 * Format date to YYYY-MM-DD for FullCalendar data-date attribute
 */
export function formatDateForCalendar(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Common setup for calendar tests (replaces beforeEach)
 */
export function setupCalendarTest(page: Page): void {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found')
    ) {
      return;
    }
  });
}

/**
 * Login and create a new calendar for testing
 */
export async function loginAndCreateCalendar(
  page: Page,
  request: import('@playwright/test').APIRequestContext,
  email: string
): Promise<void> {
  await signInAndWaitForApp(page, request, email);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await page.waitForTimeout(4000);

  // Create a new calendar via the inline add button dropdown
  await AddPageSelectors.inlineAddButton(page).first().click({ force: true });
  await page.waitForTimeout(800);

  // Click Calendar menu item (add-calendar-button testid doesn't exist in source)
  const calendarMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /^Calendar$/i });
  await expect(calendarMenuItem).toBeVisible({ timeout: 5000 });
  await calendarMenuItem.click({ force: true });

  // Wait for calendar to fully load (FullCalendar can be slow)
  await expect(CalendarSelectors.calendarContainer(page).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
}

/**
 * Wait for calendar to load
 */
export async function waitForCalendarLoad(page: Page): Promise<void> {
  await expect(CalendarSelectors.calendarContainer(page).first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.fc-view-harness').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);
}

/**
 * Navigate to next month/week
 */
export async function navigateToNext(page: Page): Promise<void> {
  await CalendarSelectors.nextButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Navigate to previous month/week
 */
export async function navigateToPrevious(page: Page): Promise<void> {
  await CalendarSelectors.prevButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Navigate to today
 */
export async function navigateToToday(page: Page): Promise<void> {
  await CalendarSelectors.todayButton(page).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Double-click on a specific calendar day to create an event
 */
export async function doubleClickCalendarDay(page: Page, date: Date): Promise<void> {
  const dateStr = formatDateForCalendar(date);
  await CalendarSelectors.dayCellByDate(page, dateStr).dblclick({ force: true });
  await page.waitForTimeout(1000);
}

/**
 * Click on an event by index
 */
export async function clickEvent(page: Page, eventIndex: number = 0): Promise<void> {
  await CalendarSelectors.event(page).nth(eventIndex).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Edit event title in the popover
 */
export async function editEventTitle(page: Page, newTitle: string): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  const titleInput = popover.locator('input, textarea, [contenteditable="true"]').first();
  await titleInput.fill('');
  await titleInput.pressSequentially(newTitle, { delay: 30 });
  await page.waitForTimeout(500);
}

/**
 * Close event popover
 */
export async function closeEventPopover(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/**
 * Delete event from popover
 */
export async function deleteEventFromPopover(page: Page): Promise<void> {
  // The delete button is icon-only (no text), use data-testid
  const deleteButton = page.getByTestId('calendar-event-delete');
  await expect(deleteButton).toBeVisible({ timeout: 5000 });
  await deleteButton.click({ force: true });
  await page.waitForTimeout(500);

  // Handle delete confirmation dialog
  const confirmButton = page.getByTestId('delete-row-confirm-button');
  const confirmCount = await confirmButton.count();
  if (confirmCount > 0 && await confirmButton.isVisible()) {
    await confirmButton.click({ force: true });
    await page.waitForTimeout(500);
  }
}

/**
 * Assert the total number of visible events in the calendar
 */
export async function assertTotalEventCount(page: Page, expectedCount: number): Promise<void> {
  await expect(CalendarSelectors.event(page)).toHaveCount(expectedCount, { timeout: 10000 });
}

/**
 * Assert event exists with specific title
 */
export async function assertEventExists(page: Page, title: string): Promise<void> {
  await expect(CalendarSelectors.event(page).filter({ hasText: title })).toBeVisible({ timeout: 10000 });
}

/**
 * Assert the number of events on a specific day
 */
export async function assertEventCountOnDay(page: Page, date: Date, expectedCount: number): Promise<void> {
  const dateStr = formatDateForCalendar(date);
  const dayCell = CalendarSelectors.dayCellByDate(page, dateStr);
  await expect(dayCell.locator('.fc-event')).toHaveCount(expectedCount, { timeout: 10000 });
}

/**
 * Assert number of unscheduled events
 */
export async function assertUnscheduledEventCount(page: Page, expectedCount: number): Promise<void> {
  const noDateButton = page.locator('.no-date-button, button:has-text("No date")');
  if (expectedCount === 0) {
    await expect(noDateButton).toHaveCount(0);
  } else {
    await expect(noDateButton).toContainText(`(${expectedCount})`);
  }
}

/**
 * Open the unscheduled events popup
 */
export async function openUnscheduledEventsPopup(page: Page): Promise<void> {
  await page.locator('.no-date-button, button:has-text("No date")').click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Click on an unscheduled event in the popup
 */
export async function clickUnscheduledEvent(page: Page, index: number = 0): Promise<void> {
  await page.getByTestId('no-date-row').nth(index).click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Drag an event to a new date
 */
export async function dragEventToDate(page: Page, eventIndex: number, targetDate: Date): Promise<void> {
  const event = CalendarSelectors.event(page).nth(eventIndex);
  const dateStr = formatDateForCalendar(targetDate);
  const targetCell = CalendarSelectors.dayCellByDate(page, dateStr);
  await event.dragTo(targetCell);
  await page.waitForTimeout(1000);
}

/**
 * Get today's date
 */
export function getToday(): Date {
  return new Date();
}

/**
 * Get a date relative to today
 */
export function getRelativeDate(daysFromToday: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date;
}

/**
 * Click on a DateTime property cell in the event popover to open the date picker.
 * The event popover renders RowPropertyPrimitive for each field, including DateTime.
 * Clicking the DateTime cell sets editing=true, which renders the DateTimeCellPicker.
 */
export async function openDatePickerInEventPopover(page: Page): Promise<void> {
  const popover = page.locator('[data-radix-popper-content-wrapper]').last();
  // DateTime cells have data-testid starting with "datetime-cell-"
  const dateTimeCell = popover.locator('[data-testid^="datetime-cell-"]');
  await expect(dateTimeCell.first()).toBeVisible({ timeout: 5000 });
  await dateTimeCell.first().click({ force: true });
  await page.waitForTimeout(500);
  // Wait for the DateTimeCellPicker popover to appear
  await expect(page.getByTestId('datetime-picker-popover')).toBeVisible({ timeout: 5000 });
}

/**
 * Select a specific day number in the DateTimeCellPicker calendar.
 * Uses react-day-picker day buttons inside the datetime-picker-popover.
 */
export async function selectDayInDatePicker(page: Page, dayNumber: number): Promise<void> {
  const pickerPopover = page.getByTestId('datetime-picker-popover');
  // react-day-picker renders day buttons inside table cells with role="gridcell"
  // Each day button has the day number as text
  const dayRegex = new RegExp(`^${dayNumber}$`);
  const dayButton = pickerPopover.locator('button').filter({ hasText: dayRegex }).first();
  await expect(dayButton).toBeVisible({ timeout: 5000 });
  await dayButton.click({ force: true });
  await page.waitForTimeout(500);
}

/**
 * Click the "Clear date" button in the DateTimeCellPicker to remove the date.
 */
export async function clearDateInPicker(page: Page): Promise<void> {
  const clearButton = page.getByTestId('clear-date-button');
  await expect(clearButton).toBeVisible({ timeout: 5000 });
  await clearButton.click({ force: true });
  await page.waitForTimeout(500);
}
