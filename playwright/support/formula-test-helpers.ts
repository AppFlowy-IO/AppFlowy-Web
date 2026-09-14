/**
 * Formula field helpers for the Playwright BDD suite.
 *
 * Fixture data (input property cells, select options) is seeded through the
 * test-only `__TEST_DATABASE_CONTEXT__` hook so scenarios stay fast; every
 * formula behaviour under test goes through the production UI.
 */
import { expect, type Page } from '@playwright/test';

import { addFieldWithType } from './field-type-helpers';
import { DatabaseGridSelectors, FieldType, GridFieldSelectors, PropertyMenuSelectors } from './selectors';

export type FormulaInputType =
  | 'Text'
  | 'Number'
  | 'Checkbox'
  | 'Date'
  | 'Select'
  | 'MultiSelect'
  | 'URL'
  | 'Checklist'
  | 'CreatedTime'
  | 'EditedTime'
  | 'Formula';

const INPUT_FIELD_TYPES: Record<FormulaInputType, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  Checkbox: FieldType.Checkbox,
  Date: FieldType.DateTime,
  Select: FieldType.SingleSelect,
  MultiSelect: FieldType.MultiSelect,
  URL: FieldType.URL,
  Checklist: FieldType.Checklist,
  CreatedTime: FieldType.CreatedTime,
  EditedTime: FieldType.LastEditedTime,
  Formula: FieldType.Formula,
};

/** Number formats as they appear in the property menu (values from NumberFormat). */
export const NUMBER_FORMAT_IDS: Record<string, number> = {
  Number: 0,
  'US dollar': 1,
  Euro: 4,
  Percent: 36,
};

/** Show as options (values from RollupShowAsType). */
export const SHOW_AS_IDS: Record<string, number> = { Number: 0, Bar: 1, Ring: 2 };

export const formulaDialog = (page: Page) => page.getByTestId('formula-editor-dialog');
export const formulaInput = (page: Page) => page.getByTestId('formula-editor-input');

export function fieldIdFromHeader(testId: string | null): string {
  return testId?.replace('grid-field-header-', '') ?? '';
}

export async function lastFieldId(page: Page): Promise<string> {
  return fieldIdFromHeader(await GridFieldSelectors.allFieldHeaders(page).last().getAttribute('data-testid'));
}

export async function fieldIdByName(page: Page, name: string): Promise<string> {
  const header = page.locator('[data-testid^="grid-field-header-"]').filter({ hasText: name }).first();

  await expect(header).toBeVisible({ timeout: 15000 });
  return fieldIdFromHeader(await header.getAttribute('data-testid'));
}

async function dismissMenus(page: Page) {
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

/** Opens the property menu of a column and returns once the name input is visible. */
export async function openPropertyMenu(page: Page, fieldId: string): Promise<void> {
  await dismissMenus(page);
  await revealColumn(page, fieldId);
  const header = GridFieldSelectors.fieldHeader(page, fieldId).last();

  await expect(header).toBeVisible({ timeout: 20000 });
  await header.scrollIntoViewIfNeeded();
  await header.click({ force: true });
  const editProperty = PropertyMenuSelectors.editPropertyMenuItem(page).last();

  await expect(editProperty).toBeVisible({ timeout: 10000 });
  await editProperty.click({ force: true });
  await expect(page.getByTestId('property-name-input').last()).toBeVisible({ timeout: 15000 });
}

export async function renameField(page: Page, fieldId: string, name: string): Promise<void> {
  await openPropertyMenu(page, fieldId);
  const input = page.getByTestId('property-name-input').last();

  await input.fill(name);
  await expect(input).toHaveValue(name);
  await input.press('Enter');
  await dismissMenus(page);
  await expect(GridFieldSelectors.fieldHeader(page, fieldId).last()).toContainText(name, { timeout: 10000 });
}

/** Adds an input column of the given type through the UI and names it. */
export async function addInputField(page: Page, name: string, type: FormulaInputType): Promise<string> {
  const fieldId = await addFieldWithType(page, INPUT_FIELD_TYPES[type]);

  expect(fieldId).not.toBe('');
  await renameField(page, fieldId, name);
  return fieldId;
}

export interface GridFieldInfo {
  id: string;
  name: string;
  type: number;
  isPrimary: boolean;
}

/** Fields of the active view in column order (fixture bookkeeping only). */
export async function readGridFieldsDirect(page: Page): Promise<GridFieldInfo[]> {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fields = database.get('fields');

    return (view.get('field_orders').toArray() as Array<{ id: string }>)
      .map(({ id }) => ({ id, field: fields.get(id) }))
      .filter(({ field }) => Boolean(field))
      .map(({ id, field }) => ({
        id,
        name: String(field.get('name') ?? ''),
        type: Number(field.get('ty')),
        isPrimary: Boolean(field.get('is_primary')),
      }));
  });
}

