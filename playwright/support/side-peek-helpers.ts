/**
 * Shared helpers for the database side peek BDD step library
 * (playwright/bdd/steps/side-peek.steps.ts). Topic step files build on these
 * exports instead of re-driving the peek header, resizer and property editors.
 *
 * Selectors come from the feature code: `row-detail` carries `data-peek-mode`,
 * the header buttons are `row-detail-close`, `row-peek-mode-menu`,
 * `row-peek-previous`, `row-peek-next` and `row-detail-open-full-page`, and the
 * side slot is `database-side-peek` with its `row-peek-resizer` separator.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { FieldType, SortCondition } from '../../src/application/database-yjs/database.type';

import { createDatabaseView, waitForGridReady } from './database-ui-helpers';
import { openFeedCard } from './feed-test-helpers';
import { TextFilterCondition } from './filter-test-helpers';
import {
  createFieldDirect,
  databaseViewIds,
  getActiveDatabaseFields,
  getActiveRowIds,
  openGalleryRow,
  seedPrimaryTitlesDirect,
  setFiltersDirect,
  setSortsDirect,
} from './gallery-test-helpers';
import { ensureGridRows, renameCurrentDatabasePage, waitForDatabaseTestContext } from './relation-test-helpers';
import { closeRowDetail, closeRowDetailWithEscape, openRowDetailByRowId } from './row-detail-helpers';
import {
  BoardSelectors,
  CalendarSelectors,
  ChartSelectors,
  DatabaseFeedSelectors,
  DatabaseGallerySelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  DateTimeSelectors,
  HeaderSelectors,
  RowDetailSelectors,
  TimelineSelectors,
} from './selectors';
import { setupPageErrorHandling } from './test-config';
import { expectViewCreationAvailable } from './view-creation-availability';

export type PeekMode = 'side' | 'center';
export type PeekDirection = 'previous' | 'next';
export type PeekNavigationVia = 'button' | 'shortcut';
export type PeekCloseVia = 'button' | 'Escape' | 'backdrop';
export type PeekMenuItem = 'Side peek' | 'Center peek' | 'Open as full page' | 'Open in a new tab';
export type SidePeekFieldKind = 'text' | 'checkbox' | 'select' | 'date';
export type SidePeekLayout = 'Grid' | 'Board' | 'Calendar' | 'Chart' | 'List' | 'Gallery' | 'Feed' | 'Timeline';
export type SidePeekCardLayout = 'list' | 'gallery' | 'feed' | 'board' | 'timeline';

/** The previous/next hotkeys (Cmd/Ctrl+Shift+P / N) shared with desktop. */
export const PEEK_SHORTCUTS: Record<PeekDirection, string> = {
  previous: 'ControlOrMeta+Shift+P',
  next: 'ControlOrMeta+Shift+N',
};

export const PEEK_MENU_TEST_IDS: Partial<Record<PeekMenuItem, string>> = {
  'Side peek': 'row-peek-mode-side',
  'Center peek': 'row-peek-mode-center',
  'Open in a new tab': 'row-peek-new-tab',
};

const SIDE_PEEK_FIELD_TYPES: Record<SidePeekFieldKind, FieldType> = {
  text: FieldType.RichText,
  checkbox: FieldType.Checkbox,
  select: FieldType.SingleSelect,
  date: FieldType.DateTime,
};

/** Per-scenario state keyed by the fixture page; extra tabs are tracked here. */
export interface SidePeekState {
  pages: Page[];
  activePage: Page;
  peekWidthBefore?: number;
}

const states = new WeakMap<Page, SidePeekState>();

export function resetSidePeekState(rootPage: Page): SidePeekState {
  const state: SidePeekState = { pages: [rootPage], activePage: rootPage };

  states.set(rootPage, state);
  return state;
}

export function sidePeekState(rootPage: Page): SidePeekState {
  return states.get(rootPage) ?? resetSidePeekState(rootPage);
}

/** Steps act on the most recently selected browser tab, not always the fixture page. */
export function activeSidePeekPage(rootPage: Page): Page {
  return sidePeekState(rootPage).activePage;
}

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function peek(page: Page): Locator {
  return RowDetailSelectors.modal(page);
}

