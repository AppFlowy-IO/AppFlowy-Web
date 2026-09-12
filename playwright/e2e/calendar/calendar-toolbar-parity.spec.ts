import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { calendarDraftTitle, switchPlaceholderCalendarView } from '../../support/calendar-placeholder-helpers';
import { loginAndCreateCalendar, switchCalendarView } from '../../support/calendar-test-helpers';
import { getSlashMenuItemName } from '../../support/i18n-constants';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import {
  BlockSelectors,
  CalendarSelectors,
  DatabaseViewSelectors,
  SlashCommandSelectors,
} from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

async function today(page: Page) {
  return page.evaluate(() => {
    const date = new Date();

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
      2,
      '0'
    )}`;
  });
}

function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`);

  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function range(start: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDays(start, index));
}

function nextMonth(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDate();

  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();

  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

async function expectRadius(locator: Locator, radius: number) {
  await expect(locator).toHaveCSS('border-top-left-radius', `${radius}px`);
  await expect(locator).toHaveCSS('border-bottom-right-radius', `${radius}px`);
}

async function displayedDates(page: Page) {
  return page
    .locator('.fc-view .fc-timegrid-col[data-date]')
    .evaluateAll((columns) => columns.map((column) => column.getAttribute('data-date')));
}

async function clickNavigation(page: Page, direction: 'next' | 'prev' | 'today') {
  const selector = {
    next: CalendarSelectors.nextButton,
    prev: CalendarSelectors.prevButton,
    today: CalendarSelectors.todayButton,
  }[direction];

  await selector(page).filter({ visible: true }).last().click();
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await locator.boundingBox();

  expect(result).not.toBeNull();
  return result!;
}

test('calendar custom ranges navigate by their exact day count and standard views reset to today', async ({
  page,
  request,
}, testInfo) => {
  setupPageErrorHandling(page);
  await page.addInitScript(() => localStorage.setItem('dark-mode', 'true'));
  await loginAndCreateCalendar(page, request, generateRandomEmail());
  const currentDate = await today(page);
  const initialTitle = (await CalendarSelectors.title(page).first().textContent())!.trim();

  await expect(CalendarSelectors.viewSelect(page)).toHaveText('Month');
  await expect(CalendarSelectors.viewSelect(page)).toHaveCSS('height', '28px');
  await expect(CalendarSelectors.todayButton(page)).toHaveCSS('height', '28px');
  await expectRadius(CalendarSelectors.viewSelect(page), 8);
  await expectRadius(CalendarSelectors.todayButton(page), 8);
  await CalendarSelectors.toolbar(page).screenshot({ path: testInfo.outputPath('calendar-toolbar-desktop.png') });
  await CalendarSelectors.viewSelect(page).click();
  await expectRadius(page.getByRole('menu'), 12);
  await expect(CalendarSelectors.monthViewOption(page)).toHaveAttribute('aria-checked', 'true');
  await expect(CalendarSelectors.weekViewOption(page)).toHaveAttribute('aria-checked', 'false');
  await expectRadius(CalendarSelectors.weekViewOption(page), 6);
  await page.getByRole('menu').screenshot({ path: testInfo.outputPath('calendar-view-menu.png') });
  await CalendarSelectors.numberOfDaysMenu(page).click();
  for (const count of [2, 3, 4, 5, 6, 8]) {
    await expect(CalendarSelectors.customDayOption(page, count)).toBeVisible();
  }
  await expectRadius(page.getByRole('menu').last(), 12);
  await expectRadius(CalendarSelectors.customDayOption(page, 2), 6);
  await expect(CalendarSelectors.customDayOption(page, 7)).toHaveCount(0);
  await page
    .getByRole('menu')
    .last()
    .screenshot({ path: testInfo.outputPath('calendar-day-count-menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Standard navigation retains the focused day, even when its visible range starts earlier.
  await clickNavigation(page, 'next');
  await switchCalendarView(page, 2);
  await expect.poll(() => displayedDates(page)).toEqual(range(nextMonth(currentDate), 2));
  await switchCalendarView(page, 'Week');
  await clickNavigation(page, 'next');
  await switchCalendarView(page, 2);
  await expect.poll(() => displayedDates(page)).toEqual(range(addDays(currentDate, 7), 2));
  await switchCalendarView(page, 'Month');

  for (const days of [2, 3, 4, 5, 6, 8] as const) {
    await switchCalendarView(page, days);
    await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, days));
    await clickNavigation(page, 'next');
    await expect.poll(() => displayedDates(page)).toEqual(range(addDays(currentDate, days), days));
    await clickNavigation(page, 'prev');
    await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, days));
    await CalendarSelectors.viewSelect(page).filter({ visible: true }).last().click();
    await CalendarSelectors.numberOfDaysMenu(page).click();
    await expect(CalendarSelectors.customDayOption(page, days)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }

  // Four eight-day steps must cross a month boundary without snapping to a week.
  for (let offset = 8; offset <= 32; offset += 8) {
    await clickNavigation(page, 'next');
    await expect.poll(() => displayedDates(page)).toEqual(range(addDays(currentDate, offset), 8));
  }
  expect(addDays(currentDate, 32).slice(0, 7)).not.toBe(currentDate.slice(0, 7));
  await clickNavigation(page, 'today');
  await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, 8));
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('8 days');
  await clickNavigation(page, 'next');
  await switchPlaceholderCalendarView(page, 'Week');
  const week = await displayedDates(page);

  expect(week).toHaveLength(7);
  expect(week).toContain(currentDate);
  await clickNavigation(page, 'next');
  await expect.poll(() => displayedDates(page)).toEqual(week.map((date) => addDays(date!, 7)));
  await switchPlaceholderCalendarView(page, 'Month');
  await expect(CalendarSelectors.title(page).filter({ visible: true }).last()).toHaveText(initialTitle);
  await expect(page.locator('.fc-daygrid-day.fc-day-today')).toBeVisible();
});