/** Renames a field in the schema; used to move default columns out of a fixture's way. */
export async function renameFieldDirect(page: Page, fieldId: string, name: string): Promise<void> {
  await page.evaluate(
    ({ fieldId, name }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const field = ctx.databaseDoc.getMap('data').get('database').get('fields').get(fieldId);

      ctx.databaseDoc.transact(() => {
        field.set('name', name);
        field.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });
    },
    { fieldId, name }
  );
}

export function inputFieldType(type: FormulaInputType): FieldType {
  return INPUT_FIELD_TYPES[type];
}

export async function ensureRowCount(page: Page, count: number): Promise<void> {
  const rows = DatabaseGridSelectors.dataRows(page);
  const current = await rows.count();

  for (let i = current; i < count; i += 1) {
    await DatabaseGridSelectors.newRowButton(page).click();
    await page.waitForTimeout(400);
  }

  await expect(rows).toHaveCount(Math.max(count, current), { timeout: 10000 });
}

type DirectCell = {
  fieldType: number;
  data: unknown;
  includeTime?: boolean;
  endTimestamp?: string;
  isRange?: boolean;
};

async function writeCellDirect(page: Page, fieldId: string, rowIndex: number, cell: DirectCell): Promise<void> {
  await page.evaluate(
    async ({ fieldId, rowIndex, cell }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const doc = ctx.databaseDoc;
      const database = doc.getMap('data').get('database');
      const databaseId = database.get('id') || doc.guid;
      const view = database.get('views').get(ctx.activeViewId);
      const rowId = view.get('row_orders').toArray()[rowIndex].id;
      let rowDoc = ctx.rowMap?.[rowId];

      if (!rowDoc && ctx.ensureRow) rowDoc = await ctx.ensureRow(rowId);
      if (!rowDoc) rowDoc = await ctx.createRow(`${databaseId}_rows_${rowId}`);

      rowDoc.transact(() => {
        const now = String(Math.floor(Date.now() / 1000));
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let yCell = cells.get(fieldId);

        if (!yCell) {
          yCell = new Y.Map();
          cells.set(fieldId, yCell);
        }

        yCell.set('created_at', yCell.get('created_at') || now);
        yCell.set('last_modified', now);
        yCell.set('field_type', cell.fieldType);
        yCell.set('data', cell.data);
        if (cell.includeTime !== undefined) yCell.set('include_time', cell.includeTime);
        if (cell.endTimestamp !== undefined) yCell.set('end_timestamp', cell.endTimestamp);
        if (cell.isRange !== undefined) yCell.set('is_range', cell.isRange);
        row.set('last_modified', now);
      });
    },
    { fieldId, rowIndex, cell }
  );
}

/** Replaces a select field's options and returns name → id. */
async function setSelectOptionsDirect(
  page: Page,
  fieldId: string,
  fieldType: number,
  names: string[]
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ fieldId, fieldType, names }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const field = database.get('fields').get(fieldId);
      const colors = ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue'];
      const options = names.map((name, index) => ({
        id: `opt${index + 1}${Math.random().toString(36).slice(2, 6)}`,
        name,
        color: colors[index % colors.length],
      }));

      ctx.databaseDoc.transact(() => {
        let typeOptionMap = field.get('type_option');

        if (!typeOptionMap) {
          typeOptionMap = new Y.Map();
          field.set('type_option', typeOptionMap);
        }

        let option = typeOptionMap.get(String(fieldType));

        if (!option) {
          option = new Y.Map();
          typeOptionMap.set(String(fieldType), option);
        }

        option.set('content', JSON.stringify({ options, disable_color: false }));
        field.set('last_modified', String(Math.floor(Date.now() / 1000)));
      });

      return Object.fromEntries(options.map((option) => [option.name, option.id]));
    },
    { fieldId, fieldType, names }
  );
}

