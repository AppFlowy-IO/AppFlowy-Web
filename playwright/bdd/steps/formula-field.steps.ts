import { expect, type Locator, type Page, test } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { waitForGridReady } from '../../support/database-ui-helpers';
import { loginAndCreateGrid, typeTextIntoCell } from '../../support/field-type-helpers';
import {
  addFilterByFieldName,
  changeCheckboxFilterCondition,
  changeFilterCondition,
  CheckboxFilterCondition,
  clickFilterChip,
  deleteFilter,
  enterFilterText,
  NumberFilterCondition,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import {
  addFormulaField,
  addInputField,
  chooseCalculation,
  chooseNumberFormat,
  chooseShowAs,
  closeMenus,
  ensureRowCount,
  expectFormulaCells,
  fieldIdByName,
  formulaCellText,
  formulaDialog,
  clearFormula,
  expectFormulaSource,
  formulaInput,
  type FormulaInputType,
  gridCellText,
  inputFieldType,
  inputTypeOfField,
  lastFieldId,
  NUMBER_FORMAT_IDS,
  openFormulaEditorFromCell,
  openFormulaEditorFromMenu,
  openHeaderMenu,
  openPropertyMenu,
  readGridFieldsDirect,
  renameField,
  renameFieldDirect,
  revealColumn,
  rowIdsDirect,
  saveFormula,
  seedColumn,
  SHOW_AS_IDS,
  startNewFormulaProperty,
  switchFieldType,
  trimRowsDirect,
  typeFormula,
} from '../../support/formula-test-helpers';
import {
  createOneWayRelationField,
  createRollupCountFieldViaPropertyMenu,
  deleteFieldFromGridHeader,
  getCurrentDatabaseInfo,
  setRelationCellDirect,
} from '../../support/relation-test-helpers';
import { openRowDetail } from '../../support/row-detail-helpers';
import {
  DatabaseFilterSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  FieldType,
  GridFieldSelectors,
  PersonSelectors,
  PropertyMenuSelectors,
  RowDetailSelectors,
} from '../../support/selectors';
import {
  addSortByFieldName,
  changeSortDirection,
  deleteAllSorts,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Before, Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

interface ScenarioState {
  /** Field ids by the display name the scenario uses. */
  fields: Map<string, string>;
  /** Grid row ids in fixture order, captured before switching views. */
  rows: string[];
  /** Row id shown on the open row page. */
  rowPage?: string;
}

const scenarioState = new WeakMap<Page, ScenarioState>();

function state(page: Page): ScenarioState {
  let current = scenarioState.get(page);

  if (!current) {
    current = { fields: new Map(), rows: [] };
    scenarioState.set(page, current);
  }

  return current;
}

async function fieldId(page: Page, name: string): Promise<string> {
  const known = state(page).fields.get(name);

  if (known) return known;
  const id = await fieldIdByName(page, name);

  state(page).fields.set(name, id);
  return id;
}

async function rowId(page: Page, row: number): Promise<string> {
  const rows = state(page).rows.length > 0 ? state(page).rows : await rowIdsDirect(page);
  const id = rows[row - 1];

  if (!id) throw new Error(`Row ${row} does not exist`);
  return id;
}

/** First column of a one-column table; `<empty>` stands for a blank cell. */
function column(table: DataTable): string[] {
  return table.raw().map((row) => (row[0] === '<empty>' ? '' : row[0] ?? ''));
}

function names(list: string): string[] {
  return list
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function tooltip(page: Page, text: string): Locator {
  return page.locator('[data-slot="tooltip-content"]').filter({ hasText: text }).first();
}

const TYPE_IDS: Record<string, FieldType> = {
  Text: FieldType.RichText,
  Number: FieldType.Number,
  Checkbox: FieldType.Checkbox,
  Date: FieldType.DateTime,
  Formula: FieldType.Formula,
};

/** Calculation types (values from CalculationType). */
const CALCULATION_IDS: Record<string, number> = {
  Average: 0,
  Max: 1,
  Median: 2,
  Min: 3,
  Sum: 4,
  'Count all': 5,
  'Count empty': 6,
  'Count unchecked': 6,
  'Count not empty': 7,
  'Count checked': 7,
};

const NUMBER_CONDITIONS: Record<string, number> = {
  equal: NumberFilterCondition.Equal,
  'not equal': NumberFilterCondition.NotEqual,
  'greater than': NumberFilterCondition.GreaterThan,
  'less than': NumberFilterCondition.LessThan,
  'greater than or equal to': NumberFilterCondition.GreaterThanOrEqualTo,
  'less than or equal to': NumberFilterCondition.LessThanOrEqualTo,
  'is empty': NumberFilterCondition.NumberIsEmpty,
  'is not empty': NumberFilterCondition.NumberIsNotEmpty,
};

const TEXT_CONDITIONS: Record<string, number> = {
  is: TextFilterCondition.TextIs,
  'is not': TextFilterCondition.TextIsNot,
  contains: TextFilterCondition.TextContains,
  'does not contain': TextFilterCondition.TextDoesNotContain,
  'starts with': TextFilterCondition.TextStartsWith,
  'ends with': TextFilterCondition.TextEndsWith,
  'is empty': TextFilterCondition.TextIsEmpty,
  'is not empty': TextFilterCondition.TextIsNotEmpty,
};

const VALUELESS_CONDITIONS = new Set(['is empty', 'is not empty']);

/** Date filter conditions (values from DateFilterCondition). */
const DATE_CONDITIONS: Record<string, number> = {
  'is on today': 0,
  'is empty': 6,
  'is not empty': 7,
  'is today': 16,
  'is yesterday': 17,
  'is tomorrow': 18,
};

Before({ tags: '@formula' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

Given('a Grid for formula testing with these properties', async ({ page, request }, table: DataTable) => {
  const rows = table.hashes();

  // Each property is added through the UI; wide fixtures need more time.
  test.setTimeout(Math.max(test.info().timeout, 120_000 + rows.length * 10_000));
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const rowCount = Math.max(...rows.map((row) => Object.keys(row).filter((key) => /^row \d+$/.test(key)).length));

  await ensureRowCount(page, rowCount);
  await trimRowsDirect(page, rowCount);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(rowCount, { timeout: 15000 });

  // A new grid starts with Name / Type / Done. Reuse a default column when the
  // scenario asks for the same name and type; otherwise rename the default so
  // prop("<name>") can only resolve to the scenario's property.
  const defaults = await readGridFieldsDirect(page);

  for (const row of rows) {
    const name = row.property;
    const type = row.type as FormulaInputType;
    const values = Array.from({ length: rowCount }, (_, index) => row[`row ${index + 1}`] ?? '<empty>').map(
      (value) => (value === '' ? '<empty>' : value)
    );
    const existing = defaults.find((field) => field.name === name);
    let id: string;

    if (existing && existing.type === inputFieldType(type)) {
      id = existing.id;
    } else {
      if (existing) await renameFieldDirect(page, existing.id, `${name} (default)`);
      id = await addInputField(page, name, type);
    }

    state(page).fields.set(name, id);
    await seedColumn(page, id, type, values);
  }

  state(page).rows = await rowIdsDirect(page);
});

Given(/^a formula property "([^"]*)" with the expression "(.*)"$/, async ({ page }, name: string, expression: string) => {
  state(page).fields.set(name, await addFormulaField(page, name, expression));
});

When('I add these formula properties', async ({ page }, table: DataTable) => {
  for (const row of table.hashes()) {
    state(page).fields.set(row.name, await addFormulaField(page, row.name, row.expression));
  }
});

When('I add a {string} property named {string}', async ({ page }, type: string, name: string) => {
  state(page).fields.set(name, await addInputField(page, name, type as FormulaInputType));
});

// ---------------------------------------------------------------------------
// Relations, rollups and people
// ---------------------------------------------------------------------------

Given('a relation property {string} to this database', async ({ page }, name: string) => {
  const { databaseId } = await getCurrentDatabaseInfo(page);

  state(page).fields.set(name, await createOneWayRelationField(page, { fieldName: name, relatedDatabaseId: databaseId }));
});

Given(/^row (\d+) of "([^"]*)" links (?:rows? ([\d, ]+)|no rows)$/, async ({ page }, row: string, name: string, rows?: string) => {
  const ids: string[] = [];

  for (const linked of names(rows ?? '')) ids.push(await rowId(page, Number(linked)));
  await setRelationCellDirect(page, await fieldId(page, name), Number(row) - 1, ids);
});

