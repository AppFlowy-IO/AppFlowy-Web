/**
 * Steps of `dashboard-arrange.feature` (WP04), the same Gherkin as desktop's
 * `dashboard_arrange.feature`: bdd_widget_test brace syntax (`{1}`,
 * `{'8 4; 12'}`), matched here by escaped Cucumber expressions
 * (`\\{{int}\\}`, `\\{{string}\\}`; `{string}` accepts the single-quoted values).
 */
import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  ArrangeSelectors,
  dragWidgetTo,
  expectViewOpenOutsideDashboard,
  layoutSnapshot,
  moveWidgetDrag,
  releaseWidgetDrag,
  rowGapPoint,
  rowsOfCounts,
  rowsOfWidths,
  seedDashboardRows,
  splitBraced,
  startWidgetDrag,
  widgetAt,
  widgetIdAt,
  widgetSidePoint,
} from '../../support/dashboard-arrange-helpers';
import { expectNoLimitBanner, settle } from '../../support/dashboard-limits-helpers';
import { pressEscapeUntilHidden, WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  allWidgets,
  DASHBOARD_MAX_WIDGETS,
  DashboardSelectors,
  enterEditMode,
  expectRowWidths,
  expectWidgetCount,
  openWidgetMenu,
  openWidgetPicker,
  persistedRow,
  pickExistingView,
  prepareDashboardFixture,
  readDashboardSetting,
  renderedRows,
  viewIdForLabel,
  WidgetMenuAction,
  widgetLocator,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

/** The saved rows when the last drag started ("the dashboard layout is unchanged"). */
const layoutBeforeDrag = new WeakMap<Page, string>();

async function rowId(page: Page, row: number) {
  return (await persistedRow(page, row)).id;
}

async function seedAndEdit(page: Page, request: Parameters<typeof prepareDashboardFixture>[1], rows: number[][]) {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  await seedDashboardRows(
    page,
    rows.map((widths) => ({ widths }))
  );
  await enterEditMode(page);
}

/**
 * History hotkeys act on the database scope that last received a pointerdown.
 * Widgets mount nested databases with their own scope, so point at the
 * dashboard surface itself (the host database) before pressing the shortcut.
 */
async function pressHistoryShortcut(page: Page, action: 'undo' | 'redo') {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  await DashboardSelectors.view(page).dispatchEvent('pointerdown', { bubbles: true });
  await page.keyboard.press(action === 'undo' ? `${modifier}+z` : `${modifier}+Shift+z`);
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

Given(
  'a dashboard seeded with rows of \\{{string}\\} widgets is open in edit mode',
  async ({ page, request }, counts: string) => {
    await seedAndEdit(page, request, rowsOfCounts(counts));
  }
);

Given(
  'a dashboard seeded with row widths \\{{string}\\} is open in edit mode',
  async ({ page, request }, widths: string) => {
    await seedAndEdit(page, request, rowsOfWidths(widths));
  }
);

// ---------------------------------------------------------------------------
// Rows and row controls
// ---------------------------------------------------------------------------

When('the user hovers dashboard row \\{{int}\\}', async ({ page }, row: number) => {
  await DashboardSelectors.row(page, await rowId(page, row)).hover();
});

When('the user moves dashboard row \\{{int}\\} up', async ({ page }, row: number) => {
  const id = await rowId(page, row);

  await DashboardSelectors.row(page, id).hover();
  await ArrangeSelectors.rowMoveUp(page, id).click();
  await expect.poll(async () => (await readDashboardSetting(page)).rows[row - 2]?.id).toBe(id);
});

When('the user moves dashboard row \\{{int}\\} down', async ({ page }, row: number) => {
  const id = await rowId(page, row);

  await DashboardSelectors.row(page, id).hover();
  await ArrangeSelectors.rowMoveDown(page, id).click();
  await expect.poll(async () => (await readDashboardSetting(page)).rows[row]?.id).toBe(id);
});

When('the user focuses the move down button of dashboard row \\{{int}\\}', async ({ page }, row: number) => {
  const button = ArrangeSelectors.rowMoveDown(page, await rowId(page, row));

  await button.focus();
  await expect(button).toBeFocused();
});

When('the user presses the Enter key', async ({ page }) => {
  await page.keyboard.press('Enter');
});

Then('the move up button of dashboard row \\{{int}\\} has focus', async ({ page }, row: number) => {
  await expect(ArrangeSelectors.rowMoveUp(page, await rowId(page, row))).toBeFocused();
});

Then(
  'dashboard row \\{{int}\\} offers the row moves \\{{string}\\}',
  async ({ page }, row: number, moves: string) => {
    const id = await rowId(page, row);

    await expect(ArrangeSelectors.rowMoveControl(page, id)).toHaveCSS('opacity', '1');
    await expect
      .poll(async () =>
        (await ArrangeSelectors.rowMoves(page, id).evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('data-testid') ?? '')
        )).map((testId) => testId.replace('dashboard-row-move-', ''))
      )
      .toEqual(splitBraced(moves));
  }
);

