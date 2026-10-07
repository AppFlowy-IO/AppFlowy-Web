import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();

function table(page: Page) {
  return page.locator('.simple-table').first();
}

function selection(page: Page, axis: string) {
  if (!['row', 'column', 'block'].includes(axis)) throw new Error(`Unknown table selection: ${axis}`);
  return table(page).locator(axis === 'block' ? '.simple-table-block-selection' : `.simple-table-menu-selection.${axis}`);
}

interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function countBluePixels(page: Page, regions: PixelRegion[]) {
  const screenshot = await page.screenshot();

  // Inspect the browser's rendered pixels, so an unclipped overflow rectangle
  // fails even when its DOM coordinates still match the selected cells.
  return page.evaluate(async ({ base64, regions }) => {
    const image = new Image();

    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');

    if (!context) throw new Error('The screenshot canvas has no context');
    context.drawImage(image, 0, 0);
    const scale = image.naturalWidth / window.innerWidth;

    return regions.map((region) => {
      const x = Math.max(0, Math.floor(region.x * scale));
      const y = Math.max(0, Math.floor(region.y * scale));
      const right = Math.min(canvas.width, Math.ceil((region.x + region.width) * scale));
      const bottom = Math.min(canvas.height, Math.ceil((region.y + region.height) * scale));

      if (right <= x || bottom <= y) return 0;
      const pixels = context.getImageData(x, y, right - x, bottom - y).data;
      let count = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 40 && pixels[i + 1] > 150 && pixels[i + 1] < 220 && pixels[i + 2] > 220) count++;
      }

      return count;
    });
  }, { base64: screenshot.toString('base64'), regions });
}

When('I make the simple table wider than its block', async ({ page }) => {
  const viewport = await table(page).locator('.simple-table-scroll-container').boundingBox();
  const windowWidth = page.viewportSize()?.width;

  if (!viewport || !windowWidth) throw new Error('The table has no visible viewport');
  // Keep the resize drag inside the browser while leaving a real overflow.
  const extraWidth = Math.min(viewport.width * 0.3, windowWidth - viewport.x - viewport.width - 24);

  expect(extraWidth).toBeGreaterThan(24);
  const firstWidth = Math.floor(viewport.width * 0.45);
  const widths = [firstWidth, Math.ceil(viewport.width + extraWidth) - firstWidth];

  for (const [index, width] of widths.entries()) {
    const cell = table(page).locator('tr:last-child > td').nth(index);
    const handle = cell.locator('.simple-table-col-resize-handle');
    const handleBox = await handle.boundingBox();
    const cellBox = await cell.boundingBox();

    if (!handleBox || !cellBox) throw new Error('The column has no resize handle');
    const x = handleBox.x + 1;
    const y = handleBox.y + handleBox.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(handle).toHaveClass(/\bdragging\b/);
    await page.mouse.move(x + width - cellBox.width, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await cell.boundingBox())?.width ?? 0).toBeCloseTo(width, 0);
  }

  await expect.poll(() => table(page).locator('.simple-table-scroll-container').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(24);
});

When('I open the simple table {string} selection menu', async ({ page }, axis: string) => {
  const target = table(page).locator('tr:first-child > td').nth(axis === 'column' ? 1 : 0);

  await target.hover();
  if (axis === 'block') {
    const controls = page.getByTestId('hover-controls');

    await expect(controls).toHaveCSS('opacity', '1');
    await controls.getByTestId('drag-block').click();
    await expect(page.getByTestId('controls-menu')).toBeVisible();
    await expect(page.getByTestId('controls-menu').locator('..')).toHaveCSS('opacity', '1');
  } else {
    const trigger = table(page).locator(axis === 'row'
      ? '.simple-table-row-trigger-container .simple-table-action-btn'
      : '.simple-table-col-trigger-container .simple-table-action-btn');

    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('.simple-table-context-menu:visible')).toHaveCSS('opacity', '1');
  }

  await expect(selection(page, axis)).toBeVisible();
});

When('I scroll the simple table with a horizontal wheel gesture', async ({ page }) => {
  const scroller = table(page).locator('.simple-table-scroll-container');
  const box = await scroller.boundingBox();
  const distance = await scroller.evaluate((element) => (element.scrollWidth - element.clientWidth) / 2);

  if (!box) throw new Error('The table has no scrollable bounds');
  await page.mouse.move(box.x + box.width - 25, box.y + 8);
  await page.mouse.wheel(distance, 0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(10);
});

When('I scroll the simple table to the right end with the wheel', async ({ page }) => {
  const scroller = table(page).locator('.simple-table-scroll-container');

  await page.mouse.wheel(await scroller.evaluate((element) => element.scrollWidth), 0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft)).toBeLessThan(1);
});

Then('the simple table {string} selection follows the scrolled cells', async ({ page }, axis: string) => {
  const target = axis === 'column' ? table(page).locator('tr:first-child > td').nth(1)
    : axis === 'row' ? table(page).locator('tr').first() : table(page).locator('table');

  await expect.poll(async () => {
    const actual = await selection(page, axis).boundingBox();
    const expected = await target.boundingBox();

    return actual && expected ? Math.abs(actual.x - expected.x) : Infinity;
  }).toBeLessThan(1);
});

Then('the simple table {string} selection stays within its horizontal viewport', async ({ page }, axis: string) => {
  const viewport = await table(page).locator('.simple-table-scroll-container').boundingBox();
  const box = await selection(page, axis).boundingBox();
  const windowWidth = page.viewportSize()?.width;

  if (!viewport || !box || !windowWidth) throw new Error('The selection has no bounds');
  if (axis !== 'block') {
    const trigger = table(page).locator(axis === 'row'
      ? '.simple-table-row-trigger-container .simple-table-action-btn.active'
      : '.simple-table-col-trigger-container .simple-table-action-btn.active');
    const button = await trigger.boundingBox();

    if (!button) throw new Error('The selected menu button has no visible bounds');
    const center = button.x + button.width / 2;

    expect(center).toBeGreaterThanOrEqual(viewport.x - 1);
    expect(center).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
  }

  const visibleLeft = Math.max(box.x, viewport.x);
  const visibleRight = Math.min(box.x + box.width, viewport.x + viewport.width);
  const [inside, leftOverflow, rightOverflow] = await countBluePixels(page, [
    { x: visibleLeft + 3, y: box.y, width: visibleRight - visibleLeft - 6, height: 3 },
    { x: viewport.x - 100, y: box.y, width: 97, height: 3 },
    { x: viewport.x + viewport.width + 3, y: box.y, width: windowWidth - viewport.x - viewport.width - 3, height: 3 },
  ]);

  expect(inside).toBeGreaterThan(10);
  expect(leftOverflow).toBe(0);
  expect(rightOverflow).toBe(0);
});

Then('the simple table {string} selection reveals its right border', async ({ page, $testInfo }, axis: string) => {
  const viewport = await table(page).locator('.simple-table-scroll-container').boundingBox();
  const box = await selection(page, axis).boundingBox();

  if (!viewport || !box) throw new Error('The selection has no bounds');
  expect(Math.abs(box.x + box.width - viewport.x - viewport.width)).toBeLessThan(1);
  const [rightBorder] = await countBluePixels(page, [{ x: viewport.x + viewport.width - 3, y: box.y + 4, width: 3, height: 4 }]);

  expect(rightBorder).toBeGreaterThan(0);
  await $testInfo.attach(`${axis}-selection-scrolled`, { body: await page.screenshot(), contentType: 'image/png' });
});
