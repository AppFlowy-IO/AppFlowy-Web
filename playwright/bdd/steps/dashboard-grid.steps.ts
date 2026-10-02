/**
 * Dashboard grid geometry (WP02): the wrap rule, the box model shared by View
 * and Edit mode, and the resize handles. The step wording is shared with the
 * desktop BDD (`dashboard_grid.feature`); the aliases at the end are its
 * phrases for steps the web suite words differently elsewhere.
 */
import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addDashboardView,
  DashboardSelectors,
  dragLocatorBy,
  enterEditMode,
  leaveEditMode,
  persistedRow,
  prepareDashboardFixture,
  readDashboardSetting,
  rowColumnPitch,
  rowLines,
  seedDashboardWidgets,
  setDashboardTrackWidth,
  splitList,
  widgetBoxes,
  widgetRectsRelativeToGrid,
  type WidgetBox,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

const WIDGET_TIMEOUT = { timeout: 30_000 };
/** Layout checks compare rendered boxes, which round to device pixels. */
const TOLERANCE = 1;
const FIXTURE_DATABASES = ['Projects', 'Tasks', 'Notes'];
const rememberedPositions = new WeakMap<Page, Record<string, WidgetBox>>();

async function rowId(page: Page, rowIndex: number) {
  return (await persistedRow(page, rowIndex)).id;
}

/** The left and right edges of a row's track (the row plus the 6px box bleed on both sides). */
async function trackEdges(page: Page, rowIndex: number) {
  const box = await DashboardSelectors.rowTrack(page, await rowId(page, rowIndex)).boundingBox();

  if (!box) throw new Error(`Dashboard row ${rowIndex} is not visible`);
  return { left: box.x, right: box.x + box.width };
}

/** The boxes of a row grouped into lines by their top edge. */
async function rowLineBoxes(page: Page, rowIndex: number) {
  const lines: WidgetBox[][] = [];

  for (const box of await widgetBoxes(page, await rowId(page, rowIndex))) {
    const line = lines[lines.length - 1];

    if (line && Math.abs(line[0].y - box.y) <= 2) line.push(box);
    else lines.push([box]);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Given / When
// ---------------------------------------------------------------------------

Given('a dashboard with rows of {string} widgets is open', async ({ page, request }, sizes: string) => {
  await prepareDashboardFixture(page, request);
  await addDashboardView(page, 'Projects');
  let index = 0;
  const layout = splitList(sizes).flatMap((size, rowIndex) =>
    Array.from({ length: Number(size) }, () => {
      index += 1;
      return { row: rowIndex + 1, label: `${FIXTURE_DATABASES[(index - 1) % FIXTURE_DATABASES.length]} Grid #${index}` };
    })
  );

  await seedDashboardWidgets(page, layout);
  await leaveEditMode(page);
  await expect(DashboardSelectors.widgets(page)).toHaveCount(layout.length, WIDGET_TIMEOUT);
  // Rows are measured: every row reports its wrap.
  await expect(DashboardSelectors.grid(page)).not.toHaveAttribute('data-track-width', '', WIDGET_TIMEOUT);
});

When('the dashboard rows are {int} pixels wide', async ({ page }, width: number) => {
  await setDashboardTrackWidth(page, width);
});

When('the user remembers the positions of the dashboard widgets', async ({ page }) => {
  rememberedPositions.set(page, await widgetRectsRelativeToGrid(page));
});

When(
  'the user starts dragging the height handle of dashboard row {int} by {int} pixels',
  async ({ page }, rowIndex: number, pixels: number) => {
    const handle = DashboardSelectors.heightHandle(page, await rowId(page, rowIndex));

    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();

    if (!box) throw new Error('The height handle is not visible');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x, from.y + (pixels * step) / 10);
  }
);

When('the user releases the height handle', async ({ page }) => {
  await page.mouse.up();
});

When('the user hovers the dashboard row {int}', async ({ page }, rowIndex: number) => {
  const widget = DashboardSelectors.row(page, await rowId(page, rowIndex))
    .getByTestId('dashboard-widget')
    .first();
  const box = await widget.boundingBox();

  if (!box) throw new Error('The first widget of the row is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
});

When(
  'the user hovers width handle {int} of the dashboard row {int}',
  async ({ page }, handle: number, rowIndex: number) => {
    await DashboardSelectors.widthHandle(page, await rowId(page, rowIndex), handle - 1).hover();
  }
);

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the dashboard row {int} is laid out in lines of {string}', async ({ page }, rowIndex: number, sizes: string) => {
  const expected = splitList(sizes).map(Number);

  await expect.poll(async () => rowLines(page, await rowId(page, rowIndex)), WIDGET_TIMEOUT).toEqual(expected);
  // The boxes have finished their reflow: every line spans the track, and the
  // boxes of a wrapped line share it equally.
  await expect
    .poll(async () => {
      const { left, right } = await trackEdges(page, rowIndex);
      const lines = await rowLineBoxes(page, rowIndex);
      const wrapped = lines.length > 1;

      return lines.every((line) => {
        const last = line[line.length - 1];
        const spans = Math.abs(line[0].x - left) <= TOLERANCE && Math.abs(last.x + last.width - right) <= TOLERANCE;
        const equal = !wrapped || line.every((box) => Math.abs(box.width - line[0].width) <= TOLERANCE);

        return spans && equal;
      });
    }, WIDGET_TIMEOUT)
    .toBe(true);
});

