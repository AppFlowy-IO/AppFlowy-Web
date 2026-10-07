import { readFileSync } from 'fs';

import { expect, type Locator, test } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { loginAndCreateGrid } from '../../support/field-type-helpers';
import {
  addInputField,
  ensureRowCount,
  fieldIdByName,
  formulaInput,
  readGridFieldsDirect,
  renameFieldDirect,
  revealColumn,
  seedColumn,
  trimRowsDirect,
} from '../../support/formula-test-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();
const conversionCsv = readFileSync(
  new URL('../../fixtures/database/csv/notion_formula_conversion_test_data.csv', import.meta.url),
  'utf8'
)
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split(','));
const [headers, ...conversionRows] = conversionCsv;

// Notion copies property tokens as their names. prop() makes those same tokens
// explicit when pasting plain text into AppFlowy's formula editor.
const conversionFormula = `let(
  Conversion, round((prop("Done") / (prop("In progress") + prop("Done"))) * 100),
  if(Conversion > 90, style(format(Conversion), "red"), format(Conversion))
)`;

Given("a Grid with the reporter's conversion CSV", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  expect(headers).toEqual(['Name', 'Done', 'In progress']);
  await loginAndCreateGrid(page, request, generateRandomEmail());
  await ensureRowCount(page, conversionRows.length);
  await trimRowsDirect(page, conversionRows.length);

  const defaults = await readGridFieldsDirect(page);
  const nameField = defaults.find((field) => field.name === 'Name')!;
  const doneCheckbox = defaults.find((field) => field.name === 'Done');

  if (doneCheckbox) await renameFieldDirect(page, doneCheckbox.id, 'Original checkbox');
  await seedColumn(
    page,
    nameField.id,
    'Text',
    conversionRows.map((row) => row[0])
  );
  for (const [index, name] of headers.entries()) {
    if (index === 0) continue;
    const fieldId = await addInputField(page, name, 'Number');

    await seedColumn(
      page,
      fieldId,
      'Number',
      conversionRows.map((row) => row[index])
    );
  }
});

When("I paste the reporter's conditional conversion formula", async ({ page }) => {
  await formulaInput(page).evaluate((element, formula) => {
    const clipboardData = new DataTransfer();

    clipboardData.setData('text/plain', formula);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, conversionFormula);
  await expect(formulaInput(page)).toHaveAttribute('data-value', conversionFormula);
});

/** Inspect the element that paints each text node, including nested rich spans. */
async function expectTextColor(locator: Locator, color: string, text: string): Promise<void> {
  expect(['red', 'default']).toContain(color);
  const expected = await locator.evaluate(
    (element, expectedColor) => {
      const probe = document.createElement('span');

      probe.style.color = expectedColor;
      element.append(probe);
      const expected = getComputedStyle(probe).color;

      probe.remove();
      return expected;
    },
    color === 'red' ? 'var(--palette-text-color-1)' : 'var(--text-primary)'
  );

  await expect
    .poll(
      () =>
        locator.evaluate((element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const actual: string[] = [];

          while (walker.nextNode()) {
            if (walker.currentNode.textContent?.trim())
              actual.push(getComputedStyle(walker.currentNode.parentElement!).color);
          }

          return { text: element.textContent?.trim(), colors: [...new Set(actual)] };
        }),
      { message: `Formula text uses ${color} foreground` }
    )
    .toEqual({ text, colors: [expected] });
}

Then("the conversion formula matches the reporter's expected text and colors", async ({ page }, table: DataTable) => {
  const formulaId = await fieldIdByName(page, 'Formula');

  await revealColumn(page, formulaId);

  for (const { row, value, color } of table.hashes()) {
    const index = conversionRows.findIndex(([name]) => name === row);

    expect(index, `CSV row ${row}`).toBeGreaterThanOrEqual(0);
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, formulaId).nth(index);

    await cell.scrollIntoViewIfNeeded();
    await expect(cell, row).toHaveText(value);
    await expectTextColor(cell, color, value);
  }

  if (table.hashes().length === conversionRows.length) {
    const screenshotPath = test.info().outputPath('conversion-formula-colors.png');

    await page.screenshot({ path: screenshotPath });
    await test.info().attach('conversion-formula-colors', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  }
});

Then('the conversion formula preview text is {string}', async ({ page }, color: string) => {
  await expectTextColor(page.getByTestId('formula-preview-value'), color, '91');
});