Given('a count rollup {string} over {string}', async ({ page }, name: string, relation: string) => {
  const { primaryFieldId } = await getCurrentDatabaseInfo(page);

  await closeMenus(page);
  state(page).fields.set(
    name,
    await createRollupCountFieldViaPropertyMenu(page, {
      fieldName: name,
      relationFieldId: await fieldId(page, relation),
      targetFieldId: primaryFieldId,
    })
  );
});

When('I assign myself in row {int} of {string}', async ({ page }, row: number, name: string) => {
  const cell = await cellOf(page, name, row);

  await closeMenus(page);
  await cell.evaluate((element) => (element as HTMLElement).click());
  const option = PersonSelectors.personCellMenu(page).locator('[data-testid^="person-option-"]').first();

  await expect(option).toBeVisible({ timeout: 20000 });
  await option.click();
  await closeMenus(page);
  await expect.poll(() => memberNamesIn(page, name, row), { timeout: 15000 }).not.toBe('');
});

/** Member names shown in a Person, Created by or Last edited by cell. */
async function memberNamesIn(page: Page, name: string, row: number): Promise<string> {
  const cell = await cellOf(page, name, row);

  return cell.evaluate((element) =>
    Array.from(element.querySelectorAll('span.truncate'))
      .map((span) => (span.textContent ?? '').trim())
      .join(', ')
  );
}

Then(
  'row {int} of {string} shows the member names of {string}',
  async ({ page }, row: number, formula: string, people: string) => {
    const id = await fieldId(page, formula);

    await expect
      .poll(
        async () => {
          const shown = await memberNamesIn(page, people, row);

          return shown !== '' && (await formulaCellText(page, id, row - 1)) === shown;
        },
        { timeout: 20000, message: `${formula} row ${row} should read the names in ${people}` }
      )
      .toBe(true);
  }
);

Then(
  'the formula preview shows the member names of {string} in row {int}',
  async ({ page }, people: string, row: number) => {
    const shown = await memberNamesIn(page, people, row);

    expect(shown).not.toBe('');
    await expect(page.getByTestId('formula-preview-value')).toHaveText(shown);
  }
);

Then(
  'row {int} of {string} reads the member names of {string}',
  async ({ page }, row: number, name: string, people: string) => {
    const id = await fieldId(page, name);
    const shown = await memberNamesIn(page, people, row);

    expect(shown).not.toBe('');
    await expect.poll(() => gridCellText(page, id, row - 1), { timeout: 15000 }).toBe(shown);
  }
);

// ---------------------------------------------------------------------------
// Opening and closing the editor
// ---------------------------------------------------------------------------

When('I start a new formula property', async ({ page }) => {
  await startNewFormulaProperty(page);
});

When('I switch the property {string} to {string}', async ({ page }, name: string, type: string) => {
  const target = TYPE_IDS[type];

  if (target === undefined) throw new Error(`Unknown property type: ${type}`);
  await switchFieldType(page, await fieldId(page, name), target);
});

When('I open the formula editor of {string} from the property menu', async ({ page }, name: string) => {
  await openFormulaEditorFromMenu(page, await fieldId(page, name));
});

When(
  'I open the formula editor of {string} by clicking its cell in row {int}',
  async ({ page }, name: string, row: number) => {
    await openFormulaEditorFromCell(page, await fieldId(page, name), row - 1);
  }
);

When('I save the formula', async ({ page }) => {
  await saveFormula(page);
});

When('I close the formula editor with {string}', async ({ page }, method: string) => {
  const dialog = formulaDialog(page);

  switch (method) {
    case 'the Done button':
      await saveFormula(page);
      return;
    case 'Ctrl+Enter':
      await formulaInput(page).press('Control+Enter');
      break;
    case 'Cmd+Enter':
      await formulaInput(page).press('Meta+Enter');
      break;
    case 'the Cancel button':
      await page.getByTestId('formula-editor-cancel').click();
      break;
    case 'the close button':
      await dialog.getByRole('button', { name: 'Close' }).click();
      break;
    case 'Escape':
      await formulaInput(page).press('Escape');
      break;
    case 'a click outside':
      await page.mouse.click(4, 4);
      break;
    default:
      throw new Error(`Unknown way to close the formula editor: ${method}`);
  }

  await expect(dialog).toBeHidden({ timeout: 10000 });
});

