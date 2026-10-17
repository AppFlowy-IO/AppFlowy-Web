import { readFileSync } from 'fs';

import { expect, type Locator, type Page, test } from '@playwright/test';
import { createBdd, DataTable } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import {
  fieldIdByName,
  formulaInput,
  openFormulaEditorFromCell,
  readGridFieldsDirect,
  revealColumn,
  saveFormula,
  typeFormula,
} from '../../support/formula-test-helpers';
import {
  AddPageSelectors,
  DatabaseGridSelectors,
  FieldType,
  ImportSelectors,
  PageSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then } = createBdd();
const conversionCsv = readFileSync(
  new URL('../../fixtures/database/csv/notion_formula_conversion_test_data.csv', import.meta.url)
);
const conversionRows = conversionCsv
  .toString('utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.split(','));

// Notion copies property tokens as their names. prop() makes those same tokens
// explicit when pasting plain text into AppFlowy's formula editor.
const conversionFormula = `let(
  Conversion, round((prop("Done") / (prop("In progress") + prop("Done"))) * 100),
  if(Conversion > 90, style(format(Conversion), "red"), format(Conversion))
)`;

Given("a Grid with the reporter's conversion CSV", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await PageSelectors.items(page).first().hover();
  await AddPageSelectors.inlineAddButton(page).first().click();
  await AddPageSelectors.addImportButton(page).click();
  await expect(ImportSelectors.dialog(page)).toBeVisible();
  // Use the real CSV importer, as desktop does; no seeded replacement database.
  await ImportSelectors.csvInput(page).setInputFiles({
    name: 'notion_formula_conversion_test_data.csv',
    mimeType: 'text/csv',
    buffer: conversionCsv,
  });
  await expect(ImportSelectors.dialog(page)).not.toBeVisible({ timeout: 120_000 });
  await waitForGridReady(page);
  const fields = await readGridFieldsDirect(page);

  for (const name of ['Done', 'In progress']) {
    expect(fields.find((field) => field.name === name)?.type).toBe(FieldType.Number);
  }
  const nameId = fields.find((field) => field.name === 'Name')!.id;

  await expect(DatabaseGridSelectors.dataRowCellsForField(page, nameId)).toHaveText(
    conversionRows.map(([name]) => name)
  );
});

Given('the formula grid uses the {string} theme', async ({ page }, theme: string) => {
  if (theme !== 'light' && theme !== 'dark') throw new Error(`Unknown theme: ${theme}`);
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator('html')).toHaveAttribute('data-dark-mode', String(theme === 'dark'));
});