/** Scoped to the peek: a full row page renders its own `row-title-input`. */
export function peekTitle(page: Page): Locator {
  return peek(page).getByTestId('row-title-input');
}

export function peekDocument(page: Page): Locator {
  return peek(page).getByTestId('editor-content').first();
}

export function peekNavigationButton(page: Page, direction: PeekDirection): Locator {
  return page.getByTestId(`row-peek-${direction}`);
}

export function peekResizer(page: Page): Locator {
  return page.getByTestId('row-peek-resizer');
}

export function sidePeekSlot(page: Page): Locator {
  return page.getByTestId('database-side-peek');
}

export async function expectPeekOpen(page: Page, mode?: PeekMode, title?: string): Promise<void> {
  await expect(peek(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(peek(page)).toBeVisible();
  if (mode) await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);
  if (title !== undefined) await expect(peekTitle(page)).toHaveText(title, { timeout: 15_000 });
}

export async function expectNoPeek(page: Page): Promise<void> {
  await expect(peek(page)).toHaveCount(0, { timeout: 15_000 });
}

/** Side peek is nonmodal: the page behind it must stay interactive. */
export async function expectNoBackdrop(page: Page): Promise<void> {
  await expect(page.locator('.MuiBackdrop-root:visible')).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Fixtures: grid, fields, rows
// ---------------------------------------------------------------------------

export async function createGridWithRows(page: Page, name: string, titles: string[]): Promise<string[]> {
  await createDatabaseView(page, 'Grid', 7_000);
  await waitForGridReady(page);
  await renameCurrentDatabasePage(page, name);
  return seedGridRows(page, titles);
}

/** A new grid starts with three rows; more are added, fewer leave untitled rows. */
export async function seedGridRows(page: Page, titles: string[]): Promise<string[]> {
  await ensureGridRows(page, titles.length);
  const rowIds = await seedPrimaryTitlesDirect(page, titles);

  for (const title of titles) {
    await expect(DatabaseGridSelectors.grid(page)).toContainText(title, { timeout: 20_000 });
  }

  return rowIds;
}

export async function addFieldDirect(
  page: Page,
  kind: SidePeekFieldKind,
  name: string,
  options: string[] = []
): Promise<string> {
  const fieldId = await createFieldDirect(page, {
    name,
    fieldType: SIDE_PEEK_FIELD_TYPES[kind],
    // Option ids double as names, matching how the select menu creates options.
    selectOptions: kind === 'select' ? options.map((option) => ({ id: option, name: option })) : undefined,
  });

  if (await DatabaseGridSelectors.grid(page).isVisible()) {
    // The sticky header clones the field headers, so the test id appears twice.
    await expect(page.getByTestId(`grid-field-header-${fieldId}`).first()).toBeVisible({ timeout: 15_000 });
  }

  return fieldId;
}

export async function fieldByName(page: Page, name: string): Promise<{ id: string; type: FieldType }> {
  const field = (await getActiveDatabaseFields(page)).find((candidate) => candidate.name === name);

  if (!field) throw new Error(`No property named "${name}" in the active database view`);
  return { id: field.id, type: field.type };
}

export async function primaryFieldId(page: Page): Promise<string> {
  const field = (await getActiveDatabaseFields(page)).find((candidate) => candidate.isPrimary);

  if (!field) throw new Error('The active database view has no primary field');
  return field.id;
}

/** Row id by primary cell text: from the rendered grid when one is on screen, else via the test bridge. */
export async function rowIdByTitle(page: Page, title: string): Promise<string> {
  if (await DatabaseGridSelectors.grid(page).isVisible()) {
    const row = DatabaseGridSelectors.dataRows(page).filter({ has: page.getByText(title, { exact: true }) }).first();

    await expect(row).toBeAttached({ timeout: 15_000 });
    return (await row.getAttribute('data-testid'))!.replace('grid-row-', '');
  }

  await waitForDatabaseTestContext(page);
  let rowId = '';

  await expect
    .poll(
      async () => {
        rowId = await page.evaluate(async (rowTitle) => {
          // The bridge exposes untyped Yjs maps, like the other direct helpers.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
          const database = ctx.databaseDoc.getMap('data').get('database');
          const view = database.get('views').get(ctx.activeViewId);
          const fields = database.get('fields');
          const fieldOrders = view.get('field_orders').toArray() as Array<{ id: string }>;
          const primary =
            fieldOrders.find(({ id }) => Boolean(fields.get(id)?.get('is_primary')))?.id ?? fieldOrders[0]?.id;
          const rows = (view.get('row_orders').toArray() as Array<{ id: string; is_deleted?: boolean }>).filter(
            (row) => !row.is_deleted
          );

          for (const row of rows) {
            const rowDoc = ctx.rowMap?.[row.id] ?? (await ctx.ensureRow?.(row.id));
            const data = rowDoc?.getMap('data').get('data')?.get('cells')?.get(primary)?.get('data');

            if (String(data ?? '') === rowTitle) return row.id;
          }

          return '';
        }, title);
        return rowId;
      },
      { timeout: 15_000, message: `Waiting for a row titled "${title}"` }
    )
    .not.toBe('');
  return rowId;
}

/** Add a select option to the field's type option when missing, then select it on the row. */
export async function setSelectCellDirect(page: Page, rowId: string, fieldName: string, option: string): Promise<void> {
  const field = await fieldByName(page, fieldName);

  if (field.type !== FieldType.SingleSelect && field.type !== FieldType.MultiSelect) {
    throw new Error(`Property "${fieldName}" is not a select property`);
  }

  await page.evaluate(
    async ({ fieldId, fieldType, option, rowId }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const fieldMap = database.get('fields').get(fieldId);
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was unavailable`);
      ctx.databaseDoc.transact(() => {
        let typeOptionMap = fieldMap.get('type_option');

        if (!typeOptionMap) {
          typeOptionMap = new Y.Map();
          fieldMap.set('type_option', typeOptionMap);
        }

        let typeOption = typeOptionMap.get(String(fieldType));

        if (!typeOption) {
          typeOption = new Y.Map();
          typeOptionMap.set(String(fieldType), typeOption);
        }

        const content = JSON.parse(typeOption.get('content') || '{"disable_color":false,"options":[]}');
        const colors = ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue', 'Cream'];

        if (!content.options.some((candidate: { id: string }) => candidate.id === option)) {
          content.options.push({ id: option, name: option, color: colors[content.options.length % colors.length] });
          typeOption.set('content', JSON.stringify(content));
        }
      });
      rowDoc.transact(() => {
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        const now = String(Math.floor(Date.now() / 1000));

        cell.set('data', option);
        cell.set('field_type', fieldType);
        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        row.set('last_modified', now);
      });
    },
    { fieldId: field.id, fieldType: field.type, option, rowId }
  );
}

// ---------------------------------------------------------------------------
// Views and opening rows
// ---------------------------------------------------------------------------

function layoutContainer(page: Page, layout: SidePeekLayout): Locator {
  switch (layout) {
    case 'Board':
      return BoardSelectors.boardContainer(page);
    case 'Calendar':
      return CalendarSelectors.calendarContainer(page).first();
    case 'Chart':
      return ChartSelectors.anyChart(page).first();
    case 'List':
      return DatabaseListSelectors.list(page);
    case 'Gallery':
      return DatabaseGallerySelectors.gallery(page);
    case 'Feed':
      return DatabaseFeedSelectors.feed(page);
    case 'Timeline':
      return TimelineSelectors.view(page);
    default:
      return DatabaseViewSelectors.gridView(page);
  }
}

/** Add a tab of the given layout to the open database and wait for it to render. */
export async function addViewFromTabBar(page: Page, layout: SidePeekLayout): Promise<string> {
  const previous = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  const option = page.locator('[data-slot="dropdown-menu-content"]:visible').getByRole('menuitem', {
    name: layout,
    exact: true,
  });

  await expect(option).toBeVisible({ timeout: 10_000 });
  // Hosted quotas gate Chart and Timeline creation until the menu refreshes them.
  if (layout === 'Chart' || layout === 'Timeline') await expectViewCreationAvailable(option);
  await option.click();

  let viewId = '';

  await expect
    .poll(
      async () => {
        viewId = (await databaseViewIds(page)).find((candidate) => !previous.has(candidate)) ?? '';
        return viewId;
      },
      { timeout: 30_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);
  await expect(layoutContainer(page, layout)).toBeVisible({ timeout: 30_000 });
  await waitForDatabaseTestContext(page);
  return viewId;
}

export async function openRowFromGrid(page: Page, title: string): Promise<string> {
  const rowId = await rowIdByTitle(page, title);

  await openRowDetailByRowId(page, rowId);
  await expectPeekOpen(page, undefined, title);
  return rowId;
}

/** Click the card/row of a non-grid view; each layout opens the same peek. */
export async function openRowFromCardLayout(page: Page, layout: SidePeekCardLayout, title: string): Promise<string> {
  const rowId = await rowIdByTitle(page, title);

  switch (layout) {
    case 'list':
      await DatabaseListSelectors.rowById(page, rowId).click();
      break;
    case 'gallery':
      await openGalleryRow(page, rowId);
      break;
    case 'feed':
      await openFeedCard(page, rowId);
      break;
    case 'board':
      await BoardSelectors.cardByRowId(page, rowId).first().click();
      break;
    case 'timeline':
      await TimelineSelectors.sidebarRow(page, rowId).hover();
      await TimelineSelectors.openRow(page, rowId).click();
      break;
  }

  await expectPeekOpen(page, undefined, title);
  return rowId;
}

/** Click the calendar event, then its popover's "Open event" button (second to last header button). */
export async function openRowFromCalendarEvent(page: Page, title: string): Promise<void> {
  await CalendarSelectors.event(page).filter({ hasText: title }).first().click();
  const popover = page
    .locator('[data-radix-popper-content-wrapper]')
    .filter({ has: page.getByTestId('calendar-event-title-input') });

  await expect(popover).toBeVisible({ timeout: 10_000 });
  const buttons = popover.locator('.sticky button');
  const count = await buttons.count();

  if (count < 2) throw new Error('The calendar event popover has no open button');
  await buttons.nth(count - 2).click();
  await expectPeekOpen(page, undefined, title);
}

/** Drill into a chart bar (1-based) and open one of its rows from the dialog. */
export async function openRowFromChartDrilldown(page: Page, barIndex: number, title: string): Promise<void> {
  await expect(ChartSelectors.anyChart(page).first()).toBeVisible({ timeout: 15_000 });
  await ChartSelectors.bars(page).nth(barIndex - 1).click({ force: true });
  // The center peek is an MUI dialog too; the drill-down is the one with a DialogTitle.
  const dialog = page
    .locator('.MuiDialog-root:not([aria-hidden="true"])')
    .filter({ has: page.locator('.MuiDialogTitle-root') });

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: title, exact: true }).click();
  await expectPeekOpen(page, undefined, title);
}

/** `?r-modal=<row>` opens the peek on load; `?v=` is kept from the current URL. */
export async function openRowViaDeepLink(page: Page, title: string): Promise<void> {
  const rowId = await rowIdByTitle(page, title);
  const url = new URL(page.url());

  url.searchParams.set('r-modal', rowId);
  await page.goto(url.toString());
  await expectPeekOpen(page, undefined, title);
}

// ---------------------------------------------------------------------------
// Header: mode menu, navigation, close
// ---------------------------------------------------------------------------

/** Pick an "Open page in" item; returns the popup for "Open in a new tab". */
export async function choosePeekMenuItem(page: Page, item: PeekMenuItem): Promise<Page | undefined> {
  await page.getByTestId('row-peek-mode-menu').click();
  const testId = PEEK_MENU_TEST_IDS[item];
  const menuItem = testId ? page.getByTestId(testId) : page.getByRole('menuitem', { name: item, exact: true });

  await expect(menuItem).toBeVisible({ timeout: 10_000 });

  if (item === 'Open in a new tab') {
    const popupPromise = page.waitForEvent('popup');

    await menuItem.click();
    const popup = await popupPromise;

    setupPageErrorHandling(popup);
    await popup.setViewportSize({ width: 1440, height: 900 });
    await expect(popup).toHaveURL(/[?&]r=.+/, { timeout: 30_000 });
    return popup;
  }

  await menuItem.click();
  if (item === 'Side peek') await expectPeekOpen(page, 'side');
  if (item === 'Center peek') await expectPeekOpen(page, 'center');
  if (item === 'Open as full page') await expectFullRowPage(page);
  return undefined;
}

export async function expectFullRowPage(page: Page, title?: string): Promise<void> {
  await expectNoPeek(page);
  await expect(page).toHaveURL(/[?&]r=.+/, { timeout: 15_000 });
  if (title !== undefined) await expect(page.getByTestId('row-title-input')).toHaveText(title, { timeout: 15_000 });
}

/**
 * Move to the adjacent row and wait for the peek to show it, so consecutive
 * steps never race the re-render. At the boundary the shortcut is a no-op
 * (titles must be unique for the change detection).
 */
export async function navigatePeek(page: Page, direction: PeekDirection, via: PeekNavigationVia): Promise<void> {
  const current = await peekTitle(page).innerText();
  const hasTarget = await peekNavigationButton(page, direction).isEnabled();

  if (via === 'button') await peekNavigationButton(page, direction).click();
  else await page.keyboard.press(PEEK_SHORTCUTS[direction]);

  if (!hasTarget) {
    await expect(peekTitle(page)).toHaveText(current);
    return;
  }

  // The row remounts, so the title is briefly empty before the next one lands.
  await expect
    .poll(
      async () => {
        const title = await peekTitle(page).innerText();

        return title.trim() !== '' && title !== current;
      },
      { timeout: 15_000, message: `Waiting for the peek to leave "${current}"` }
    )
    .toBe(true);
}

async function stepPeek(page: Page, direction: PeekDirection): Promise<string> {
  const current = await peekTitle(page).innerText();

  await peekNavigationButton(page, direction).click();
  await expect(peekTitle(page)).not.toHaveText(current);
  return peekTitle(page).innerText();
}

/**
 * Walk to the first row with "previous", collect titles with "next", then
 * return to the row that was open (titles must be unique).
 */
export async function peekNavigationOrder(page: Page): Promise<string[]> {
  const start = await peekTitle(page).innerText();

  while (await peekNavigationButton(page, 'previous').isEnabled()) await stepPeek(page, 'previous');

  const titles = [await peekTitle(page).innerText()];

  while (await peekNavigationButton(page, 'next').isEnabled()) titles.push(await stepPeek(page, 'next'));

  for (let title = titles[titles.length - 1]; title !== start; ) title = await stepPeek(page, 'previous');

  return titles;
}

export async function closePeekVia(page: Page, via: PeekCloseVia): Promise<void> {
  if (via === 'button') {
    await closeRowDetail(page);
  } else if (via === 'Escape') {
    await closeRowDetailWithEscape(page);
  } else {
    // Center peek only: the dialog paper is centered, so the far left edge is backdrop.
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'center');
    await page.mouse.click(16, 450);
  }

  await expectNoPeek(page);
}

// ---------------------------------------------------------------------------
// Editing inside the peek
// ---------------------------------------------------------------------------

export async function setPeekTitle(page: Page, title: string): Promise<void> {
  await peekTitle(page).fill(title);
  await expect(peekTitle(page)).toHaveText(title);
}

/**
 * The property row is `.property-label` (name) + the editable cell wrapper next
 * to it. Duplicate names resolve to the first row, like `fieldByName`.
 */
export function peekPropertyValue(page: Page, name: string): Locator {
  return peek(page)
    .locator('.property-label')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
    .locator('xpath=..')
    .locator(':scope > div')
    .last();
}

export async function setPeekTextProperty(page: Page, name: string, value: string): Promise<void> {
  await peekPropertyValue(page, name).click();
  const editor = peek(page).getByTestId('rich-text-cell-editor');

  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.fill(value);
  // Enter commits the cell and closes its editor.
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0, { timeout: 10_000 });
  await expect(peekPropertyValue(page, name)).toContainText(value);
}

export async function togglePeekCheckbox(page: Page, name: string): Promise<boolean> {
  const checkbox = peekPropertyValue(page, name).locator('[data-testid^="checkbox-cell-"]');
  const wasChecked = (await checkbox.getAttribute('data-checked')) === 'true';

  await peekPropertyValue(page, name).click();
  await expect(checkbox).toHaveAttribute('data-checked', String(!wasChecked));
  return !wasChecked;
}

export async function choosePeekSelectOption(page: Page, name: string, option: string): Promise<void> {
  await peekPropertyValue(page, name).click();
  const menu = page.getByTestId('select-option-menu');

  await expect(menu).toBeVisible({ timeout: 10_000 });
  await menu.locator('[data-testid^="select-option-"]').filter({ hasText: option }).first().click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0, { timeout: 10_000 });
  await expect(peekPropertyValue(page, name)).toContainText(option);
}

/** `value` uses the field's date format; new date fields default to MM/DD/YYYY. */
export async function choosePeekDate(page: Page, name: string, value: string): Promise<void> {
  await peekPropertyValue(page, name).click();
  const popover = DateTimeSelectors.dateTimePickerPopover(page);

  await expect(popover).toBeVisible({ timeout: 10_000 });
  await DateTimeSelectors.dateTimeDateInput(page).fill(value);
  await page.keyboard.press('Enter');
  await expect(peekPropertyValue(page, name)).toContainText(value);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0, { timeout: 10_000 });
  await expectPeekOpen(page);
}

export async function expectPeekReadOnly(page: Page, readOnly: boolean): Promise<void> {
  await expect(peekTitle(page)).toBeVisible({ timeout: 15_000 });

  if (readOnly) {
    await expect(peekTitle(page)).not.toHaveAttribute('contenteditable', 'true');
    // A read-only row without document content renders no editor at all.
    if ((await peekDocument(page).count()) > 0) {
      await expect(peekDocument(page)).toHaveAttribute('contenteditable', 'false', { timeout: 15_000 });
    }

    await expect(page.getByTestId('row-detail-more-actions')).toHaveCount(0);
    return;
  }

  await expect(peekTitle(page)).toHaveAttribute('contenteditable', 'true');
  await expect(peekDocument(page)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  await expect(page.getByTestId('row-detail-more-actions')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Resizing the side slot
// ---------------------------------------------------------------------------

export async function readPeekWidth(page: Page): Promise<number> {
  await expect(peekResizer(page)).toBeVisible();
  return Number(await peekResizer(page).getAttribute('aria-valuenow'));
}

/** Drag the separator; a negative delta moves it left, which widens the peek. */
export async function dragPeekResizer(page: Page, deltaX: number): Promise<void> {
  const bounds = await peekResizer(page).boundingBox();

  if (!bounds) throw new Error('The side peek resizer has no layout box');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 100;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 8 });
  await page.mouse.up();
}

export async function pressPeekResizerKey(page: Page, key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'): Promise<void> {
  await peekResizer(page).focus();
  await page.keyboard.press(key);
}

export async function expectPeekWidthWithinBounds(page: Page): Promise<void> {
  const resizer = peekResizer(page);
  const min = Number(await resizer.getAttribute('aria-valuemin'));
  const max = Number(await resizer.getAttribute('aria-valuemax'));
  const now = await readPeekWidth(page);
  const slot = await sidePeekSlot(page).boundingBox();

  expect(now).toBeGreaterThanOrEqual(min);
  expect(now).toBeLessThanOrEqual(max);
  expect(slot).not.toBeNull();
  expect(Math.abs(slot!.width - now)).toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// Page lock, filters, sorts, search, tabs, reload
// ---------------------------------------------------------------------------

/** Toggle the page lock from the top bar; documents own the lock, so host grids in one. */
export async function setPageLocked(page: Page, locked: boolean): Promise<void> {
  await HeaderSelectors.moreActionsButton(page).click();
  const item = page.getByTestId('more-page-lock');

  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
  await expect(page.getByTestId('page-locked-badge')).toHaveCount(locked ? 1 : 0, { timeout: 15_000 });
  await page.keyboard.press('Escape');
}

export async function applyTextFilter(page: Page, fieldName: string, text: string): Promise<void> {
  const field = await fieldByName(page, fieldName);

  await setFiltersDirect(page, [
    { fieldId: field.id, fieldType: field.type, condition: TextFilterCondition.TextContains, content: text },
  ]);
}

export async function applySort(page: Page, fieldName: string, direction: 'ascending' | 'descending'): Promise<void> {
  const field = await fieldByName(page, fieldName);

  await setSortsDirect(page, [
    { fieldId: field.id, condition: direction === 'ascending' ? SortCondition.Ascending : SortCondition.Descending },
  ]);
}

export async function clearFiltersAndSorts(page: Page): Promise<void> {
  await setFiltersDirect(page, []);
  await setSortsDirect(page, []);
}

/** The search box exists on Gallery and Feed layouts only. */
export async function searchActiveView(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('database-actions-search-input');

  if (!(await input.isVisible())) await page.getByTestId('database-actions-search').click();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(text);
}

export async function clearActiveViewSearch(page: Page): Promise<void> {
  await page.getByTestId('database-actions-search-clear').click();
  await expect(page.getByTestId('database-actions-search-input')).toHaveCount(0);
}

/** Titles of the rendered rows/cards of whichever layout is on screen, in DOM order. */
export async function visibleRowTitles(page: Page): Promise<string[]> {
  if (await DatabaseGallerySelectors.gallery(page).isVisible()) {
    // A search keeps non-matching tiles mounted but hidden.
    return (
      await page.locator('[data-testid^="gallery-tile-"][data-row-id]:not([hidden]) .gallery-card-title').allInnerTexts()
    ).map((title) => title.trim());
  }

  if (await DatabaseFeedSelectors.feed(page).isVisible()) {
    return (
      await page
        .locator('[data-testid^="feed-card-"][data-row-id]:not([hidden]) [data-testid^="feed-card-title-"]')
        .allInnerTexts()
    ).map((title) => title.trim());
  }

  if (await DatabaseListSelectors.list(page).isVisible()) {
    return (await DatabaseListSelectors.primaryCells(page).allInnerTexts()).map((title) => title.trim());
  }

  const primary = await primaryFieldId(page);

  return (await DatabaseGridSelectors.dataRowCellsForField(page, primary).allInnerTexts()).map((title) =>
    title.trim()
  );
}

export async function gridCell(page: Page, rowTitle: string, fieldName: string): Promise<Locator> {
  const rowId = await rowIdByTitle(page, rowTitle);
  const field = await fieldByName(page, fieldName);

  return DatabaseGridSelectors.cellByIds(page, rowId, field.id);
}

export async function reloadDatabasePage(page: Page): Promise<void> {
  await page.reload();
  await expect(DatabaseViewSelectors.viewTab(page).first()).toBeVisible({ timeout: 30_000 });
  if (await DatabaseViewSelectors.gridView(page).isVisible()) await waitForGridReady(page);
  await waitForDatabaseTestContext(page);
}

/** Open the active tab's URL in another tab of the same context and make it active. */
export async function openSecondTab(rootPage: Page): Promise<Page> {
  const state = sidePeekState(rootPage);
  const url = state.activePage.url();
  const tab = await rootPage.context().newPage();

  setupPageErrorHandling(tab);
  await tab.setViewportSize({ width: 1440, height: 900 });
  await tab.goto(url);
  await expect(DatabaseViewSelectors.viewTab(tab).first()).toBeVisible({ timeout: 30_000 });
  await waitForDatabaseTestContext(tab);
  state.pages.push(tab);
  state.activePage = tab;
  return tab;
}

export function trackTab(rootPage: Page, tab: Page): void {
  const state = sidePeekState(rootPage);

  if (!state.pages.includes(tab)) state.pages.push(tab);
  state.activePage = tab;
}

export async function switchToTab(rootPage: Page, index: number): Promise<Page> {
  const state = sidePeekState(rootPage);
  const tab = state.pages[index - 1];

  if (!tab || tab.isClosed()) throw new Error(`Browser tab ${index} is not open`);
  await tab.bringToFront();
  state.activePage = tab;
  return tab;
}

export async function closeActiveTab(rootPage: Page): Promise<void> {
  const state = sidePeekState(rootPage);
  const tab = state.activePage;

  if (tab === rootPage) throw new Error('The first browser tab stays open for the scenario');
  await tab.close();
  state.pages = state.pages.filter((candidate) => candidate !== tab);
  state.activePage = rootPage;
  await rootPage.bringToFront();
}

export async function closeExtraTabs(rootPage: Page): Promise<void> {
  const state = states.get(rootPage);

  if (!state) return;
  for (const tab of state.pages.slice(1)) {
    if (!tab.isClosed()) await tab.close().catch(() => undefined);
  }

  states.delete(rootPage);
}

export { getActiveRowIds };