Then('dashboard row \\{{int}\\} offers no row moves', async ({ page }, row: number) => {
  const id = await rowId(page, row);

  await expect(ArrangeSelectors.rowMoveControl(page, id)).toHaveCount(0);
  await expect(ArrangeSelectors.rowMoves(page, id)).toHaveCount(0);
});

Then('dashboard row \\{{int}\\} offers the add to row button', async ({ page }, row: number) => {
  const button = DashboardSelectors.addWidgetRowButton(page, await rowId(page, row));

  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

Then('dashboard row \\{{int}\\} offers no add to row button', async ({ page }, row: number) => {
  await expect(DashboardSelectors.addWidgetRowButton(page, await rowId(page, row))).toHaveCount(0);
});

Then('dashboard row \\{{int}\\} offers a disabled add to row button', async ({ page }, row: number) => {
  const button = DashboardSelectors.addWidgetRowButton(page, await rowId(page, row));

  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
});

Then('the row controls of dashboard row \\{{int}\\} are visible', async ({ page }, row: number) => {
  await expect(ArrangeSelectors.rowMoveControl(page, await rowId(page, row))).toHaveCSS('opacity', '1');
});

Then('the row controls of dashboard row \\{{int}\\} are hidden', async ({ page }, row: number) => {
  await expect(ArrangeSelectors.rowMoveControl(page, await rowId(page, row))).toHaveCSS('opacity', '0');
});

Then('the dashboard shows no row controls', async ({ page }) => {
  await expect(page.getByTestId('dashboard-row-move-control')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-add-widget-row-button')).toHaveCount(0);
});

Then('the add to new row button is visible', async ({ page }) => {
  const button = ArrangeSelectors.addToNewRow(page);

  await expect(button).toBeVisible();
  await expect(button).toHaveCSS('opacity', '1');
});

Then('the add to new row button is disabled', async ({ page }) => {
  await expect(ArrangeSelectors.addToNewRow(page)).toHaveAttribute('aria-disabled', 'true');
});

When('the user hovers the add to new row button', async ({ page }) => {
  await ArrangeSelectors.addToNewRow(page).hover();
});

When('the user clicks the add to new row button', async ({ page }) => {
  // `aria-disabled` keeps the pointer events: a refused press is announced, nothing opens.
  // Playwright treats an aria-disabled button as not enabled, so the press skips its actionability wait.
  await ArrangeSelectors.addToNewRow(page).click({ force: true });
});

Then('the dashboard full tooltip is shown', async ({ page }) => {
  const tooltip = ArrangeSelectors.fullTooltip(page);

  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Dashboard is full');
  await expect(tooltip).toContainText('Delete a view to add a new one');
});

// No picker opened, and no limit text shows outside the full tooltip and the live region.
Then('the dashboard shows no limit banner', async ({ page }) => {
  await expectNoLimitBanner(page);
});

When(
  'the user adds a widget to dashboard row \\{{int}\\} from the picker view \\{{string}\\}',
  async ({ page }, row: number, layout: string) => {
    const id = await rowId(page, row);
    const before = await layoutSnapshot(page);

    await DashboardSelectors.row(page, id).hover();
    await openWidgetPicker(page, DashboardSelectors.addWidgetRowButton(page, id));
    await pickExistingView(page, viewIdForLabel(page, `Projects ${layout}`));
    await expect.poll(() => layoutSnapshot(page)).not.toBe(before);
  }
);

// ---------------------------------------------------------------------------
// Rows, widths and counts
// ---------------------------------------------------------------------------

Then(
  'the dashboard row \\{{int}\\} has widget ids \\{{string}\\}',
  async ({ page }, row: number, ids: string) => {
    const expected = splitBraced(ids);

    await expect
      .poll(async () => (await readDashboardSetting(page)).rows[row - 1]?.widgets.map((widget) => widget.id), WIDGET_TIMEOUT)
      .toEqual(expected);
    await expect.poll(async () => (await renderedRows(page))[row - 1]).toEqual(expected);
  }
);

Then('the dashboard row \\{{int}\\} has widths \\{{string}\\}', async ({ page }, row: number, widths: string) => {
  await expectRowWidths(page, row, splitBraced(widths).map(Number));
});

Then('the dashboard has \\{{int}\\} rows', async ({ page }, count: number) => {
  await expect.poll(async () => (await readDashboardSetting(page)).rows.length).toBe(count);
  await expect(DashboardSelectors.rows(page)).toHaveCount(count);
});

Then('the dashboard has \\{{int}\\} widgets', async ({ page }, count: number) => {
  expect(count).toBeLessThanOrEqual(DASHBOARD_MAX_WIDGETS);
  await expectWidgetCount(page, count);
  expect(allWidgets(await readDashboardSetting(page))).toHaveLength(count);
});

When('the user presses undo on the dashboard', async ({ page }) => {
  await pressHistoryShortcut(page, 'undo');
});

When('the user presses redo on the dashboard', async ({ page }) => {
  await pressHistoryShortcut(page, 'redo');
});

// "the user leaves dashboard edit mode" is the shared step of `dashboard-grid.steps.ts`.

// ---------------------------------------------------------------------------
// Widget menu
// ---------------------------------------------------------------------------

When('the user opens the menu of dashboard widget \\{{int}\\}', async ({ page }, n: number) => {
  await openWidgetMenu(page, await widgetAt(page, n));
});

When('the user chooses \\{{string}\\} in the dashboard widget menu', async ({ page }, id: string) => {
  const action = id as WidgetMenuAction;
  const before = await layoutSnapshot(page);

  if (action === 'create-row-above' || action === 'create-row-below') {
    await DashboardSelectors.widgetMenuItem(page, 'move-to-row').hover();
    await expect(ArrangeSelectors.moveToRowContent(page)).toBeVisible();
  }

  await DashboardSelectors.widgetMenuItem(page, action).click();
  if (action !== 'view-data-source' && action !== 'edit-view') {
    await expect.poll(() => layoutSnapshot(page)).not.toBe(before);
  }
});

Then('the dashboard widget menu offers only \\{{string}\\}', async ({ page }, ids: string) => {
  const menu = DashboardSelectors.widgetMenu(page);

  await expect(menu).toBeVisible();
  await expect
    .poll(async () =>
      (await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid') ?? ''))).map(
        (testId) => testId.replace('dashboard-widget-menu-', '')
      )
    )
    .toEqual(splitBraced(ids));
});

When('the user opens the move to row submenu', async ({ page }) => {
  await DashboardSelectors.widgetMenuItem(page, 'move-to-row').hover();
  await expect(ArrangeSelectors.moveToRowContent(page)).toBeVisible();
});

Then('the move to row options \\{{string}\\} are disabled', async ({ page }, ids: string) => {
  for (const id of splitBraced(ids)) {
    const item = ArrangeSelectors.moveToRowContent(page).getByTestId(`dashboard-widget-menu-${id}`);

    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('data-disabled', '');
  }
});

Then('the dashboard widget menu item \\{{string}\\} is disabled', async ({ page }, id: string) => {
  await expect(DashboardSelectors.widgetMenuItem(page, id as WidgetMenuAction)).toHaveAttribute('aria-disabled', 'true');
});

When('the user hovers the dashboard widget menu item \\{{string}\\}', async ({ page }, id: string) => {
  await DashboardSelectors.widgetMenuItem(page, id as WidgetMenuAction).hover();
});

When('the user dismisses the dashboard widget menu', async ({ page }) => {
  await pressEscapeUntilHidden(page, DashboardSelectors.widgetMenu(page));
  await expect(DashboardSelectors.widgetMenu(page)).toHaveCount(0);
});

Then(
  'the view \\{{string}\\} of the database \\{{string}\\} is open outside the dashboard',
  async ({ page }, layout: string, database: string) => {
    await expectViewOpenOutsideDashboard(page, database, `${database} ${layout}`);
  }
);

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

When(
  'the user drags dashboard widget \\{{int}\\} onto the right side of dashboard widget \\{{int}\\}',
  async ({ page }, source: number, target: number) => {
    const targetWidget = await widgetAt(page, target);

    layoutBeforeDrag.set(page, await layoutSnapshot(page));
    await dragWidgetTo(page, await widgetAt(page, source), () => widgetSidePoint(targetWidget, 'right'));
  }
);

When(
  'the user drags dashboard widget \\{{int}\\} onto the left side of dashboard widget \\{{int}\\}',
  async ({ page }, source: number, target: number) => {
    const targetWidget = await widgetAt(page, target);

    layoutBeforeDrag.set(page, await layoutSnapshot(page));
    await dragWidgetTo(page, await widgetAt(page, source), () => widgetSidePoint(targetWidget, 'left'));
  }
);

When(
  'the user drags dashboard widget \\{{int}\\} into dashboard row gap \\{{int}\\}',
  async ({ page }, source: number, gap: number) => {
    layoutBeforeDrag.set(page, await layoutSnapshot(page));
    await dragWidgetTo(page, await widgetAt(page, source), () => rowGapPoint(page, gap));
  }
);

When(
  'the user starts dragging dashboard widget \\{{int}\\} over the right side of dashboard widget \\{{int}\\}',
  async ({ page }, source: number, target: number) => {
    const targetWidget = await widgetAt(page, target);

    layoutBeforeDrag.set(page, await layoutSnapshot(page));
    await startWidgetDrag(page, await widgetAt(page, source));
    await moveWidgetDrag(page, await widgetSidePoint(targetWidget, 'right'));
  }
);

When(
  'the user starts dragging dashboard widget \\{{int}\\} over the left side of dashboard widget \\{{int}\\}',
  async ({ page }, source: number, target: number) => {
    const targetWidget = await widgetAt(page, target);

    layoutBeforeDrag.set(page, await layoutSnapshot(page));
    await startWidgetDrag(page, await widgetAt(page, source));
    await moveWidgetDrag(page, await widgetSidePoint(targetWidget, 'left'));
  }
);

When('the user moves the dragged widget into dashboard row gap \\{{int}\\}', async ({ page }, gap: number) => {
  await moveWidgetDrag(page, await rowGapPoint(page, gap));
});

When('the user drops the dragged widget', async ({ page }) => {
  await releaseWidgetDrag(page);
});

Then('the dashboard layout is unchanged', async ({ page }) => {
  const before = layoutBeforeDrag.get(page);

  expect(before, 'no drag step took a layout snapshot').toBeDefined();
  // Give a write the time to land, then compare ids, heights and widths.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250))));
  expect(await layoutSnapshot(page)).toBe(before);
});

Then('the dashboard shows the drag ghost of dashboard widget \\{{int}\\}', async ({ page }, n: number) => {
  const ghost = ArrangeSelectors.dragGhost(page);

  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-widget-id', await widgetIdAt(page, n));
  await expect(ghost).toHaveCSS('opacity', '0.5');
});

Then('dashboard widget \\{{int}\\} is faded', async ({ page }, n: number) => {
  const widget = await widgetAt(page, n);

  await expect(widget).toHaveAttribute('data-dragging', 'true');
  await expect(widget).toHaveCSS('opacity', '0.4');
});

Then('the dashboard shows a vertical drop indicator in dashboard row \\{{int}\\}', async ({ page }, row: number) => {
  const id = await rowId(page, row);
  const line = ArrangeSelectors.dropIndicator(page, 'vertical');

  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-row-id', id);
  await expect(line).toBeVisible();
});

Then(
  'the dashboard shows a horizontal drop indicator in dashboard row gap \\{{int}\\}',
  async ({ page }, gap: number) => {
    const line = ArrangeSelectors.dropIndicator(page, 'horizontal');

    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute('data-row-index', String(gap));
    await expect(line).toBeVisible();
    await expect(ArrangeSelectors.dropIndicator(page, 'vertical')).toHaveCount(0);
  }
);

Then('the dashboard shows no drop indicator', async ({ page }) => {
  // The drag is live (its ghost shows) and has had the frames to draw a line over its target.
  await expect(ArrangeSelectors.dragGhost(page)).toBeVisible();
  await settle(page, 300);
  await expect(ArrangeSelectors.dropIndicator(page)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Settings › Source (WP03's Source row replaces the menu's "Change view")
// ---------------------------------------------------------------------------

When(
  'I change the {string} widget to the {string} view from its view settings',
  async ({ page }, label: string, nextLabel: string) => {
    const widget = widgetLocator(page, label);
    const before = await layoutSnapshot(page);
    const tool = widget.getByTestId('dashboard-widget-settings-button');

    await widget.hover();
    await expect(tool).toBeVisible(WIDGET_TIMEOUT);
    if ((await tool.getAttribute('data-state')) !== 'open') await tool.click();
    await expect(page.getByTestId('dashboard-widget-settings')).toBeVisible(WIDGET_TIMEOUT);
    await page.getByTestId('dashboard-widget-settings-source').click();
    await pickExistingView(page, viewIdForLabel(page, nextLabel));
    await expect.poll(() => layoutSnapshot(page)).not.toBe(before);
  }
);