Then('the formula editor is open with an empty formula', async ({ page }) => {
  await expect(formulaDialog(page)).toBeVisible();
  await expectFormulaSource(page, '');
});

Then('the formula editor is open with a formula', async ({ page }) => {
  await expect(formulaDialog(page)).toBeVisible();
  await expect(formulaInput(page)).not.toHaveAttribute('data-value', '');
});

Then('the formula editor is closed', async ({ page }) => {
  await page.waitForTimeout(500);
  await expect(formulaDialog(page)).toBeHidden({ timeout: 10000 });
});

Then('the formula editor title shows {string}', async ({ page }, name: string) => {
  await expect(formulaDialog(page).getByRole('heading')).toContainText(`· ${name}`);
});

Then('the formula editor has focus', async ({ page }) => {
  await expect(formulaInput(page)).toBeFocused();
});

Then(/^the property menu of "([^"]*)" shows the formula item "(.*)"$/, async ({ page }, name: string, text: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await expect(page.getByTestId('formula-edit-formula').last()).toHaveText(text);
  await closeMenus(page);
});

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

When(/^I type the formula "(.*)"$/, async ({ page }, expression: string) => {
  await typeFormula(page, expression.replace(/\\n/g, '\n'));
});

When('I type the formula:', async ({ page }, expression: string) => {
  await typeFormula(page, expression);
});

When(/^I type "(.*)" in the formula editor$/, async ({ page }, text: string) => {
  await formulaInput(page).pressSequentially(text, { delay: 5 });
});

When('I press {string} in the formula editor', async ({ page }, key: string) => {
  await formulaInput(page).press(key);
});

Then(/^the formula editor contains "(.*)"$/, async ({ page }, expression: string) => {
  await expectFormulaSource(page, expression.replace(/\\n/g, '\n'));
});

Then('the formula editor highlights these tokens', async ({ page }, table: DataTable) => {
  const overlay = formulaInput(page);

  for (const { text, kind } of table.hashes()) {
    await expect(
      overlay.locator(`[data-highlight="${kind}"]`).filter({ hasText: text }).first(),
      `"${text}" should be highlighted as ${kind}`
    ).toHaveText(text);
  }
});

// ---------------------------------------------------------------------------
// Property tokens
// ---------------------------------------------------------------------------

function propertyTokens(page: Page): Locator {
  return formulaInput(page).getByTestId('formula-token');
}

function propertyToken(page: Page, name: string): Locator {
  return propertyTokens(page).filter({ hasText: name }).first();
}

Then('the formula editor shows these property tokens', async ({ page }, table: DataTable) => {
  await expect(propertyTokens(page)).toHaveText(table.raw().map(([name]) => name));
});

Then('the formula editor shows no property tokens', async ({ page }) => {
  await expect(propertyTokens(page)).toHaveCount(0);
});

Then('the property token {string} shows its property type icon', async ({ page }, name: string) => {
  const token = propertyToken(page, name);

  await expect(token.locator('svg')).toHaveCount(1);
  await expect(token).not.toHaveAttribute('data-missing', 'true');
});

Then('the property token {string} is marked as missing', async ({ page }, name: string) => {
  await expect(propertyToken(page, name)).toHaveAttribute('data-missing', 'true');
});

When('I click the property token {string}', async ({ page }, name: string) => {
  await propertyToken(page, name).click();
});

When(
  'a collaborator renames the property {string} to {string}',
  async ({ page }, name: string, to: string) => {
    await renameFieldDirect(page, await fieldId(page, name), to);
  }
);

Then('the formula editor refers to {string} by its id', async ({ page }, name: string) => {
  await expect(formulaInput(page)).toHaveAttribute('data-value', `prop("${await fieldId(page, name)}")`);
});

When('I clear the formula editor', async ({ page }) => {
  await clearFormula(page);
});

When('I copy the whole formula', async ({ page }) => {
  const input = formulaInput(page);

  await input.press('ControlOrMeta+a');
  // A synthetic copy event hands the editor a DataTransfer we can read back,
  // without clipboard permissions.
  await input.evaluate((element) => {
    const data = new DataTransfer();

    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    element.setAttribute('data-copied', data.getData('text/plain'));
  });
});

Then(/^the copied formula is "(.*)"$/, async ({ page }, expression: string) => {
  await expect(formulaInput(page)).toHaveAttribute('data-copied', expression);
});

When(/^I paste "(.*)" into the formula editor$/, async ({ page }, text: string) => {
  await formulaInput(page).evaluate((element, pasted) => {
    const data = new DataTransfer();

    data.setData('text/plain', pasted);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
});

// A clipboard from a web page or doc carries HTML too. Chrome then leaves the
// paste event alone and inserts through a beforeinput "insertFromPaste".
When(/^I paste "(.*)" with rich text into the formula editor$/, async ({ page }, text: string) => {
  await formulaInput(page).evaluate((element, pasted) => {
    const data = new DataTransfer();

    data.setData('text/plain', pasted);
    data.setData('text/html', `<span>${pasted}</span>`);
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });

    element.dispatchEvent(paste);
    if (!paste.defaultPrevented) {
      element.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: data, bubbles: true, cancelable: true })
      );
    }
  }, text);
});

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

function suggestion(page: Page, label: string): Locator {
  return page.getByTestId(`formula-suggestion-${label}`);
}

Then(/^the autocomplete suggests "(.*)"$/, async ({ page }, label: string) => {
  await expect(suggestion(page, label)).toBeVisible();
});

Then('the autocomplete suggestions are', async ({ page }, table: DataTable) => {
  // The label is the last span; the first child is the kind icon (ƒ, ∙ or a field icon).
  await expect(page.getByTestId('formula-autocomplete').getByRole('option').locator('> span:last-child')).toHaveText(
    column(table)
  );
});

Then(/^the active autocomplete suggestion is "(.*)"$/, async ({ page }, label: string) => {
  await expect(suggestion(page, label)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('formula-autocomplete').locator('[aria-selected="true"]')).toHaveCount(1);
});

