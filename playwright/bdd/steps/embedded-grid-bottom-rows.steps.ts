import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import type { DatabaseContextState } from '../../../src/application/database-yjs/context';
import { insertInlineGridViaSlash } from '../../support/duplicate-test-helpers';
import { getActiveRowIds, seedPrimaryTitlesDirect } from '../../support/gallery-test-helpers';
import { currentViewIdFromUrl } from '../../support/page-utils';
import { appendRowToCurrentDatabaseDirect, waitForDatabaseTestContext } from '../../support/relation-test-helpers';

const { Given, When, Then } = createBdd();
const stateByPage = new WeakMap<Page, { rowIds: string[]; expectedBottomRowId?: string }>();
const grid = (page: Page) => page.getByTestId('database-grid').first();
const scroller = (page: Page) => grid(page).locator(':scope > .appflowy-custom-scroller');

Given('an embedded grid with 27 wrapped rows is ready', async ({ page }) => {
  await insertInlineGridViaSlash(page, currentViewIdFromUrl(page));
  await waitForDatabaseTestContext(page);
  const initialRows = await getActiveRowIds(page);

  for (let index = initialRows.length; index < 27; index++) {
    await appendRowToCurrentDatabaseDirect(page, `Grid row ${index + 1}`);
  }

  const titles = Array.from({ length: 27 }, (_, index) =>
    index % 3 === 0
      ? `Grid row ${index + 1}: a longer description that wraps onto several lines`
      : `Grid row ${index + 1}`
  );
  const rowIds = await seedPrimaryTitlesDirect(page, titles);

  await page.evaluate(() => {
    const { __TEST_DATABASE_CONTEXT__: context } = window as unknown as {
      __TEST_DATABASE_CONTEXT__: DatabaseContextState;
    };
    const database = context.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(context.activeViewId);
    const primaryField = Array.from(database.get('fields').values()).find((field) => field.get('is_primary'));

    if (!primaryField) throw new Error('The grid needs a primary field');
    view.get('field_settings').get(primaryField.get('id'))?.set('wrap', true);
  });
  stateByPage.set(page, { rowIds });
  await expect.poll(() => getActiveRowIds(page)).toHaveLength(27);
});

When('I scroll to the bottom of the embedded grid and click {string}', async ({ page }, action: string) => {
  const state = stateByPage.get(page);

  if (!state) throw new Error('The embedded grid fixture is missing');
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => scroller(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await expect(grid(page).getByTestId('grid-load-more-row')).toContainText('(2)');

  if (action === 'Load more') {
    await grid(page).getByTestId('grid-load-more-row').click();
    await expect(grid(page).getByTestId('grid-load-more-row')).toHaveCount(0);
    state.expectedBottomRowId = state.rowIds[state.rowIds.length - 1];
  } else if (action === 'New row') {
    await grid(page).getByTestId('grid-new-row').click();
    await expect.poll(() => getActiveRowIds(page)).toHaveLength(28);
    state.expectedBottomRowId = (await getActiveRowIds(page)).find((id) => !state.rowIds.includes(id));
  } else {
    throw new Error(`Unsupported grid action: ${action}`);
  }
});

Then('the revealed bottom row and the embedded grid footer are reachable', async ({ page }) => {
  const expectedRowId = stateByPage.get(page)?.expectedBottomRowId;

  if (!expectedRowId) throw new Error('The action did not reveal a bottom row');
  // Scroll the actual viewport. scrollIntoView on a row would hide bugs by
  // moving ancestors, and cannot find a row excluded by the virtual range.
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(grid(page).locator(`[data-row-id="${expectedRowId}"]`).first()).toBeInViewport();
  await expect(grid(page).getByTestId('grid-new-row')).toBeInViewport();
});
