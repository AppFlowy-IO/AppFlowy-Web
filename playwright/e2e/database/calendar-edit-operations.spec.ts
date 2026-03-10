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
  await expect(CalendarSelectors.calendarContainer(page)).toBeVisible({ timeout: 15000 });
  // Ensure at least 28 day cells are rendered (a full month)
  const dayCellCount = await CalendarSelectors.dayCell(page).count();
  expect(dayCellCount).toBeGreaterThanOrEqual(28);
}

/**
 * Helper: Create an event by clicking a day cell
 */
async function createEventOnCell(page: import('@playwright/test').Page, cellIndex: number, eventName: string) {
  await CalendarSelectors.dayCell(page).nth(cellIndex).click({ force: true });
  await page.waitForTimeout(1500);

  // Try typing into a visible input (event creation inline)
  const visibleInputs = page.locator('input:visible');
  const inputCount = await visibleInputs.count();

  if (inputCount > 0) {
    await visibleInputs.last().fill(eventName);
    await page.keyboard.press('Enter');
  } else {
    // Fallback: try hover + add button or double-click
    await CalendarSelectors.dayCell(page).nth(cellIndex).hover();
    await page.waitForTimeout(300);

    const addButton = page.locator('[data-add-button]');
    const addButtonCount = await addButton.count();

    if (addButtonCount > 0) {
      await addButton.first().click();
      await page.waitForTimeout(500);
      await page.locator('input:visible').last().fill(eventName);
      await page.keyboard.press('Enter');
    } else {
      await CalendarSelectors.dayCell(page).nth(cellIndex).dblclick({ force: true });
      await page.waitForTimeout(500);
      const inputsAfter = page.locator('input:visible');
      const inputCountAfter = await inputsAfter.count();

      if (inputCountAfter > 0) {
        await inputsAfter.last().fill(eventName);
        await page.keyboard.press('Enter');
      }
    }
  }

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
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName)).toBeVisible({ timeout: 10000 });

    // When: adding a Grid view via the database tabbar "+" button
    await DatabaseViewSelectors.addViewButton(page).click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('[role="menuitem"]').filter({ hasText: 'Grid' }).click({ force: true });
    await page.waitForTimeout(3000);

    // Then: the Grid view should load
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    // And: the event should appear in the Grid view
    await expect(DatabaseGridSelectors.grid(page).getByText(eventName)).toBeVisible({ timeout: 10000 });

    // When: switching back to the Calendar view via tab
    await page.locator('[data-testid^="view-tab-"]').filter({ hasText: 'Calendar' }).click({ force: true });
    await page.waitForTimeout(2000);

    // Then: the calendar should still show the event
    await expect(CalendarSelectors.calendarContainer(page)).toBeVisible({ timeout: 15000 });
    await expect(CalendarSelectors.calendarContainer(page).getByText(eventName)).toBeVisible({ timeout: 10000 });
  });
});
