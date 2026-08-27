import { expect, Locator, Page } from '@playwright/test';

import { PageSelectors } from './selectors';

/**
 * Geometry of the sidebar drop indicator relative to the row it is attached to.
 *
 * The indicator marks where a dragged page would land. For a `bottom` edge that
 * is *after the hovered page and everything nested under it*, so the line has to
 * clear the hovered page's expanded children — not sit between the page and its
 * first child.
 */
export interface DropIndicatorGeometry {
  edge: string | null;
  /** Bottom of the indicator itself. */
  indicatorBottom: number;
  /** Bottom of the hovered page's own name row. */
  rowBottom: number;
  /** Bottom of the hovered page's wrapper — its row plus any expanded children. */
  subtreeBottom: number;
  /** Bottom of the hovered page's last rendered descendant row, if it has any. */
  lastDescendantBottom: number | null;
}

function pageItemByName(page: Page, pageName: string): Locator {
  return PageSelectors.itemByName(page, pageName);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();

  if (!box) throw new Error('Could not measure sidebar element');
  return box;
}

/**
 * Presses the mouse on `sourceName` and holds it over `targetName`'s lower (or
 * upper) region **without releasing**, so the drop indicator can be inspected
 * mid-drag. Call {@link finishOutlineDrag} or {@link cancelOutlineDrag} after.
 *
 * pragmatic-drag-and-drop reacts to the native HTML5 drag events Chromium emits
 * once the pointer crosses the drag threshold, which is why this drives
 * `page.mouse` rather than dispatching synthetic events.
 */
export async function startOutlineDragOver(
  page: Page,
  sourceName: string,
  targetName: string,
  edge: 'top' | 'bottom'
): Promise<void> {
  const sourceRow = pageItemByName(page, sourceName).locator(':scope > [data-testid^="page-"]').first();
  const targetRow = pageItemByName(page, targetName).locator(':scope > [data-testid^="page-"]').first();

  await expect(sourceRow).toBeVisible({ timeout: 15000 });
  await expect(targetRow).toBeVisible({ timeout: 15000 });

  const sourceBox = await boxOf(sourceRow);
  const targetBox = await boxOf(targetRow);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    edge === 'top' ? targetBox.y + 1 : targetBox.y + targetBox.height - 1,
    { steps: 12 }
  );
  await page.waitForTimeout(400);

  await expect(page.getByTestId('drop-row-line')).toHaveCount(1, { timeout: 10000 });
}

/**
 * Holds `sourceName` over the center of `targetName`, the desktop-parity
 * gesture for making the source a child of the target document.
 */
export async function startOutlineDragInto(page: Page, sourceName: string, targetName: string): Promise<void> {
  const sourceRow = pageItemByName(page, sourceName).locator(':scope > [data-testid^="page-"]').first();
  const targetRow = pageItemByName(page, targetName).locator(':scope > [data-testid^="page-"]').first();

  await expect(sourceRow).toBeVisible({ timeout: 15000 });
  await expect(targetRow).toBeVisible({ timeout: 15000 });

  const sourceBox = await boxOf(sourceRow);
  const targetBox = await boxOf(targetRow);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.waitForTimeout(400);

  await expect(targetRow).toHaveAttribute('data-drop-instruction', 'make-child', { timeout: 10000 });
}

export async function finishOutlineDrag(page: Page): Promise<void> {
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

export async function cancelOutlineDrag(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/**
 * Measures the live drop indicator against the page it is attached to.
 *
 * Everything is read in one `evaluate` so the numbers describe a single frame —
 * separate `boundingBox()` calls could straddle a re-render mid-drag.
 */
export async function readDropIndicatorGeometry(page: Page): Promise<DropIndicatorGeometry> {
  return page.evaluate(() => {
    const indicator = document.querySelector('[data-testid="drop-row-line"]');

    if (!indicator) throw new Error('No drop indicator is rendered');

    const wrapper = indicator.closest('[data-testid="page-item"], [data-testid="space-item"]');

    if (!wrapper) throw new Error('Drop indicator is not attached to a sidebar item');

    const row = wrapper.querySelector(':scope > [data-testid^="page-"], :scope > [data-testid^="space-"]');
    // `querySelectorAll` matches descendants against the whole document, so a
    // plain '[data-testid="page-item"] > [data-testid^="page-"]' would match the
    // wrapper's own row back. Walk the nested items and take their own rows.
    const descendantBottoms = Array.from(wrapper.querySelectorAll('[data-testid="page-item"]'))
      .filter((item) => item !== wrapper)
      .map((item) => item.firstElementChild)
      .filter(
        (nested): nested is Element =>
          Boolean(nested?.getAttribute('data-testid')?.startsWith('page-')) &&
          (nested as HTMLElement).getBoundingClientRect().height > 0
      )
      .map((nested) => nested.getBoundingClientRect().bottom);

    return {
      edge: indicator.getAttribute('data-edge'),
      indicatorBottom: indicator.getBoundingClientRect().bottom,
      rowBottom: row ? row.getBoundingClientRect().bottom : wrapper.getBoundingClientRect().bottom,
      subtreeBottom: wrapper.getBoundingClientRect().bottom,
      lastDescendantBottom: descendantBottoms.length ? Math.max(...descendantBottoms) : null,
    };
  });
}

/** The name of the sidebar page the drop indicator is currently attached to. */
export async function readDropIndicatorTargetName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const indicator = document.querySelector('[data-testid="drop-row-line"]');
    const wrapper = indicator?.closest('[data-testid="page-item"], [data-testid="space-item"]');
    const name = wrapper?.querySelector(
      ':scope > [data-testid^="page-"] [data-testid="page-name"], :scope > [data-testid^="space-"] [data-testid="space-name"]'
    );

    return name?.textContent?.trim() ?? null;
  });
}

/** Sidebar page names in render order, for asserting the post-drop order. */
export async function readSidebarPageNames(page: Page, names: string[]): Promise<string[]> {
  return page.evaluate((tracked) => {
    return Array.from(document.querySelectorAll('[data-testid="page-item"] > div [data-testid="page-name"]'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((name) => tracked.includes(name));
  }, names);
}
