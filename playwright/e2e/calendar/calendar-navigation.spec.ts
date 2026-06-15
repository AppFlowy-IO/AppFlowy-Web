/**
 * Calendar Navigation Tests (Desktop Parity)
 *
 * Tests calendar navigation and event loading.
 * Migrated from: cypress/e2e/calendar/calendar-navigation.cy.ts
 */
import { test, expect } from '@playwright/test';
import { CalendarSelectors } from '../../support/selectors';
import {
  generateRandomEmail,
  setupCalendarTest,
  loginAndCreateCalendar,
  waitForCalendarLoad,
  navigateToNext,
  navigateToPrevious,
  navigateToToday,
  doubleClickCalendarDay,
  editEventTitle,
  closeEventPopover,
  assertEventExists,
  getToday,
} from '../../support/calendar-test-helpers';

test.describe('Calendar Navigation Tests (Desktop Parity)', () => {
  test('navigate to next and previous month', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    // Get current month title
    const initialTitle = await CalendarSelectors.title(page).textContent();

    // Navigate to next month
    await navigateToNext(page);

    // Verify title changed
    const newTitle = await CalendarSelectors.title(page).textContent();
    expect(newTitle).not.toBe(initialTitle);

    // Navigate back
    await navigateToPrevious(page);

    // Verify we're back to original
    await expect(CalendarSelectors.title(page)).toContainText(initialTitle!.trim());
  });

  test('navigate to today button works', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    // Navigate away from current month
    await navigateToNext(page);
    await navigateToNext(page);

    // Click today button
    await navigateToToday(page);

    // Verify today's cell is visible
    await expect(CalendarSelectors.todayCell(page)).toBeVisible();
  });

  test('events load after month navigation', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create event on current month
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Current Month Event');
    await closeEventPopover(page);

    // Navigate to next month
    await navigateToNext(page);
    await page.waitForTimeout(1000);

    // Create event on next month (use 15th to be safe)
    const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    await doubleClickCalendarDay(page, nextMonthDate);
    await editEventTitle(page, 'Next Month Event');
    await closeEventPopover(page);

    // Verify next month event exists
    await assertEventExists(page, 'Next Month Event');

    // Navigate back to current month
    await navigateToPrevious(page);
    await page.waitForTimeout(1000);

    // Verify current month event still exists
    await assertEventExists(page, 'Current Month Event');

    // Navigate to next month again
    await navigateToNext(page);
    await page.waitForTimeout(1000);

    // Verify next month event is still there
    await assertEventExists(page, 'Next Month Event');
  });

  test('events persist across multiple month navigations', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Create event today
    await doubleClickCalendarDay(page, today);
    await editEventTitle(page, 'Today Event');
    await closeEventPopover(page);

    // Navigate 3 months forward
    await navigateToNext(page);
    await navigateToNext(page);
    await navigateToNext(page);

    // Navigate 3 months back to current
    await navigateToPrevious(page);
    await navigateToPrevious(page);
    await navigateToPrevious(page);
    await page.waitForTimeout(1000);

    // Verify event still exists
    await assertEventExists(page, 'Today Event');
  });

  test('previous month events load correctly', async ({ page, request }) => {
    setupCalendarTest(page);
    const email = generateRandomEmail();
    await loginAndCreateCalendar(page, request, email);
    await waitForCalendarLoad(page);

    const today = getToday();

    // Navigate to previous month first
    await navigateToPrevious(page);
    await page.waitForTimeout(1000);

    // Create event on previous month (use 10th to be safe)
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 10);
    await doubleClickCalendarDay(page, prevMonthDate);
    await editEventTitle(page, 'Previous Month Event');
    await closeEventPopover(page);

    // Navigate back to current month
    await navigateToNext(page);
    await page.waitForTimeout(1000);

    // Navigate to previous month again
    await navigateToPrevious(page);
    await page.waitForTimeout(1000);

    // Verify the event loads correctly
    await assertEventExists(page, 'Previous Month Event');
  });
});