test('calendar shortcuts navigate once with a sticky toolbar and leave focused event input alone', async ({
  page,
  request,
}, testInfo) => {
  setupPageErrorHandling(page);
  await loginAndCreateCalendar(page, request, generateRandomEmail());
  await switchCalendarView(page, 'Week');
  const initialDates = await displayedDates(page);

  await page.evaluate(() => {
    const calendar = document.querySelector('.database-calendar:not(.sticky-header-wrapper)');
    let scroller = calendar?.parentElement;

    while (
      scroller &&
      (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) || scroller.scrollHeight <= scroller.clientHeight)
    ) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('The calendar has no scrollable viewport');
    scroller.scrollTop = 450;
    (document.querySelector('.calendar-wrapper') as HTMLElement).focus({ preventScroll: true });
  });
  await expect(CalendarSelectors.toolbar(page)).toHaveCount(2);
  await page.keyboard.press('j');
  await expect.poll(() => displayedDates(page)).toEqual(initialDates.map((date) => addDays(date!, 7)));
  await page.keyboard.press('k');
  await expect.poll(() => displayedDates(page)).toEqual(initialDates);
  await CalendarSelectors.toolbar(page)
    .last()
    .screenshot({ path: testInfo.outputPath('calendar-sticky-toolbar.png') });
  await page.keyboard.press('m');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await page.keyboard.press('j');
  await expect.poll(() => displayedDates(page)).toEqual(initialDates.map((date) => addDays(date!, 7)));
  await page.keyboard.press('t');
  await expect.poll(() => displayedDates(page)).toEqual(initialDates);
  await page.keyboard.press('3');
  const currentDate = await today(page);

  await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, 3));
  await page.keyboard.press('j');
  await expect.poll(() => displayedDates(page)).toEqual(range(addDays(currentDate, 3), 3));
  await page.keyboard.press('m');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await clickNavigation(page, 'next');
  const day = page.locator('.fc-daygrid-day:not(.fc-day-other)').nth(10);
  const dayDate = await day.getAttribute('data-date');
  const monthBeforeTyping = new Date(`${dayDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  await expect(CalendarSelectors.title(page).filter({ visible: true }).last()).toHaveText(monthBeforeTyping);
  await day.scrollIntoViewIfNeeded();
  const dayBox = await box(day);

  await page.mouse.click(dayBox.x + dayBox.width / 2, dayBox.y + 10);
  const input = calendarDraftTitle(page);

  await expect(input).toBeVisible();
  await input.fill('Keyboard guard ');
  await input.pressSequentially('jkwmt');
  await expect(input).toHaveValue('Keyboard guard jkwmt');
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('Month');
  await expect(CalendarSelectors.title(page).filter({ visible: true }).last()).toHaveText(monthBeforeTyping);
  await page.keyboard.press('Escape');
});

test('calendar toolbar and day-count picker stay usable in a narrow desktop window', async ({
  page,
  request,
}, testInfo) => {
  setupPageErrorHandling(page);
  await loginAndCreateCalendar(page, request, generateRandomEmail());
  await page.setViewportSize({ width: 430, height: 900 });
  const toolbar = CalendarSelectors.toolbar(page).first();

  // Sample all bounds together so responsive reflow cannot mix two layouts.
  await expect
    .poll(() =>
      toolbar.evaluate((element) => {
        const toolbarBox = element.getBoundingClientRect();
        const controls = [
          'calendar-view-select',
          'calendar-prev-button',
          'calendar-today-button',
          'calendar-next-button',
        ].map((id) => element.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect());
        const problems: string[] = [];

        controls.forEach((control, index) => {
          if (control.width === 0 || control.x < 0 || control.right > 430)
            problems.push(`control ${index} outside viewport`);
          if (control.y < toolbarBox.y || control.bottom > toolbarBox.bottom)
            problems.push(`control ${index} outside toolbar`);
          for (const other of controls.slice(index + 1)) {
            const width = Math.max(0, Math.min(control.right, other.right) - Math.max(control.x, other.x));
            const height = Math.max(0, Math.min(control.bottom, other.bottom) - Math.max(control.y, other.y));

            if (width * height > 0) problems.push(`control ${index} overlaps another control`);
          }
        });
        return problems;
      })
    )
    .toEqual([]);
  await toolbar.screenshot({ path: testInfo.outputPath('calendar-toolbar-compact.png') });
  await CalendarSelectors.viewSelect(page).first().click();
  await CalendarSelectors.numberOfDaysMenu(page).click();
  const submenu = page.getByRole('menu').last();

  await expect.poll(async () => (await box(submenu)).x).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const submenuBox = await box(submenu);

      return submenuBox.x + submenuBox.width;
    })
    .toBeLessThanOrEqual(430);
  await submenu.screenshot({ path: testInfo.outputPath('calendar-day-count-menu-compact.png') });
  await CalendarSelectors.customDayOption(page, 3).click();
  const currentDate = await today(page);

  await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, 3));
  await clickNavigation(page, 'next');
  await expect.poll(() => displayedDates(page)).toEqual(range(addDays(currentDate, 3), 3));
  await clickNavigation(page, 'today');
  await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, 3));
});

test('calendar tabs retain their own range and wheel navigation preserves the focused day', async ({
  page,
  request,
}) => {
  setupPageErrorHandling(page);
  await loginAndCreateCalendar(page, request, generateRandomEmail());
  const currentDate = await today(page);

  // Scroll past the month boundary using the real wheel handler.
  const calendar = page.locator('.database-calendar:not(.sticky-header-wrapper)');

  await calendar.evaluate((element) => {
    let scroller = element.closest('.appflowy-scroll-container') || element.parentElement;

    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('The calendar has no scrollable viewport');
    scroller.scrollTop = scroller.scrollHeight;
  });
  await calendar.dispatchEvent('wheel', { deltaY: 600, deltaX: 0, bubbles: true, cancelable: true });
  await switchCalendarView(page, 4);
  await expect.poll(() => displayedDates(page)).toEqual(range(nextMonth(currentDate), 4));

  const firstTabId = (await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid'))!;

  await DatabaseViewSelectors.addViewButton(page).click();
  await DatabaseViewSelectors.viewTypeOption(page, 'Calendar').click();
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(2);
  await expect(DatabaseViewSelectors.activeViewTab(page)).not.toHaveAttribute('data-testid', firstTabId);
  const secondTabId = (await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid'))!;

  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('Month');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await expect(page.locator('.fc-timeGrid4Days-view')).toHaveCount(0);
  await page.getByTestId(firstTabId).click();
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('4 days');
  await expect(page.locator('.fc-timeGrid4Days-view')).toBeVisible();
  await expect.poll(() => displayedDates(page)).toHaveLength(4);
  await page.getByTestId(secondTabId).click();
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('Month');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
});

test('a real embedded calendar handles shortcuts inside Slate without navigating while document text is typed', async ({
  page,
  request,
}) => {
  setupPageErrorHandling(page);
  await signInAndWaitForApp(page, request, generateRandomEmail());
  const documentViewId = await createDocumentPageAndNavigate(page);
  const editor = page.locator(`#editor-${documentViewId}`);

  await expect(editor).toHaveAttribute('data-slate-editor', 'true');
  await expect(editor).toHaveAttribute('role', 'textbox');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click({ position: { x: 200, y: 50 } });
  await page.keyboard.type('Calendar keyboard notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(SlashCommandSelectors.slashPanel(page)).toBeVisible();
  await SlashCommandSelectors.slashMenuItem(page, getSlashMenuItemName('calendar')).first().click();

  const embeddedCalendar = editor.locator(BlockSelectors.blockSelector('calendar'));

  await expect(embeddedCalendar).toBeVisible();
  await expect(embeddedCalendar.locator('.fc-dayGridMonth-view')).toBeVisible();
  // New database creation opens its page in a dialog above the embedded block.
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calendarWrapper = embeddedCalendar.locator('.calendar-wrapper');

  await calendarWrapper.click({ position: { x: 10, y: 10 } });
  await expect(calendarWrapper).toBeFocused();
  const currentDate = await today(page);

  await page.keyboard.press('4');
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('4 days');
  await expect(embeddedCalendar.locator('.fc-timeGrid4Days-view')).toBeVisible();
  await expect.poll(() => displayedDates(page)).toEqual(range(currentDate, 4));
  await page.keyboard.press('j');
  const navigatedDates = range(addDays(currentDate, 4), 4);

  await expect.poll(() => displayedDates(page)).toEqual(navigatedDates);

  const paragraph = editor
    .locator(BlockSelectors.blockSelector('paragraph'))
    .filter({ hasText: 'Calendar keyboard notes' });

  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 3jkwmt');
  await expect(paragraph).toHaveText('Calendar keyboard notes 3jkwmt');
  await expect(CalendarSelectors.viewSelect(page).filter({ visible: true }).last()).toHaveText('4 days');
  await expect.poll(() => displayedDates(page)).toEqual(navigatedDates);
});