Then('the autocomplete is hidden', async ({ page }) => {
  await expect(page.getByTestId('formula-autocomplete')).toHaveCount(0);
});

When(/^I hover the autocomplete suggestion "(.*)"$/, async ({ page }, label: string) => {
  await suggestion(page, label).hover();
});

When(/^I click the autocomplete suggestion "(.*)"$/, async ({ page }, label: string) => {
  await suggestion(page, label).click();
});

// ---------------------------------------------------------------------------
// Catalogue and docs
// ---------------------------------------------------------------------------

const catalogueItem = (page: Page, key: string) => page.getByTestId(`formula-catalogue-${key}`);

When('I search the formula catalogue for {string}', async ({ page }, query: string) => {
  await page.getByTestId('formula-catalogue-search').fill(query);
});

Then('the formula catalogue sections are', async ({ page }, table: DataTable) => {
  await expect(page.getByTestId('formula-catalogue-section')).toHaveText(column(table));
});

Then('the formula catalogue shows no results', async ({ page }) => {
  await expect(page.getByTestId('formula-catalogue')).toHaveText('No result');
  await expect(page.getByTestId('formula-catalogue-section')).toHaveCount(0);
});

Then('the formula editor lists the property {string}', async ({ page }, name: string) => {
  await expect(catalogueItem(page, `property-${await fieldId(page, name)}`)).toBeVisible();
});

Then('the formula editor does not list the property {string}', async ({ page }, name: string) => {
  await expect(catalogueItem(page, `property-${await fieldId(page, name)}`)).toHaveCount(0);
});

Then('the formula editor lists the built-in {string}', async ({ page }, name: string) => {
  await expect(catalogueItem(page, `builtin-${name}`)).toBeVisible();
});

Then('the formula editor lists the function {string}', async ({ page }, name: string) => {
  await expect(catalogueItem(page, `function-${name}`)).toBeVisible();
});

Then('the formula editor does not list the function {string}', async ({ page }, name: string) => {
  await expect(catalogueItem(page, `function-${name}`)).toHaveCount(0);
});

When('I hover the catalogue function {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `function-${name}`).hover();
});

When('I hover the catalogue built-in {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `builtin-${name}`).hover();
});

When('I hover the catalogue property {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `property-${await fieldId(page, name)}`).hover();
});

When('I click the catalogue property {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `property-${await fieldId(page, name)}`).click();
});

When('I click the catalogue built-in {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `builtin-${name}`).click();
});

When('I click the catalogue function {string}', async ({ page }, name: string) => {
  await catalogueItem(page, `function-${name}`).click();
});

const docsPanel = (page: Page) => page.getByTestId('formula-docs');

Then(/^the docs panel describes "(.*)"$/, async ({ page }, title: string) => {
  await expect(docsPanel(page).locator('> div').first()).toHaveText(title);
});

Then(/^the docs panel shows the signature "(.*)"$/, async ({ page }, signature: string) => {
  await expect(docsPanel(page).locator('> div').nth(1)).toHaveText(signature);
});

Then(/^the docs panel reads "(.*)"$/, async ({ page }, text: string) => {
  await expect(docsPanel(page).locator('p')).toContainText(text);
});

function docsExample(page: Page, expression: string): Locator {
  // Examples show property references as chips; match on the source instead.
  return docsPanel(page)
    .getByRole('button')
    .and(page.locator(`[data-expression="${expression.replace(/["\\]/g, '\\$&')}"]`));
}

Then(
  /^the docs panel shows the example "(.*)" with result "(.*)"$/,
  async ({ page }, expression: string, result: string) => {
    const example = docsExample(page, expression);

    await expect(example).toHaveCount(1);
    await expect(example.locator('> span').last()).toHaveText(`= ${result}`);
  }
);

When(/^I insert the docs example "(.*)"$/, async ({ page }, expression: string) => {
  await docsExample(page, expression).click();
});

// ---------------------------------------------------------------------------
// Type, errors, preview
// ---------------------------------------------------------------------------

Then(/^the formula editor infers type "(.*)"$/, async ({ page }, type: string) => {
  await expect(page.getByTestId('formula-editor-type')).toHaveText(`Type: ${type}`);
});

Then('these formulas infer these types', async ({ page }, table: DataTable) => {
  for (const { expression, type } of table.hashes()) {
    await typeFormula(page, expression);
    await expect(page.getByTestId('formula-editor-type'), expression).toHaveText(`Type: ${type}`);
  }
});

Then('these formulas show these errors', async ({ page }, table: DataTable) => {
  for (const { expression, error } of table.hashes()) {
    await typeFormula(page, expression);
    await expect(page.getByTestId('formula-editor-error'), expression).toHaveText(error);
  }
});

Then(/^the formula editor shows the error "(.*)"$/, async ({ page }, message: string) => {
  await expect(page.getByTestId('formula-editor-error')).toContainText(message);
});

Then('the formula editor shows no error', async ({ page }) => {
  await expect(page.getByTestId('formula-editor-error')).toHaveCount(0);
});

Then('the Done button is disabled', async ({ page }) => {
  await expect(page.getByTestId('formula-editor-done')).toBeDisabled();
});

Then('the Done button is enabled', async ({ page }) => {
  await expect(page.getByTestId('formula-editor-done')).toBeEnabled();
});

Then(/^the formula preview shows "(.*)"$/, async ({ page }, value: string) => {
  await expect(page.getByTestId('formula-preview-value')).toHaveText(value);
});

Then('the preview row is {string}', async ({ page }, label: string) => {
  await expect(page.getByTestId('formula-preview-row')).toHaveText(label);
});

Then('the preview row choices are', async ({ page }, table: DataTable) => {
  await page.getByTestId('formula-preview-row').click();
  await expect(page.getByRole('menu').last().getByRole('menuitem')).toHaveText(column(table));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(formulaDialog(page)).toBeVisible();
});

When('I choose the preview row {string}', async ({ page }, label: string) => {
  await page.getByTestId('formula-preview-row').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByTestId('formula-preview-row')).toHaveText(label);
});

// ---------------------------------------------------------------------------
// Property menu
// ---------------------------------------------------------------------------