function parseDateSeconds(value: string): { start: number; end?: number; includeTime: boolean } {
  const [startText, endText] = value.split('->').map((part) => part.trim());
  const includeTime = /\d:\d/.test(startText) && !startText.startsWith('today');
  const toSeconds = (text: string) => {
    // `today`, `today+3`, `today-1`: local midnight relative to the run date.
    const relative = /^today(?:([+-])(\d+))?$/.exec(text);

    if (relative) {
      const day = new Date();

      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + (relative[1] === '-' ? -1 : 1) * Number(relative[2] ?? 0));
      return Math.floor(day.getTime() / 1000);
    }

    // Date-only ISO strings parse as UTC; force local time so the seeded day
    // never shifts with the browser's timezone.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text.replace(' ', 'T');
    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) throw new Error(`Unparseable date fixture: ${text}`);
    return Math.floor(date.getTime() / 1000);
  };

  return { start: toSeconds(startText), end: endText ? toSeconds(endText) : undefined, includeTime };
}

/**
 * Seeds one input column's values. `<empty>` leaves the cell blank. Dates are
 * ISO text (`2024-03-10` or `2024-03-10 09:30`, ranges with `->`); select
 * values are option names (comma separated for multi-select).
 */
export async function seedColumn(
  page: Page,
  fieldId: string,
  type: FormulaInputType,
  values: string[]
): Promise<void> {
  const fieldType = INPUT_FIELD_TYPES[type];
  let optionIds: Record<string, string> = {};

  if (type === 'Select' || type === 'MultiSelect') {
    const names = Array.from(
      new Set(
        values
          .filter((value) => value !== '<empty>')
          .flatMap((value) => value.split(',').map((name) => name.trim()))
          .filter(Boolean)
      )
    );

    optionIds = await setSelectOptionsDirect(page, fieldId, fieldType, names);
  }

  for (const [rowIndex, value] of values.entries()) {
    if (value === '<empty>' || value === '<auto>') continue;

    switch (type) {
      case 'Checklist': {
        // `2/3`: three tasks, the first two done.
        const [done, total] = value.split('/').map(Number);
        const options = Array.from({ length: total }, (_, index) => ({
          id: `task${index + 1}`,
          name: `Task ${index + 1}`,
          color: 'Purple',
        }));

        await writeCellDirect(page, fieldId, rowIndex, {
          fieldType,
          data: JSON.stringify({ options, selected_option_ids: options.slice(0, done).map((option) => option.id) }),
        });
        break;
      }

      case 'Date': {
        const { start, end, includeTime } = parseDateSeconds(value);

        await writeCellDirect(page, fieldId, rowIndex, {
          fieldType,
          data: String(start),
          includeTime,
          endTimestamp: end === undefined ? undefined : String(end),
          isRange: end !== undefined,
        });
        break;
      }

      case 'Checkbox':
        await writeCellDirect(page, fieldId, rowIndex, { fieldType, data: /^(yes|true|1)$/i.test(value) ? 'Yes' : 'No' });
        break;
      case 'Select':
      case 'MultiSelect':
        await writeCellDirect(page, fieldId, rowIndex, {
          fieldType,
          data: value
            .split(',')
            .map((name) => optionIds[name.trim()])
            .filter(Boolean)
            .join(','),
        });
        break;
      default:
        await writeCellDirect(page, fieldId, rowIndex, { fieldType, data: value });
    }
  }
}

/** Opens the "new property" type picker and chooses Formula; the editor opens. */
export async function startNewFormulaProperty(page: Page): Promise<void> {
  await dismissMenus(page);
  const newPropertyButton = PropertyMenuSelectors.newPropertyButton(page).last();

  await newPropertyButton.scrollIntoViewIfNeeded();
  await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
  await page.waitForTimeout(1000);
  await PropertyMenuSelectors.propertyTypeTrigger(page).last().hover({ force: true });
  const option = PropertyMenuSelectors.propertyTypeOption(page, FieldType.Formula).last();

  await option.waitFor({ state: 'attached', timeout: 10000 });
  await option.evaluate((element) => (element as HTMLElement).click());
  await expect(formulaDialog(page)).toBeVisible({ timeout: 15000 });
  await expect(formulaInput(page)).toBeFocused({ timeout: 5000 });
}