When("I paste the reporter's conditional conversion formula", async ({ page }) => {
  await formulaInput(page).evaluate((element, formula) => {
    const clipboardData = new DataTransfer();

    clipboardData.setData('text/plain', formula);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, conversionFormula);
  await expect(formulaInput(page)).toHaveAttribute('data-value', conversionFormula);
});

/** Red-only/plain results must also clear typography left by a previous result. */
async function expectConversionStyle(locator: Locator, color: string, text: string, formats = 'none'): Promise<void> {
  expect(['red', 'default']).toContain(color);
  const baseline = await locator.evaluate((element) => {
    const css = getComputedStyle(element);

    return {
      color: css.color,
      backgroundColor: css.backgroundColor,
      fontWeight: '400',
      fontStyle: 'normal',
      textDecorationLine: 'none',
      fontFamily: css.fontFamily,
      borderRadius: '0px',
    };
  });
  const expected = await expectedStyle(
    locator,
    baseline,
    { formats, foreground: color === 'red' ? '--palette-text-color-1' : '--text-primary', background: 'default' },
    baseline.fontFamily
  );

  await expect
    .poll(() => renderedStyles(locator, 0, text.length), { message: `Formula ${text} uses exactly ${color}/${formats}` })
    .toEqual({ text, styles: [expected] });
}

Then("the conversion formula matches the reporter's expected text and colors", async ({ page }, table: DataTable) => {
  const formulaId = await fieldIdByName(page, 'Formula');

  await revealColumn(page, formulaId);

  for (const { row, value, color } of table.hashes()) {
    const index = conversionRows.findIndex(([name]) => name === row);

    expect(index, `CSV row ${row}`).toBeGreaterThanOrEqual(0);
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, formulaId).nth(index).locator('.formula-cell');

    await cell.scrollIntoViewIfNeeded();
    await expect(cell, row).toHaveText(value);
    await expectConversionStyle(cell, color, value);
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
  await expectConversionStyle(page.getByTestId('formula-preview-value'), color, '91');
});

When('I add bold italic and underline to the conversion formula', async ({ page }) => {
  await typeFormula(page, conversionFormula.replace('"red"', '"red", "b", "i", "u"'));
});

Then(
  'the conversion formula preview renders {string} in {string} with formats {string}',
  async ({ page }, text: string, color: string, formats: string) => {
    await expectConversionStyle(page.getByTestId('formula-preview-value'), color, text, formats);
  }
);

Then(
  'conversion row {int} renders {string} in {string} with formats {string}',
  async ({ page }, row: number, text: string, color: string, formats: string) => {
    const id = await fieldIdByName(page, 'Formula');
    const cell = DatabaseGridSelectors.dataRowCellsForField(page, id)
      .nth(row - 1)
      .locator('.formula-cell');

    await cell.scrollIntoViewIfNeeded();
    await expectConversionStyle(cell, color, text, formats);
  }
);

interface RenderedStyle {
  color: string;
  backgroundColor: string;
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
  fontFamily: string;
  borderRadius: string;
}

interface StyleExpectation {
  formats: string;
  foreground: string;
  background: string;
}

const MIXED_TEXT = 'Styled Plain';
const PLAIN_STYLE: StyleExpectation = { formats: 'none', foreground: 'default', background: 'default' };

/** Text offsets allow plain/coalesced results and nested spans to share the same assertions. */
async function renderedStyles(locator: Locator, start: number, end: number) {
  return locator.evaluate(
    (element, range) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const styles: RenderedStyle[] = [];
      let offset = 0;

      while (walker.nextNode()) {
        const length = walker.currentNode.textContent?.length ?? 0;

        if (offset < range.end && offset + length > range.start) {
          const leaf = walker.currentNode.parentElement!;
          const computed = getComputedStyle(leaf);
          const decorations = new Set<string>();
          let backgroundColor = 'rgba(0, 0, 0, 0)';

          // Decorations and painted backgrounds can come from a containing span,
          // even though these CSS properties are not inherited by the text leaf.
          for (let ancestor: Element | null = leaf; ancestor; ancestor = ancestor.parentElement) {
            const parentStyle = getComputedStyle(ancestor);

            for (const decoration of parentStyle.textDecorationLine.split(' ')) {
              if (decoration !== 'none') decorations.add(decoration);
            }

            if (backgroundColor === 'rgba(0, 0, 0, 0)' && parentStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
              backgroundColor = parentStyle.backgroundColor;
            }

            if (ancestor === element) break;
          }

          styles.push({
            color: computed.color,
            backgroundColor,
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            textDecorationLine: [...decorations].sort().join(' ') || 'none',
            fontFamily: computed.fontFamily,
            borderRadius: computed.borderRadius,
          });
        }

        offset += length;
      }

      return {
        text: element.textContent,
        styles: [...new Map(styles.map((style) => [JSON.stringify(style), style])).values()],
      };
    },
    { start, end }
  );
}

async function themeColor(locator: Locator, token: string): Promise<string> {
  const result = await locator.evaluate((element, variable) => {
    const value = getComputedStyle(element).getPropertyValue(variable).trim();
    const probe = document.createElement('span');

    probe.style.color = `var(${variable})`;
    element.append(probe);
    const color = getComputedStyle(probe).color;

    probe.remove();
    return { value, color };
  }, token);

  expect(result.value, `Theme token ${token} must exist`).not.toBe('');
  return result.color;
}