When('I hover the Formula type in the new property menu', async ({ page }) => {
  await closeMenus(page);
  const newPropertyButton = PropertyMenuSelectors.newPropertyButton(page).last();

  await newPropertyButton.scrollIntoViewIfNeeded();
  await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
  await page.waitForTimeout(1000);
  await PropertyMenuSelectors.propertyTypeTrigger(page).last().hover({ force: true });
  const option = PropertyMenuSelectors.propertyTypeOption(page, FieldType.Formula).last();

  await option.waitFor({ state: 'attached', timeout: 10000 });
  // The type list opens beside (and partly under) the property menu, so a
  // pointer path to Formula can cross the parent menu and close the list.
  // Focusing the option raises the same tooltip a hover does.
  await option.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest' });
    (element as HTMLElement).focus();
  });
  await expect(option).toBeFocused();
});

Then('the type tooltip reads {string}', async ({ page }, text: string) => {
  await expect(tooltip(page, text)).toBeVisible({ timeout: 10000 });
  await closeMenus(page);
});

When('I set the number format of {string} to {string}', async ({ page }, name: string, format: string) => {
  const formatId = NUMBER_FORMAT_IDS[format];

  if (formatId === undefined) throw new Error(`Unknown number format: ${format}`);
  await chooseNumberFormat(page, await fieldId(page, name), formatId);
});

When('I search the number formats of {string} for {string}', async ({ page }, name: string, query: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await page.getByTestId('formula-number-format').last().hover({ force: true });
  const search = page.locator('[data-testid="formula-number-format-search"] input, input[data-testid="formula-number-format-search"]').last();

  await expect(search).toBeVisible({ timeout: 10000 });
  await search.fill(query);
});

Then('the number format choices are', async ({ page }, table: DataTable) => {
  await expect(page.locator('[data-testid^="formula-number-format-"]:not([data-testid$="-search"])')).toHaveText(
    column(table)
  );
  await closeMenus(page);
});

Then('the number format of {string} is {string}', async ({ page }, name: string, format: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await expect(page.getByTestId('formula-number-format').last()).toHaveText(format);
  await closeMenus(page);
});

Then('the property menu of {string} offers no Number format or Show as', async ({ page }, name: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await expect(page.getByTestId('formula-edit-formula').last()).toBeVisible();
  await expect(page.getByTestId('formula-number-format')).toHaveCount(0);
  await expect(page.getByTestId('rollup-visualization-settings')).toHaveCount(0);
  await closeMenus(page);
});

Then('the property menu of {string} offers a Number format and Show as', async ({ page }, name: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await expect(page.getByTestId('formula-number-format').last()).toBeVisible();
  await expect(page.getByTestId('rollup-visualization-settings').last()).toBeVisible();
  await closeMenus(page);
});

When('I show {string} as {string}', async ({ page }, name: string, showAs: string) => {
  const showAsId = SHOW_AS_IDS[showAs];

  if (showAsId === undefined) throw new Error(`Unknown Show as option: ${showAs}`);
  await chooseShowAs(page, await fieldId(page, name), showAsId);
});

When('I set the Show as divisor of {string} to {string}', async ({ page }, name: string, divisor: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  const input = page.getByTestId('rollup-visualization-divisor').last();

  await input.click();
  await input.fill(divisor);
  await expect(input).toHaveValue(divisor);
  await closeMenus(page);
});

When('I set the Show as color of {string} to {string}', async ({ page }, name: string, color: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  await page.getByTestId('rollup-visualization-color').last().hover({ force: true });
  const option = page.getByTestId(`rollup-visualization-color-${color}`).last();

  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
  await closeMenus(page);
});

When('I toggle Show number for {string}', async ({ page }, name: string) => {
  await openPropertyMenu(page, await fieldId(page, name));
  const toggle = page.getByTestId('rollup-visualization-show-number').last();
  const before = await toggle.getAttribute('aria-checked');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  await closeMenus(page);
});

When('I rename the property {string} to {string}', async ({ page }, from: string, to: string) => {
  const id = await fieldId(page, from);

  await renameField(page, id, to);
  state(page).fields.delete(from);
  state(page).fields.set(to, id);
});

When(
  'I duplicate the property {string} from its header menu as {string}',
  async ({ page }, name: string, alias: string) => {
    const before = new Set((await readGridFieldsDirect(page)).map((field) => field.id));

    await openHeaderMenu(page, await fieldId(page, name));
    await page.getByTestId('grid-field-duplicate').last().click();
    let copyId = '';

    await expect
      .poll(async () => {
        copyId = (await readGridFieldsDirect(page)).find((field) => !before.has(field.id))?.id ?? '';
        return copyId;
      })
      .not.toBe('');
    state(page).fields.set(alias, copyId);
    await closeMenus(page);
  }
);

When('I delete the property {string} from its header menu', async ({ page }, name: string) => {
  const id = await fieldId(page, name);

  await closeMenus(page);
  await revealColumn(page, id);
  await deleteFieldFromGridHeader(page, id);
});

When('I hide the property {string} from its header menu', async ({ page }, name: string) => {
  await openHeaderMenu(page, await fieldId(page, name));
  await page.getByTestId('grid-field-hide').last().click();
  await closeMenus(page);
});

Then('the property {string} is not shown in the grid', async ({ page }, name: string) => {
  await expect(GridFieldSelectors.fieldHeader(page, await fieldId(page, name))).toHaveCount(0, { timeout: 15000 });
});

Then('the header menu of {string} offers these actions', async ({ page }, name: string, table: DataTable) => {
  await openHeaderMenu(page, await fieldId(page, name));
  const menu = page.getByRole('menu').filter({ has: page.getByTestId('grid-field-edit-property') }).last();
  const expected = column(table);

  await expect(menu.locator('[data-testid^="grid-field-"]')).toHaveCount(expected.length);
  for (const action of expected) {
    await expect(menu.getByTestId(`grid-field-${action}`)).toBeVisible();
  }

  await closeMenus(page);
});

Then('the header menu of {string} offers the action {string}', async ({ page }, name: string, action: string) => {
  await openHeaderMenu(page, await fieldId(page, name));
  await expect(page.getByTestId(`grid-field-${action}`).last()).toBeVisible();
  await closeMenus(page);
});

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