/** Types an expression into the (already open) editor, replacing its content. */
export async function typeFormula(page: Page, expression: string): Promise<void> {
  const input = formulaInput(page);

  await input.fill('');
  // Typing key by key exercises autocomplete; the popup only reacts to
  // Enter/Tab/arrows, and new lines are typed with Shift+Enter.
  const lines = expression.split('\n');

  for (const [index, line] of lines.entries()) {
    if (index > 0) await input.press('Shift+Enter');
    await input.pressSequentially(line, { delay: 5 });
  }

}

export async function saveFormula(page: Page): Promise<void> {
  const done = page.getByTestId('formula-editor-done');

  await expect(done).toBeEnabled({ timeout: 10000 });
  await done.click();
  await expect(formulaDialog(page)).toBeHidden({ timeout: 10000 });
}

export async function cancelFormula(page: Page): Promise<void> {
  await page.getByTestId('formula-editor-cancel').click();
  await expect(formulaDialog(page)).toBeHidden({ timeout: 10000 });
}

/** Creates a formula column named `name` with `expression`; returns its field id. */
export async function addFormulaField(page: Page, name: string, expression: string): Promise<string> {
  await startNewFormulaProperty(page);
  await typeFormula(page, expression);
  await saveFormula(page);
  const fieldId = await lastFieldId(page);

  expect(fieldId).not.toBe('');
  await renameField(page, fieldId, name);
  return fieldId;
}

export async function openFormulaEditorFromMenu(page: Page, fieldId: string): Promise<void> {
  await openPropertyMenu(page, fieldId);
  await page.getByTestId('formula-edit-formula').last().click();
  await expect(formulaDialog(page)).toBeVisible({ timeout: 15000 });
}

export async function openFormulaEditorFromCell(page: Page, fieldId: string, rowIndex: number): Promise<void> {
  await dismissMenus(page);
  await revealColumn(page, fieldId);
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((element) => (element as HTMLElement).click());
  await expect(formulaDialog(page)).toBeVisible({ timeout: 15000 });
}

/**
 * Grid columns are virtualized horizontally; scroll the grid until the
 * column's header is mounted, then bring it into view.
 */
export async function revealColumn(page: Page, fieldId: string): Promise<void> {
  const header = GridFieldSelectors.fieldHeader(page, fieldId);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await header.count()) > 0) {
      await header.last().scrollIntoViewIfNeeded();
      return;
    }

    // Sweep left-to-right, wrapping to the start once the right edge is reached.
    const moved = await page.evaluate((step) => {
      const scrollers = Array.from(document.querySelectorAll<HTMLElement>('.appflowy-custom-scroller')).filter(
        (element) => element.scrollWidth > element.clientWidth
      );
      const scroller = scrollers[scrollers.length - 1];

      if (!scroller) return false;
      const before = scroller.scrollLeft;
      const max = scroller.scrollWidth - scroller.clientWidth;

      scroller.scrollLeft = before >= max - 1 ? 0 : Math.min(max, before + step);
      return scroller.scrollLeft !== before;
    }, 400);

    await page.waitForTimeout(moved ? 150 : 300);
  }

  await expect(header.last()).toBeAttached({ timeout: 5000 });
}

/** Visible text of a formula cell; checkbox results read as "Yes" / "No". */
export async function formulaCellText(page: Page, fieldId: string, rowIndex: number): Promise<string> {
  await revealColumn(page, fieldId);
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  return cell.evaluate((element) => {
    if (element.querySelector('[data-testid="formula-checked-icon"]')) return 'Yes';
    if (element.querySelector('[data-testid="formula-unchecked-icon"]')) return 'No';
    return (element.textContent ?? '').trim();
  });
}

export async function formulaCellTexts(page: Page, fieldId: string, count: number): Promise<string[]> {
  const texts: string[] = [];

  for (let i = 0; i < count; i += 1) {
    texts.push(await formulaCellText(page, fieldId, i));
  }

  return texts;
}

