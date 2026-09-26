import { readFileSync } from 'fs';

import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { formulaInput } from '../../support/formula-test-helpers';

const { When, Then } = createBdd();

// The reporter's formulas, verbatim (tabs, blank lines, emoji and Arabic text),
// shared with the unit tests.
const ISSUE_9039_URL = new URL(
  '../../../src/application/database-yjs/fields/formula/__tests__/issue-9039-formulas.json',
  import.meta.url
);
const issue9039 = JSON.parse(readFileSync(ISSUE_9039_URL, 'utf8')) as {
  statusFormula: string;
  hijriMonthFormula: string;
};
const ISSUE_FORMULAS: Record<string, string> = {
  status: issue9039.statusFormula,
  'Hijri month': issue9039.hijriMonthFormula,
};

/** The dialog body that scrolls when the editor is taller than the dialog. */
function dialogBody(page: Page) {
  return page.getByTestId('formula-editor').locator('xpath=..');
}

When(/^I paste the reporter's "(.*)" formula into the formula editor$/, async ({ page }, name: string) => {
  const formula = ISSUE_FORMULAS[name];

  if (formula === undefined) throw new Error(`Unknown issue formula: ${name}`);
  await formulaInput(page).evaluate((element, pasted) => {
    const data = new DataTransfer();

    data.setData('text/plain', pasted);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, formula);
  // The paste is a single edit: the whole formula lands, lines included.
  await expect(formulaInput(page)).toHaveAttribute('data-value', /\n/);
});

Then('the formula input scrolls inside its own box', async ({ page }) => {
  await expect
    .poll(() =>
      formulaInput(page).evaluate((element) => {
        const { overflowY } = getComputedStyle(element);

        return ['auto', 'scroll'].includes(overflowY) && element.scrollHeight > element.clientHeight + 1;
      })
    )
    .toBe(true);
});

Then('the formula input is no taller than {int}% of the window', async ({ page }, percent: number) => {
  const { height, limit } = await formulaInput(page).evaluate((element, share) => {
    return { height: element.getBoundingClientRect().height, limit: (window.innerHeight * share) / 100 };
  }, percent);

  expect(height).toBeLessThanOrEqual(limit + 1);
});

Then('the end of the formula is scrolled into view', async ({ page }) => {
  await expect
    .poll(() =>
      formulaInput(page).evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
    )
    .toBeLessThanOrEqual(2);
});

Then('the formula preview and the function list are visible without scrolling the dialog', async ({ page }) => {
  const body = dialogBody(page);

  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  const bounds = await body.evaluate((element) => {
    const visible = element.getBoundingClientRect();
    const rect = (testId: string) => element.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect() ?? null;

    return {
      bottom: Math.min(visible.bottom, window.innerHeight),
      preview: rect('formula-editor-preview'),
      catalogue: rect('formula-catalogue'),
    };
  });

  expect(bounds.preview, 'preview').not.toBeNull();
  expect(bounds.catalogue, 'function list').not.toBeNull();
  // The whole preview row and the start of the function list are on screen.
  expect(bounds.preview!.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  expect(bounds.catalogue!.top + 48).toBeLessThanOrEqual(bounds.bottom);
});