async function cellOf(page: Page, name: string, row: number): Promise<Locator> {
  const id = await fieldId(page, name);

  await revealColumn(page, id);
  return DatabaseGridSelectors.dataRowCellsForField(page, id).nth(row - 1);
}

Then('the formula {string} shows these values', async ({ page }, name: string, table: DataTable) => {
  await expectFormulaCells(page, await fieldId(page, name), column(table));
});

Then('the last formula column shows these values', async ({ page }, table: DataTable) => {
  await expectFormulaCells(page, await lastFieldId(page), column(table));
});

Then('the formula properties show these values for row {int}', async ({ page }, row: number, table: DataTable) => {
  for (const entry of table.hashes()) {
    const id = await fieldId(page, entry.name);

    await expect
      .poll(() => formulaCellText(page, id, row - 1), { timeout: 15000, message: `${entry.name} row ${row}` })
      .toBe(entry.value);
  }
});

Then('the {string} cells read in order', async ({ page }, name: string, table: DataTable) => {
  const id = await fieldId(page, name);
  const expected = column(table);

  await expect
    .poll(
      async () => {
        const texts: string[] = [];

        for (let index = 0; index < expected.length; index += 1) texts.push(await gridCellText(page, id, index));
        return texts;
      },
      { timeout: 15000 }
    )
    .toEqual(expected);
});

When('I type {string} into row {int} of {string}', async ({ page }, value: string, row: number, name: string) => {
  const id = await fieldId(page, name);

  await closeMenus(page);
  await revealColumn(page, id);
  await typeTextIntoCell(page, id, row - 1, value);
});

When('I click row {int} of {string}', async ({ page }, row: number, name: string) => {
  const cell = await cellOf(page, name, row);

  await cell.evaluate((element) => (element as HTMLElement).click());
});

Then('row {int} of {string} shows a checked checkbox', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).getByTestId('formula-checked-icon')).toBeVisible();
});

Then('row {int} of {string} shows an unchecked checkbox', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).getByTestId('formula-unchecked-icon')).toBeVisible();
});

Then('row {int} of {string} is aligned right', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).locator('.formula-cell')).toHaveCSS('justify-content', 'flex-end');
});

Then('row {int} of {string} is aligned left', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).locator('.formula-cell')).toHaveCSS('justify-content', 'normal');
});

Then('row {int} of {string} is empty', async ({ page }, row: number, name: string) => {
  await expect(await cellOf(page, name, row)).toHaveText('');
});

Then('row {int} of {string} shows an error', async ({ page }, row: number, name: string) => {
  const cell = await cellOf(page, name, row);

  await expect(cell.locator('[data-testid^="formula-cell-error-"]')).toHaveText('Error', { timeout: 15000 });
});

When('I hover the error in row {int} of {string}', async ({ page }, row: number, name: string) => {
  const cell = await cellOf(page, name, row);

  await cell.locator('[data-testid^="formula-cell-error-"]').hover();
});

Then('the error tooltip reads {string}', async ({ page }, text: string) => {
  await expect(tooltip(page, text)).toBeVisible({ timeout: 10000 });
});

function bar(cell: Locator): Locator {
  return cell.getByTestId('formula-bar-visualization');
}

Then('row {int} of {string} shows a bar filled {int}%', async ({ page }, row: number, name: string, percent: number) => {
  await expect(bar(await cellOf(page, name, row))).toHaveAttribute('aria-valuenow', String(percent));
});

Then('row {int} of {string} shows a bar colored {string}', async ({ page }, row: number, name: string, color: string) => {
  const fill = bar(await cellOf(page, name, row)).locator('div > div');

  // The fill uses the palette variable of the chosen color.
  await expect(fill).toHaveAttribute('style', new RegExp(`--palette-[a-z-]*${color.replace('text-color-', '')}\\b|${color}`));
});

Then(
  'row {int} of {string} shows a bar with the number {string}',
  async ({ page }, row: number, name: string, value: string) => {
    await expect(bar(await cellOf(page, name, row)).locator('> span')).toHaveText(value);
  }
);

Then('row {int} of {string} shows a ring', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).getByTestId('formula-ring-visualization')).toBeVisible();
});

When(/^a collaborator sets row (\d+) of "([^"]*)" to "(.*)"$/, async ({ page }, row: string, name: string, value: string) => {
  const index = Number(row) - 1;
  const id = await fieldId(page, name);
  const field = (await readGridFieldsDirect(page)).find((entry) => entry.id === id);

  await seedColumn(
    page,
    id,
    inputTypeOfField(field?.type ?? FieldType.RichText),
    Array.from({ length: index + 1 }, (_, current) => (current === index ? value : '<empty>'))
  );
});

When(
  'a collaborator renames the option {string} of {string} to {string}',
  async ({ page }, from: string, name: string, to: string) => {
    await page.evaluate(
      ({ fieldId, from, to }) => {
        const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
        const field = ctx.databaseDoc.getMap('data').get('database').get('fields').get(fieldId);
        const typeOptions = field.get('type_option');

        ctx.databaseDoc.transact(() => {
          typeOptions.forEach((option: any) => {
            const content = option.get('content');

            if (typeof content !== 'string' || !content.includes('"options"')) return;
            const parsed = JSON.parse(content);

            parsed.options = parsed.options.map((item: { name: string }) =>
              item.name === from ? { ...item, name: to } : item
            );
            option.set('content', JSON.stringify(parsed));
          });
          field.set('last_modified', String(Math.floor(Date.now() / 1000)));
        });
      },
      { fieldId: await fieldId(page, name), from, to }
    );
  }
);

When('I add a row to the grid', async ({ page }) => {
  const rows = DatabaseGridSelectors.dataRows(page);
  const count = await rows.count();

  await closeMenus(page);
  await DatabaseGridSelectors.newRowButton(page).click();
  await expect(rows).toHaveCount(count + 1, { timeout: 10000 });
  await closeMenus(page);
});

When('I reload the grid', async ({ page }) => {
  await page.reload();
  await waitForGridReady(page);
  await page.waitForTimeout(2000);
});

When('I turn on wrapping for {string}', async ({ page }, name: string) => {
  await openHeaderMenu(page, await fieldId(page, name));
  const wrap = page.getByTestId('grid-field-wrap').last();

  if ((await wrap.getAttribute('data-state')) !== 'checked') await wrap.click();
  await expect(wrap).toHaveAttribute('data-state', 'checked');
  await closeMenus(page);
});