export async function expectFormulaCells(page: Page, fieldId: string, expected: string[]): Promise<void> {
  await expect
    .poll(() => formulaCellTexts(page, fieldId, expected.length), { timeout: 15000, message: `formula ${fieldId}` })
    .toEqual(expected);
}

export async function chooseNumberFormat(page: Page, fieldId: string, formatId: number): Promise<void> {
  await openPropertyMenu(page, fieldId);
  await page.getByTestId('formula-number-format').last().hover({ force: true });
  const option = page.getByTestId(`formula-number-format-${formatId}`).last();

  await option.waitFor({ state: 'attached', timeout: 10000 });
  await option.evaluate((element) => (element as HTMLElement).click());
  await dismissMenus(page);
}

export async function chooseShowAs(page: Page, fieldId: string, showAsId: number): Promise<void> {
  await openPropertyMenu(page, fieldId);
  const option = page.getByTestId(`rollup-visualization-${showAsId}`).last();

  await option.waitFor({ state: 'attached', timeout: 10000 });
  await option.evaluate((element) => (element as HTMLElement).click());
  await dismissMenus(page);
}

export async function chooseCalculation(page: Page, fieldId: string, calculationType: number): Promise<void> {
  await dismissMenus(page);
  await revealColumn(page, fieldId);
  const footer = page.getByTestId(`grid-calculate-cell-${fieldId}`).last();

  await footer.scrollIntoViewIfNeeded();
  await footer.click({ force: true });
  const option = page.getByTestId(`calculation-option-${calculationType}`).last();

  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click({ force: true });
  await dismissMenus(page);
}


// ---------------------------------------------------------------------------
// Rows and generic cells
// ---------------------------------------------------------------------------

/** Row ids of the active view in order. */
export async function rowIdsDirect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);

    return (view.get('row_orders').toArray() as Array<{ id: string }>).map((order) => order.id);
  });
}

/** Removes rows beyond `count` from every view so the fixture grid is exact. */
export async function trimRowsDirect(page: Page, count: number): Promise<void> {
  await page.evaluate((count) => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const views = database.get('views');
    const activeOrders = views.get(ctx.activeViewId).get('row_orders').toArray() as Array<{ id: string }>;
    const removed = new Set(activeOrders.slice(count).map((order) => order.id));

    if (removed.size === 0) return;
    ctx.databaseDoc.transact(() => {
      views.forEach((view: any) => {
        const orders = view.get('row_orders');

        if (!orders) return;
        const ids = orders.toArray() as Array<{ id: string }>;

        for (let index = ids.length - 1; index >= 0; index -= 1) {
          if (removed.has(ids[index].id)) orders.delete(index, 1);
        }
      });
    });
  }, count);
}

/** Visible text of any grid cell; checkbox cells read as "Yes" / "No". */
export async function gridCellText(page: Page, fieldId: string, rowIndex: number): Promise<string> {
  await revealColumn(page, fieldId);
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).nth(rowIndex);

  return cell.evaluate((element) => {
    if (element.querySelector('[data-testid="formula-checked-icon"], [data-testid="checkbox-checked-icon"]')) return 'Yes';
    if (element.querySelector('[data-testid="formula-unchecked-icon"], [data-testid="checkbox-unchecked-icon"]')) {
      return 'No';
    }

    return (element.textContent ?? '').trim();
  });
}

/** Opens the header (column) menu of a field. */
export async function openHeaderMenu(page: Page, fieldId: string): Promise<void> {
  await dismissMenus(page);
  await revealColumn(page, fieldId);
  const header = GridFieldSelectors.fieldHeader(page, fieldId).last();

  await header.click({ force: true });
  await expect(page.getByTestId('grid-field-edit-property').last()).toBeVisible({ timeout: 10000 });
}

export async function closeMenus(page: Page): Promise<void> {
  await dismissMenus(page);
}

/** Changes a field's type from its property menu type list. */
export async function switchFieldType(page: Page, fieldId: string, type: FieldType): Promise<void> {
  await openPropertyMenu(page, fieldId);
  await PropertyMenuSelectors.propertyTypeTrigger(page).last().hover({ force: true });
  const option = PropertyMenuSelectors.propertyTypeOption(page, type).last();

  await option.waitFor({ state: 'attached', timeout: 10000 });
  await option.evaluate((element) => (element as HTMLElement).click());
  await page.waitForTimeout(800);
}
