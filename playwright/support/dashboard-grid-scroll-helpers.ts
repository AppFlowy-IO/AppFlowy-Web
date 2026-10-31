import { expect, type Locator, type Page } from '@playwright/test';

/** Real wheel input must scroll one card without moving its column headings or its host. */
export async function expectDashboardGridScrollIsolation(page: Page, widget: Locator) {
  await widget.scrollIntoViewIfNeeded();
  const scroller = widget.locator('[data-parity-id="dash-widget-grid-scrollbar"]');
  const header = widget.locator('[data-parity-id="dash-widget-grid-header"]');
  const geometry = () =>
    scroller.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      const ancestors = [];

      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        ancestors.push({ top: parent.scrollTop, left: parent.scrollLeft });
      }

      return {
        top: element.scrollTop,
        left: element.scrollLeft,
        height: element.scrollHeight - element.clientHeight,
        width: element.scrollWidth - element.clientWidth,
        ancestors,
        visibleRows: Array.from(element.querySelectorAll('[data-parity-id="dash-widget-grid-row"]')).flatMap((row) => {
          const rect = row.getBoundingClientRect();

          return rect.bottom > viewport.top + 36 && rect.top < viewport.bottom ? [row.getAttribute('data-row-key')] : [];
        }),
      };
    });
  const expectAligned = async () => {
    await expect(header).toHaveCount(1);
    const delta = await widget.evaluate((element) => {
      const headings = element.querySelector('[data-parity-id="dash-widget-grid-header"]');
      const rows = Array.from(element.querySelectorAll('[data-parity-id="dash-widget-grid-row"]'));
      const cells = Array.from(headings?.querySelectorAll<HTMLElement>('.grid-row-cell[data-column-id]') ?? []);
      const deltas = cells.flatMap((heading) => {
        const column = heading.dataset.columnId;
        const expected = heading.getBoundingClientRect();

        return rows.flatMap((row) => {
          const cell = Array.from(row.querySelectorAll<HTMLElement>('.grid-row-cell')).find(
            (candidate) => candidate.dataset.columnId === column
          );

          if (!cell) throw new Error(`A mounted row has no cell for ${column}`);
          const actual = cell.getBoundingClientRect();

          return [Math.abs(expected.left - actual.left), Math.abs(expected.right - actual.right)];
        });
      });

      if (cells.length < 2 || rows.length === 0) throw new Error('The grid has no comparable columns and rows');

      return Math.max(...deltas);
    });

    expect(delta, 'each mounted row and its headings share the column edges').toBeLessThanOrEqual(0.5);
  };

  const before = await geometry();

  expect(before.height, 'the fixture has enough rows for a real vertical scroll').toBeGreaterThan(180);
  expect(before.width, 'the fixture has enough columns for a real horizontal scroll').toBeGreaterThan(160);
  await expectAligned();
  const headingTop = (await header.boundingBox())!.y;

  try {
    const box = await scroller.boundingBox();

    if (!box) throw new Error('The grid viewport is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 180);
    await expect.poll(async () => (await geometry()).top).toBeGreaterThan(before.top + 170);
    const vertical = await geometry();

    expect(vertical.visibleRows[0]).not.toBe(before.visibleRows[0]);
    expect(vertical.ancestors).toEqual(before.ancestors);
    await expectAligned();
    expect(Math.abs((await header.boundingBox())!.y - headingTop)).toBeLessThanOrEqual(0.5);

    // The header's full width may extend across its neighbours. Hit only its
    // intersection with this card's viewport, as a user would.
    await page.mouse.move(box.x + box.width / 2, headingTop + 18);
    await page.mouse.wheel(160, 0);
    await expect.poll(async () => (await geometry()).left).toBeGreaterThan(before.left + 150);
    const horizontal = await geometry();

    expect(horizontal.ancestors).toEqual(before.ancestors);
    expect(horizontal.top).toBe(vertical.top);
    await expectAligned();
    expect(Math.abs((await header.boundingBox())!.y - headingTop)).toBeLessThanOrEqual(0.5);
  } finally {
    // This is an isolated fixture, and the caller may continue checking it.
    await scroller.evaluate((element, original) => element.scrollTo(original.left, original.top), before);
  }
}