Then('row {int} of {string} wraps', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).locator('.formula-cell')).toHaveCSS('flex-wrap', 'wrap');
});

Then('row {int} of {string} does not wrap', async ({ page }, row: number, name: string) => {
  await expect((await cellOf(page, name, row)).locator('.formula-cell')).toHaveCSS('flex-wrap', 'nowrap');
});

// ---------------------------------------------------------------------------
// Row page and other views
// ---------------------------------------------------------------------------

async function rowPageFormula(page: Page, name: string): Promise<Locator> {
  const shownRow = state(page).rowPage;

  if (!shownRow) throw new Error('No row page is open');
  return RowDetailSelectors.modal(page).getByTestId(`formula-cell-${shownRow}-${await fieldId(page, name)}`);
}

When('I open the row page of row {int}', async ({ page }, row: number) => {
  await closeMenus(page);
  state(page).rowPage = await rowId(page, row);
  await openRowDetail(page, row - 1);
});

Then('the row page shows the formula {string} as {string}', async ({ page }, name: string, value: string) => {
  await expect(await rowPageFormula(page, name)).toHaveText(value, { timeout: 15000 });
});

When('I click the formula {string} on the row page', async ({ page }, name: string) => {
  await (await rowPageFormula(page, name)).click();
  await expect(formulaDialog(page)).toBeVisible({ timeout: 15000 });
});

When('I add a {string} view', async ({ page }, layout: string) => {
  await closeMenus(page);
  const tabs = DatabaseViewSelectors.viewTab(page);
  const previousCount = await tabs.count();

  await DatabaseViewSelectors.addViewButton(page).click();
  const testIds: Record<string, string> = { List: 'add-list-view-button', Gallery: 'add-gallery-view-button' };
  const option = testIds[layout]
    ? page.getByTestId(testIds[layout])
    : page.locator('[data-slot="dropdown-menu-content"] [role="menuitem"]').filter({ hasText: layout }).first();

  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
  await expect(tabs).toHaveCount(previousCount + 1, { timeout: 20000 });
  await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(layout, { timeout: 20000 });
});

When('I show the property {string} in the current view', async ({ page }, name: string) => {
  const id = await fieldId(page, name);
  const trigger = page.getByTestId('database-properties-settings-trigger');

  await closeMenus(page);
  await page.getByTestId('database-actions-settings').click();
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  const toggle = page.getByTestId(`database-property-visibility-${id}`);

  await expect(toggle).toBeVisible({ timeout: 10000 });
  if ((await toggle.getAttribute('aria-label'))?.startsWith('Show ')) {
    await toggle.evaluate((element) => (element as HTMLButtonElement).click());
  }

  await expect(toggle).toHaveAttribute('aria-label', /^Hide /);
  await closeMenus(page);
});

Then(
  'the current view shows the formula {string} for row {int} as {string}',
  async ({ page }, name: string, row: number, value: string) => {
    const cell = page.getByTestId(`formula-cell-${await rowId(page, row)}-${await fieldId(page, name)}`).last();

    await expect(cell).toBeVisible({ timeout: 20000 });
    await expect(cell).toHaveText(value);
  }
);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

async function visibleRowNames(page: Page): Promise<string[]> {
  const nameId = await fieldId(page, 'Name');

  // Columns are virtualized: bring Name back after working on a far column.
  await revealColumn(page, nameId);
  const cells = DatabaseGridSelectors.dataRowCellsForField(page, nameId);
  const count = await cells.count();
  const texts: string[] = [];

  for (let index = 0; index < count; index += 1) texts.push(((await cells.nth(index).textContent()) ?? '').trim());
  return texts;
}

async function expectRows(page: Page, expected: string[], message?: string) {
  await expect.poll(() => visibleRowNames(page), { timeout: 15000, message }).toEqual(expected);
}

Then('the grid shows these rows', async ({ page }, table: DataTable) => {
  await expectRows(page, column(table));
});

Then('the grid shows {int} rows', async ({ page }, count: number) => {
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(count, { timeout: 15000 });
});

async function applyValueFilter(page: Page, name: string, condition: string, conditionId: number, value: string) {
  await addFilterByFieldName(page, name);
  await changeFilterCondition(page, conditionId);
  if (!VALUELESS_CONDITIONS.has(condition)) await enterFilterText(page, value);
  await closeMenus(page);
}

async function removeOnlyFilter(page: Page) {
  await closeMenus(page);
  await deleteFilter(page);
  await closeMenus(page);
  await expect(DatabaseFilterSelectors.filterCondition(page)).toHaveCount(0, { timeout: 10000 });
}

When(
  'I filter {string} with the number condition {string} and value {string}',
  async ({ page }, name: string, condition: string, value: string) => {
    const conditionId = NUMBER_CONDITIONS[condition];

    if (conditionId === undefined) throw new Error(`Unknown number condition: ${condition}`);
    await applyValueFilter(page, name, condition, conditionId, value);
  }
);

Then(
  'filtering {string} by these number conditions shows these rows',
  async ({ page }, name: string, table: DataTable) => {
    for (const { condition, value, rows } of table.hashes()) {
      const conditionId = NUMBER_CONDITIONS[condition];

      if (conditionId === undefined) throw new Error(`Unknown number condition: ${condition}`);
      await applyValueFilter(page, name, condition, conditionId, value);
      await expectRows(page, names(rows), `${name} ${condition} ${value}`);
      await removeOnlyFilter(page);
    }
  }
);

Then('filtering {string} by these text conditions shows these rows', async ({ page }, name: string, table: DataTable) => {
  for (const { condition, value, rows } of table.hashes()) {
    const conditionId = TEXT_CONDITIONS[condition];

    if (conditionId === undefined) throw new Error(`Unknown text condition: ${condition}`);
    await applyValueFilter(page, name, condition, conditionId, value);
    await expectRows(page, names(rows), `${name} ${condition} ${value}`);
    await removeOnlyFilter(page);
  }
});

