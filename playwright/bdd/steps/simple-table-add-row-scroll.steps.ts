import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();
const beforeAdding = new WeakMap<Page, {
  scrollTop: number;
  rowCount: number;
  columnCount: number;
  bottom: number;
  scrollLeft: number;
  columnWidths: number[];
}>();

function table(page: Page) {
  return page.locator('.simple-table').first();
}

async function scrollPosition(page: Page) {
  return table(page).evaluate((element) => {
    const scroller = element.closest('.appflowy-scroll-container');

    if (!scroller) throw new Error('The table has no page scroll container');
    return scroller.scrollTop;
  });
}

async function placeTableAboveViewportBottom(page: Page, space: number) {
  await table(page).evaluate((element, space) => {
    const scroller = element.closest('.appflowy-scroll-container');

    if (!scroller) throw new Error('The table has no page scroll container');
    const bottom = Math.min(scroller.getBoundingClientRect().bottom, window.innerHeight);

    scroller.scrollTop += element.querySelector('table')!.getBoundingClientRect().bottom - (bottom - space);
  }, space);
  await expect.poll(() => table(page).evaluate((element) => {
    const scroller = element.closest('.appflowy-scroll-container')!;
    const bottom = Math.min(scroller.getBoundingClientRect().bottom, window.innerHeight);

    return bottom - element.querySelector('table')!.getBoundingClientRect().bottom;
  })).toBeCloseTo(space, 0);
}

async function clickAddButton(page: Page, selector: string) {
  const button = table(page).locator(selector);

  // Keep Playwright from scrolling the page to reach an offscreen control.
  await expect(button).toBeInViewport({ ratio: 1 });
  await button.hover();
  await expect(button).toHaveCSS('opacity', '1');
  const snapshot = await table(page).evaluate((element) => {
    const scroller = element.closest('.appflowy-scroll-container')!;
    const columns = Array.from(element.querySelectorAll('tr:first-child > td'));

    return {
      scrollTop: scroller.scrollTop,
      rowCount: element.querySelectorAll('tr').length,
      columnCount: columns.length,
      bottom: Math.min(scroller.getBoundingClientRect().bottom, window.innerHeight),
      scrollLeft: element.querySelector('.simple-table-scroll-container')!.scrollLeft,
      columnWidths: columns.map((column) => column.getBoundingClientRect().width),
    };
  });

  beforeAdding.set(page, snapshot);
  await button.click();
}

When('I add {int} paragraphs before inserting the simple table', async ({ page }, count: number) => {
  for (let index = 0; index < count; index++) {
    await page.keyboard.insertText(`Paragraph ${index + 1}`);
    await page.keyboard.press('Enter');
  }
});

When('I select the first paragraph above the simple table', async ({ page }) => {
  await page.locator('[data-block-type="paragraph"]').first().click();
});

When('I place the simple table bottom {int} pixels above the page viewport bottom', async ({ page }, space: number) => {
  await placeTableAboveViewportBottom(page, space);
});

When('I leave room for one new simple table row and {int} extra pixels', async ({ page }, space: number) => {
  const row = await table(page).locator('tr').last().boundingBox();

  if (!row) throw new Error('The table row has no bounds');
  await placeTableAboveViewportBottom(page, row.height + space);
});

When('I scroll the wide simple table horizontally through its cells', async ({ page }) => {
  const scroller = table(page).locator('.simple-table-scroll-container');
  const box = await scroller.boundingBox();
  const distance = await scroller.evaluate((element) => (element.scrollWidth - element.clientWidth) / 2);

  if (!box) throw new Error('The table has no scrollable bounds');
  expect(distance).toBeGreaterThan(12);
  // The column-menu grip overlays the top edge; scroll through the cells below it.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(distance, 0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(10);
});

When('I click the bottom simple table add-row button', async ({ page }) => {
  await clickAddButton(page, '.simple-table-add-row-btn');
});

When('I click the simple table add-row-and-column corner button', async ({ page }) => {
  await clickAddButton(page, '.simple-table-add-corner-btn');
});

Then('the simple table has one more row', async ({ page }) => {
  await expect(table(page).locator('tr')).toHaveCount(beforeAdding.get(page)!.rowCount + 1);
});

Then('the simple table has one more column in every row', async ({ page }) => {
  const snapshot = beforeAdding.get(page)!;

  await expect.poll(() => table(page).locator('tr').evaluateAll((rows) => rows.map((row) => row.querySelectorAll('td').length)))
    .toEqual(Array.from({ length: snapshot.rowCount + 1 }, () => snapshot.columnCount + 1));
});

Then('adding the row has preserved the horizontal position and column widths', async ({ page }) => {
  const snapshot = beforeAdding.get(page)!;
  const current = await table(page).evaluate((element) => ({
    scrollLeft: element.querySelector('.simple-table-scroll-container')!.scrollLeft,
    columnWidths: Array.from(element.querySelectorAll('tr:first-child > td')).map((column) => column.getBoundingClientRect().width),
  }));

  expect(snapshot.scrollLeft).toBeGreaterThan(10);
  expect(Math.abs(current.scrollLeft - snapshot.scrollLeft)).toBeLessThan(1);
  expect(current.columnWidths).toEqual(snapshot.columnWidths);
});

Then('adding the row has not scrolled the page', async ({ page }) => {
  // Selection syncing runs after the click; watch for a delayed jump as well.
  const positions = await table(page).evaluate(async (element) => {
    const scroller = element.closest('.appflowy-scroll-container')!;
    const positions = [scroller.scrollTop];
    const start = performance.now();

    while (performance.now() - start < 500) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      positions.push(scroller.scrollTop);
    }

    return positions;
  });
  const initial = beforeAdding.get(page)!.scrollTop;

  expect(Math.max(...positions.map((position) => Math.abs(position - initial)))).toBeLessThan(1);
});

Then('adding the row has scrolled only enough to reveal it', async ({ page }) => {
  const initial = beforeAdding.get(page)!;

  await expect.poll(async () => (await scrollPosition(page)) - initial.scrollTop).toBeGreaterThan(0);
  const row = await table(page).locator('tr').last().boundingBox();
  const delta = (await scrollPosition(page)) - initial.scrollTop;

  if (!row) throw new Error('The new row has no bounds');
  expect(row.y + row.height).toBeCloseTo(initial.bottom, 0);
  expect(delta).toBeLessThan(row.height + 1);
});

Then('the new simple table row is fully visible', async ({ page }) => {
  const visible = await table(page).locator('tr').last().evaluate((row) => {
    const scroller = row.closest('.appflowy-scroll-container')!;
    const bounds = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();

    return rect.top >= Math.max(bounds.top, 0) && rect.bottom <= Math.min(bounds.bottom, window.innerHeight) + 1;
  });

  expect(visible).toBe(true);
});
