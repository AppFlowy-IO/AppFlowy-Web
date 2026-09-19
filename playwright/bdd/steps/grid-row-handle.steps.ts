import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { insertInlineGridViaSlash } from '../../support/duplicate-test-helpers';
import { getActiveRowIds, seedPrimaryTitlesDirect } from '../../support/gallery-test-helpers';
import { currentViewIdFromUrl } from '../../support/page-utils';
import { appendRowToCurrentDatabaseDirect, waitForDatabaseTestContext } from '../../support/relation-test-helpers';

const { Given, When, Then } = createBdd();
const stateByPage = new WeakMap<Page, { order: string[]; emptyRowId: string; namedRowId: string }>();
const row = (page: Page, id: string) => page.getByTestId('database-grid').locator(`[data-row-id="${id}"]`);

Given('a full-page grid with 33 rows is ready for handle dragging', async ({ page }) => {
  await insertInlineGridViaSlash(page, currentViewIdFromUrl(page));
  await waitForDatabaseTestContext(page);
  const initialRows = await getActiveRowIds(page);

  for (let index = initialRows.length; index < 33; index++) {
    await appendRowToCurrentDatabaseDirect(page, `Drag row ${index + 1}`);
  }

  const titles = Array.from({ length: 33 }, (_, index) => `Drag row ${index + 1}`);
  titles[2] = '';
  titles[3] = 'Striving to reform';
  const order = await seedPrimaryTitlesDirect(page, titles);
  await page.getByRole('button', { name: 'Open as a Page', exact: true }).click();
  await expect(page.locator('[data-slate-editor="true"]')).toHaveCount(0);
  await waitForDatabaseTestContext(page);
  await expect.poll(() => getActiveRowIds(page)).toEqual(order);
  stateByPage.set(page, { order, emptyRowId: order[2], namedRowId: order[3] });
});

When('I drag the {string} grid row above the first row using its handle', async ({ page }, kind: string) => {
  const state = stateByPage.get(page);
  if (!state) throw new Error('The drag fixture is missing');
  const sourceId = kind === 'empty' ? state.emptyRowId : state.namedRowId;
  const source = row(page, sourceId);
  const target = row(page, state.order[0]);
  await source.hover();
  const handle = source.getByTestId('row-accessory-button');
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('The drag handle and target must be visible');

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y - 8, { steps: 5 });
  // Two movements over the target allow native dragover in both browser engines.
  await page.mouse.move(end.x + 120, end.y + 3, { steps: 15 });
  await page.mouse.move(end.x + 120, end.y + 3);
  await page.mouse.up();
  state.order = [sourceId, ...state.order.filter((id) => id !== sourceId)];
});

Then('the grid row order changes without opening the row menu', async ({ page }) => {
  const state = stateByPage.get(page);
  if (!state) throw new Error('The drag fixture is missing');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => getActiveRowIds(page)).toEqual(state.order);
});

Then('the grid row menu still opens by click and keyboard', async ({ page }) => {
  const state = stateByPage.get(page);
  if (!state) throw new Error('The drag fixture is missing');
  const firstRow = row(page, state.order[0]);
  const handle = firstRow.getByTestId('row-accessory-button');
  await firstRow.hover();
  await handle.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menu')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  for (const key of ['Enter', 'Space', 'ArrowDown']) {
    await handle.focus();
    await page.keyboard.press(key);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expect.poll(() => getActiveRowIds(page)).toEqual(state.order);
});