Then(
  'filtering {string} by these checkbox conditions shows these rows',
  async ({ page }, name: string, table: DataTable) => {
    for (const { condition, rows } of table.hashes()) {
      await addFilterByFieldName(page, name);
      await changeCheckboxFilterCondition(
        page,
        condition === 'checked' ? CheckboxFilterCondition.IsChecked : CheckboxFilterCondition.IsUnchecked
      );
      await closeMenus(page);
      await expectRows(page, names(rows), `${name} ${condition}`);
      await removeOnlyFilter(page);
    }
  }
);

Then('filtering {string} by these date conditions shows these rows', async ({ page }, name: string, table: DataTable) => {
  for (const { condition, rows } of table.hashes()) {
    const conditionId = DATE_CONDITIONS[condition];

    if (conditionId === undefined) throw new Error(`Unknown date condition: ${condition}`);
    await addFilterByFieldName(page, name);
    await changeFilterCondition(page, conditionId);

    if (condition === 'is on today') {
      await page.getByTestId('date-filter-date-picker').last().click({ force: true });
      const today = String(new Date().getDate());
      const calendar = page.locator('[data-radix-popper-content-wrapper]').last();

      await calendar
        .locator('button[name="day"], [role="gridcell"] button, button')
        .filter({ hasText: new RegExp(`^${today}$`) })
        .first()
        .click({ force: true });
    }

    await closeMenus(page);
    await expectRows(page, names(rows), `${name} ${condition}`);
    await removeOnlyFilter(page);
  }
});

When('I add a filter on {string} from its header menu', async ({ page }, name: string) => {
  await openHeaderMenu(page, await fieldId(page, name));
  await page.getByTestId('grid-field-filter').last().click();
  await expect(page.locator('[data-testid="filter-condition-trigger"]:visible').last()).toBeVisible({
    timeout: 10000,
  });
});

When('I set the open number filter to {string} {string}', async ({ page }, condition: string, value: string) => {
  const conditionId = NUMBER_CONDITIONS[condition];

  if (conditionId === undefined) throw new Error(`Unknown number condition: ${condition}`);
  await changeFilterCondition(page, conditionId);
  await enterFilterText(page, value);
  await closeMenus(page);
});

Then('the filter chip reads {string}', async ({ page }, text: string) => {
  await expect(DatabaseFilterSelectors.filterCondition(page).first()).toHaveText(text, { timeout: 15000 });
});

When('I switch the filters to advanced mode', async ({ page }) => {
  await closeMenus(page);
  await clickFilterChip(page);
  await DatabaseFilterSelectors.filterMoreOptionsButton(page).click({ force: true });
  await page
    .locator('[data-slot="dropdown-menu-item"]')
    .filter({ hasText: /switch to advanced filter/i })
    .click({ force: true });
  await expect(DatabaseFilterSelectors.advancedFiltersBadge(page)).toBeVisible({ timeout: 15000 });
  await closeMenus(page);
});

When('I add an advanced filter rule on {string}', async ({ page }, name: string) => {
  const id = await fieldId(page, name);
  const rows = page.getByTestId('advanced-filter-row');

  await closeMenus(page);
  await DatabaseFilterSelectors.advancedFiltersBadge(page).click({ force: true });
  const count = await rows.count();

  await page.getByTestId('add-advanced-filter-button').click();
  await page.locator(`[data-item-id="${id}"]:visible`).click();
  await expect(rows).toHaveCount(count + 1, { timeout: 10000 });
  await closeMenus(page);
});

Then(
  'the advanced filter row for {string} offers these conditions',
  async ({ page }, name: string, table: DataTable) => {
    await closeMenus(page);
    await DatabaseFilterSelectors.advancedFiltersBadge(page).click({ force: true });
    const row = page.getByTestId('advanced-filter-row').filter({ hasText: name }).first();

    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByTestId('filter-condition-selector').click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]').last();

    await expect(menu.locator('[data-testid^="filter-condition-"]')).toHaveText(column(table));
    await closeMenus(page);
  }
);

// ---------------------------------------------------------------------------
// Sorts
// ---------------------------------------------------------------------------

When('I sort {string} ascending', async ({ page }, name: string) => {
  await closeMenus(page);
  await addSortByFieldName(page, name);
  await openSortMenu(page);
  await changeSortDirection(page, 0, SortDirection.Ascending);
  await closeMenus(page);
});

When('I sort {string} descending', async ({ page }, name: string) => {
  await closeMenus(page);
  await addSortByFieldName(page, name);
  await openSortMenu(page);
  await changeSortDirection(page, 0, SortDirection.Descending);
  await closeMenus(page);
});

When('I remove all sorts', async ({ page }) => {
  await closeMenus(page);
  await openSortMenu(page);
  await deleteAllSorts(page);
  await closeMenus(page);
});

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

function calculationValue(page: Page, fieldId: string): Locator {
  return page.getByTestId(`grid-calculate-cell-${fieldId}`).last().locator('span').last();
}

When('I set the calculation of {string} to {string}', async ({ page }, name: string, calculation: string) => {
  const calculationId = CALCULATION_IDS[calculation];

  if (calculationId === undefined) throw new Error(`Unknown calculation: ${calculation}`);
  await chooseCalculation(page, await fieldId(page, name), calculationId);
});

Then('the calculation of {string} shows {string}', async ({ page }, name: string, value: string) => {
  const id = await fieldId(page, name);

  await revealColumn(page, id);
  await expect(calculationValue(page, id)).toHaveText(value, { timeout: 15000 });
});

Then('the calculations of {string} show', async ({ page }, name: string, table: DataTable) => {
  const id = await fieldId(page, name);

  for (const { calculation, value } of table.hashes()) {
    const calculationId = CALCULATION_IDS[calculation];

    if (calculationId === undefined) throw new Error(`Unknown calculation: ${calculation}`);
    await chooseCalculation(page, id, calculationId);
    await expect(calculationValue(page, id), `${calculation} of ${name}`).toHaveText(value, { timeout: 15000 });
  }
});

Then('the calculation options for {string} are', async ({ page }, name: string, table: DataTable) => {
  const id = await fieldId(page, name);

  await closeMenus(page);
  await revealColumn(page, id);
  await page.getByTestId(`grid-calculate-cell-${id}`).last().click({ force: true });
  await expect(page.locator('[data-testid^="calculation-option-"]')).toHaveText(column(table));
  await closeMenus(page);
});