Then(
  'every line of the dashboard row {int} is {int} pixels tall with {int} pixels between lines',
  async ({ page }, rowIndex: number, height: number, gap: number) => {
    const lines = await rowLineBoxes(page, rowIndex);

    for (const line of lines) {
      for (const box of line) expect(Math.abs(box.height - height)).toBeLessThanOrEqual(TOLERANCE);
    }

    for (let index = 1; index < lines.length; index += 1) {
      const above = lines[index - 1][0];

      expect(Math.abs(lines[index][0].y - (above.y + above.height) - gap)).toBeLessThanOrEqual(TOLERANCE);
    }
  }
);

Then('the last widget of the dashboard row {int} spans the full row width', async ({ page }, rowIndex: number) => {
  const { left, right } = await trackEdges(page, rowIndex);
  const boxes = await widgetBoxes(page, await rowId(page, rowIndex));
  const last = boxes[boxes.length - 1];

  expect(Math.abs(last.x - left)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(last.width - (right - left))).toBeLessThanOrEqual(TOLERANCE);
});

Then('the dashboard row {int} has no width handles', async ({ page }, rowIndex: number) => {
  await expect(
    DashboardSelectors.row(page, await rowId(page, rowIndex)).getByTestId('dashboard-width-handle')
  ).toHaveCount(0);
});

Then(
  'the widgets of the dashboard row {int} are {int} and {int} pixels wide',
  async ({ page }, rowIndex: number, first: number, second: number) => {
    await expect
      .poll(async () => {
        const boxes = await widgetBoxes(page, await rowId(page, rowIndex));

        return (
          boxes.length === 2 &&
          Math.abs(boxes[0].width - first) <= TOLERANCE &&
          Math.abs(boxes[1].width - second) <= TOLERANCE
        );
      }, WIDGET_TIMEOUT)
      .toBe(true);
  }
);

Then(
  'every widget of the dashboard row {int} is at least {int} pixels wide',
  async ({ page }, rowIndex: number, width: number) => {
    await expect
      .poll(async () => (await widgetBoxes(page, await rowId(page, rowIndex))).every((box) => box.width >= width - 0.5))
      .toBe(true);
  }
);

Then('every dashboard widget is where it was', async ({ page }) => {
  const before = rememberedPositions.get(page);

  expect(before, 'Remember the widget positions first').toBeDefined();
  await expect
    .poll(async () => {
      const after = await widgetRectsRelativeToGrid(page);

      return Object.entries(before ?? {}).every(([id, rect]) => {
        const now = after[id];

        return (
          Boolean(now) &&
          Math.abs(now.x - rect.x) <= TOLERANCE &&
          Math.abs(now.y - rect.y) <= TOLERANCE &&
          Math.abs(now.width - rect.width) <= TOLERANCE &&
          Math.abs(now.height - rect.height) <= TOLERANCE
        );
      });
    })
    .toBe(true);
});

Then('the dashboard rows are {int} pixels apart', async ({ page }, gap: number) => {
  const blocks = await DashboardSelectors.rows(page).evaluateAll((rows) =>
    rows.map((row) => {
      const rect = row.getBoundingClientRect();

      return { top: rect.top, bottom: rect.bottom };
    })
  );

  expect(blocks.length).toBeGreaterThan(1);
  for (let index = 1; index < blocks.length; index += 1) {
    expect(Math.abs(blocks[index].top - blocks[index - 1].bottom - gap)).toBeLessThanOrEqual(TOLERANCE);
  }
});

Then('the cards of the dashboard row {int} are {int} pixels apart', async ({ page }, rowIndex: number, gap: number) => {
  const cards = await DashboardSelectors.row(page, await rowId(page, rowIndex))
    .getByTestId('dashboard-widget-body')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return { left: rect.left, right: rect.right };
      })
    );

  expect(cards.length).toBeGreaterThan(1);
  for (let index = 1; index < cards.length; index += 1) {
    expect(Math.abs(cards[index].left - cards[index - 1].right - gap)).toBeLessThanOrEqual(TOLERANCE);
  }
});

Then('the dashboard row {int} previews a height of {int} pixels', async ({ page }, rowIndex: number, height: number) => {
  const widget = DashboardSelectors.row(page, await rowId(page, rowIndex))
    .getByTestId('dashboard-widget')
    .first();

  await expect
    .poll(async () => Math.abs(((await widget.boundingBox())?.height ?? 0) - height))
    .toBeLessThanOrEqual(TOLERANCE);
});