async function expectedStyle(
  locator: Locator,
  baseline: RenderedStyle,
  expected: StyleExpectation,
  monoFont: string
): Promise<RenderedStyle> {
  const formats = expected.formats === 'none' ? [] : expected.formats.split(' ');

  expect(formats.every((format) => ['b', 'i', 'u', 's', 'c'].includes(format))).toBe(true);
  return {
    ...baseline,
    color: expected.foreground === 'default' ? baseline.color : await themeColor(locator, expected.foreground),
    backgroundColor:
      expected.background === 'default' ? baseline.backgroundColor : await themeColor(locator, expected.background),
    fontWeight: formats.includes('b') ? '700' : baseline.fontWeight,
    fontStyle: formats.includes('i') ? 'italic' : baseline.fontStyle,
    textDecorationLine:
      [...(formats.includes('s') ? ['line-through'] : []), ...(formats.includes('u') ? ['underline'] : [])].join(' ') ||
      baseline.textDecorationLine,
    fontFamily: formats.includes('c') ? monoFont : baseline.fontFamily,
    borderRadius: formats.includes('c') ? '4px' : baseline.borderRadius,
  };
}

async function expectStyledAndPlainRuns(locator: Locator, baseline: RenderedStyle, expected: RenderedStyle) {
  await expect(locator).toHaveText(MIXED_TEXT);
  await expect
    .poll(() => renderedStyles(locator, 0, 6), { message: 'Styled run has exactly the requested CSS' })
    .toEqual({ text: MIXED_TEXT, styles: [expected] });
  await expect
    .poll(() => renderedStyles(locator, 6, MIXED_TEXT.length), { message: 'Plain neighbor has no extra styles' })
    .toEqual({ text: MIXED_TEXT, styles: [baseline] });
}

/** Reuse one real field so every edit also checks removal of its previous styling. */
async function formulaStyleHarness(page: Page) {
  const fieldId = await fieldIdByName(page, 'Styles');
  const cell = DatabaseGridSelectors.dataRowCellsForField(page, fieldId).first().locator('.formula-cell');

  await expect(cell).toHaveText(MIXED_TEXT);
  const cellBaseline = (await renderedStyles(cell, 0, MIXED_TEXT.length)).styles;

  expect(cellBaseline).toHaveLength(1);
  await openFormulaEditorFromCell(page, fieldId, 0);
  const preview = page.getByTestId('formula-preview-value');

  await expect(preview).toHaveText(MIXED_TEXT);
  const previewBaseline = (await renderedStyles(preview, 0, MIXED_TEXT.length)).styles;
  const monoFont = await page.evaluate(() => {
    const probe = document.createElement('span');

    probe.className = 'font-mono';
    document.body.append(probe);
    const family = getComputedStyle(probe).fontFamily;

    probe.remove();
    return family;
  });

  expect(previewBaseline).toHaveLength(1);
  expect(monoFont).toContain('monospace');
  expect(cellBaseline[0].fontFamily, 'Code must change the cell font').not.toBe(monoFont);

  return async (expression: string, expected: StyleExpectation) => {
    if (!(await formulaInput(page).isVisible())) await openFormulaEditorFromCell(page, fieldId, 0);
    await typeFormula(page, expression);
    await expect(page.getByTestId('formula-editor-error')).toHaveCount(0);
    await expectStyledAndPlainRuns(
      preview,
      previewBaseline[0],
      await expectedStyle(preview, previewBaseline[0], expected, monoFont)
    );
    await saveFormula(page);
    await expectStyledAndPlainRuns(
      cell,
      cellBaseline[0],
      await expectedStyle(cell, cellBaseline[0], expected, monoFont)
    );
  };
}

Then(
  'each formula style option has these rendered properties and clears completely',
  async ({ page }, table: DataTable) => {
    test.setTimeout(600_000);
    const rows = table.hashes();

    expect(rows).toHaveLength(23);
    expect(new Set(rows.map(({ option }) => option)).size).toBe(23);
    const verify = await formulaStyleHarness(page);

    for (const { option, formats, foreground, background } of rows) {
      await test.step(`Render and clear ${option} in preview and cell`, async () => {
        await verify(`style("Styled", "${option}") + " Plain"`, { formats, foreground, background });
        await verify(`unstyle(style("Styled", "${option}"), "${option}") + " Plain"`, PLAIN_STYLE);
      });
    }
  }
);

Then(
  'these formula expressions paint exactly the requested styled and plain runs',
  async ({ page }, table: DataTable) => {
    test.setTimeout(240_000);
    const verify = await formulaStyleHarness(page);

    for (const { expression, formats, foreground, background } of table.hashes()) {
      await test.step(expression, () => verify(expression, { formats, foreground, background }));
    }
  }
);
