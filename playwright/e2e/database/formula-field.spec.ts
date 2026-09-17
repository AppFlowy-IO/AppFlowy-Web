import { expect, test } from '@playwright/test';

import {
  addFieldWithType,
  clickFieldHeaderById,
  FieldType,
  generateRandomEmail,
  getAllCellContents,
  loginAndCreateGrid,
  setupFieldTypeTest,
  typeTextIntoCell,
} from '../../support/field-type-helpers';
import { DatabaseGridSelectors, GridFieldSelectors, PropertyMenuSelectors } from '../../support/selectors';

test.describe('Formula field', () => {
  test.beforeEach(async ({ page }) => {
    setupFieldTypeTest(page);
  });

  test('computes from other properties, updates live and formats numbers', async ({ page, request }) => {
    test.setTimeout(240_000);
    await loginAndCreateGrid(page, request, generateRandomEmail());

    // A Number column with a value per row.
    const numberFieldId = await addFieldWithType(page, FieldType.Number);
    const rowCount = await DatabaseGridSelectors.dataRowCellsForField(page, numberFieldId).count();

    expect(rowCount).toBeGreaterThanOrEqual(2);
    await typeTextIntoCell(page, numberFieldId, 0, '10');
    await typeTextIntoCell(page, numberFieldId, 1, '20');

    // Picking Formula from the type list opens the editor straight away.
    const newPropertyButton = PropertyMenuSelectors.newPropertyButton(page).last();

    await newPropertyButton.scrollIntoViewIfNeeded();
    await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
    await page.waitForTimeout(1200);
    await PropertyMenuSelectors.propertyTypeTrigger(page).last().hover({ force: true });
    const formulaOption = PropertyMenuSelectors.propertyTypeOption(page, FieldType.Formula).last();

    await formulaOption.waitFor({ state: 'attached' });
    await formulaOption.evaluate((element) => (element as HTMLElement).click());

    const dialog = page.getByTestId('formula-editor-dialog');

    await expect(dialog).toBeVisible({ timeout: 15000 });

    const input = page.getByTestId('formula-editor-input');

    await expect(input).toBeFocused();
    await input.pressSequentially('prop("Numbers") * 2', { delay: 20 });

    // Type is inferred live and the preview evaluates against the first row.
    await expect(page.getByTestId('formula-editor-type')).toHaveText(/number/);
    await expect(page.getByTestId('formula-preview-value')).toHaveText('20');
    await expect(page.getByTestId('formula-editor-error')).toHaveCount(0);

    await page.getByTestId('formula-editor-done').click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const formulaFieldId =
      (await GridFieldSelectors.allFieldHeaders(page).last().getAttribute('data-testid'))?.replace(
        'grid-field-header-',
        ''
      ) ?? '';

    expect(formulaFieldId).not.toBe('');
    await expect
      .poll(async () => (await getAllCellContents(page, formulaFieldId)).slice(0, 2), { timeout: 15000 })
      .toEqual(['20', '40']);

    // Editing an input re-evaluates the formula.
    await typeTextIntoCell(page, numberFieldId, 0, '15');
    await expect
      .poll(async () => (await getAllCellContents(page, formulaFieldId)).slice(0, 2), { timeout: 15000 })
      .toEqual(['30', '40']);

    // Number-typed formulas expose a Number format, like a Number column.
    await clickFieldHeaderById(page, formulaFieldId);
    await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
    await page.waitForTimeout(800);
    await page.getByTestId('formula-number-format').hover({ force: true });
    const usd = page.getByTestId('formula-number-format-1');

    await usd.waitFor({ state: 'attached' });
    await usd.evaluate((element) => (element as HTMLElement).click());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await getAllCellContents(page, formulaFieldId)).slice(0, 2), { timeout: 15000 })
      .toEqual(['$30', '$40']);

    // Clicking a formula cell opens the editor for that row (Notion parity),
    // pre-filled with the saved expression and previewing that row.
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, formulaFieldId).nth(1);

    await cell.scrollIntoViewIfNeeded();
    await cell.evaluate((element) => (element as HTMLElement).click());
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('formula-editor-input')).toHaveValue('prop("Numbers") * 2');
    await expect(page.getByTestId('formula-preview-value')).toHaveText('$40');
    await page.getByTestId('formula-editor-cancel').click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  test('reports type errors in the editor and disables Done', async ({ page, request }) => {
    test.setTimeout(180_000);
    await loginAndCreateGrid(page, request, generateRandomEmail());

    const newPropertyButton = PropertyMenuSelectors.newPropertyButton(page).last();

    await newPropertyButton.scrollIntoViewIfNeeded();
    await newPropertyButton.evaluate((element) => (element as HTMLElement).click());
    await page.waitForTimeout(1200);
    await PropertyMenuSelectors.propertyTypeTrigger(page).last().hover({ force: true });
    const formulaOption = PropertyMenuSelectors.propertyTypeOption(page, FieldType.Formula).last();

    await formulaOption.waitFor({ state: 'attached' });
    await formulaOption.evaluate((element) => (element as HTMLElement).click());

    const dialog = page.getByTestId('formula-editor-dialog');

    await expect(dialog).toBeVisible({ timeout: 15000 });
    const input = page.getByTestId('formula-editor-input');

    await input.pressSequentially('"a" - 1', { delay: 20 });
    await expect(page.getByTestId('formula-editor-error')).toContainText('"-" expects a number');
    await expect(page.getByTestId('formula-editor-done')).toBeDisabled();

    // Autocomplete lists functions as you type and inserts on Enter.
    await input.fill('');
    await input.pressSequentially('upp', { delay: 20 });
    await expect(page.getByTestId('formula-suggestion-upper()')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('upper()');
    await input.pressSequentially('"hi"', { delay: 20 });
    await expect(page.getByTestId('formula-editor-type')).toHaveText(/text/);
    await expect(page.getByTestId('formula-preview-value')).toHaveText('HI');
    await expect(page.getByTestId('formula-editor-done')).toBeEnabled();
    await page.getByTestId('formula-editor-done').click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const formulaFieldId =
      (await GridFieldSelectors.allFieldHeaders(page).last().getAttribute('data-testid'))?.replace(
        'grid-field-header-',
        ''
      ) ?? '';

    await expect
      .poll(async () => (await getAllCellContents(page, formulaFieldId)).slice(0, 1), { timeout: 15000 })
      .toEqual(['HI']);
  });
});