Then('the dashboard shows no row height badge', async ({ page }) => {
  await expect(DashboardSelectors.view(page).getByText(/^\d+\s?px$/)).toHaveCount(0);
});

Then('width handle {int} of the dashboard row {int} is hidden', async ({ page }, handle: number, rowIndex: number) => {
  const pill = DashboardSelectors.resizePill(page, await rowId(page, rowIndex), handle - 1);

  await expect(pill).toHaveAttribute('data-state', 'idle');
  await expect.poll(() => pill.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
});

Then(
  'width handle {int} of the dashboard row {int} shows a faint pill',
  async ({ page }, handle: number, rowIndex: number) => {
    const pill = DashboardSelectors.resizePill(page, await rowId(page, rowIndex), handle - 1);

    await expect(pill).toHaveAttribute('data-state', 'hover');
    await expect
      .poll(() =>
        pill.evaluate((element) => {
          const style = getComputedStyle(element);
          const probe = document.createElement('div');

          probe.style.backgroundColor = 'var(--border-primary)';
          document.body.appendChild(probe);
          const borderPrimary = getComputedStyle(probe).backgroundColor;

          probe.remove();
          return style.opacity === '1' && style.width === '2px' && style.backgroundColor === borderPrimary;
        })
      )
      .toBe(true);
  }
);

Then(
  'the row controls of the dashboard row {int} sit {int} pixels outside the row, centred on it',
  async ({ page }, rowIndex: number, offset: number) => {
    const id = await rowId(page, rowIndex);
    const row = await DashboardSelectors.row(page, id).boundingBox();
    const start = await DashboardSelectors.rowControlAnchor(page, id, 'start').boundingBox();
    const end = await DashboardSelectors.rowControlAnchor(page, id, 'end').boundingBox();

    if (!row || !start || !end) throw new Error('The row or its controls are not rendered');
    const centerY = row.y + row.height / 2;

    expect(Math.abs(start.x + start.width / 2 - (row.x - offset))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(end.x + end.width / 2 - (row.x + row.width + offset))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(start.y + start.height / 2 - centerY)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(end.y + end.height / 2 - centerY)).toBeLessThanOrEqual(TOLERANCE);
  }
);

// ---------------------------------------------------------------------------
// Aliases of the desktop phrases
// ---------------------------------------------------------------------------

When('the user enters dashboard edit mode', async ({ page }) => {
  await enterEditMode(page);
});

When('the user leaves dashboard edit mode', async ({ page }) => {
  await leaveEditMode(page);
});

When(
  'the user drags dashboard width handle {int} of row {int} by {int} columns',
  async ({ page }, handle: number, rowIndex: number, columns: number) => {
    const row = await persistedRow(page, rowIndex);
    const pitch = await rowColumnPitch(page, row.id, row.widgets.length);
    const before = (await readDashboardSetting(page)).rows[rowIndex - 1]?.widgets.map((widget) => widget.width);

    await dragLocatorBy(page, DashboardSelectors.widthHandle(page, row.id, handle - 1), columns * pitch, 0);
    // One write on release.
    await expect
      .poll(async () => (await readDashboardSetting(page)).rows[rowIndex - 1]?.widgets.map((widget) => widget.width))
      .not.toEqual(before);
  }
);

Then('the dashboard row {int} has widths {string}', async ({ page }, rowIndex: number, widths: string) => {
  await expect
    .poll(async () => (await readDashboardSetting(page)).rows[rowIndex - 1]?.widgets.map((widget) => widget.width))
    .toEqual(splitList(widths).map(Number));
});

When(
  'the user drags the height handle of dashboard row {int} by {int} pixels',
  async ({ page }, rowIndex: number, pixels: number) => {
    const row = await persistedRow(page, rowIndex);
    const handle = DashboardSelectors.heightHandle(page, row.id);

    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();

    if (!box) throw new Error('The height handle is not visible');
    // The pointer stays in the page: a long upward drag stops at its top, far
    // past the 240 px minimum either way.
    const travel = Math.max(pixels, 2 - (box.y + box.height / 2));

    await dragLocatorBy(page, handle, 0, travel);
  }
);

Then('the dashboard row {int} is {int} pixels tall', async ({ page }, rowIndex: number, height: number) => {
  await expect.poll(async () => (await readDashboardSetting(page)).rows[rowIndex - 1]?.height).toBe(height);
  const widget = DashboardSelectors.row(page, await rowId(page, rowIndex))
    .getByTestId('dashboard-widget')
    .first();

  await expect
    .poll(async () => Math.abs(((await widget.boundingBox())?.height ?? 0) - height))
    .toBeLessThanOrEqual(TOLERANCE);
});
