/* eslint-disable @typescript-eslint/no-explicit-any -- the app's load counters on window are untyped. */
/**
 * Conditions budgets of the 12-widget employees dashboard (PERFORMANCE-REPORT
 * 3.2 W4, W6, W12, W23 and themes 3, 6, 7 of 3.4): a plain grid, four filtered
 * or sorted grids, two boards, a bar, donut and line chart and two Number
 * charts over the employees database, with a Department (select) and a Name
 * (text) global filter.
 *
 * Counts, on any build (theme 6, one recompute per change): the result each
 * widget shows (a grid's row count and first rows, a board's column counts, a
 * chart's values, a Number chart's value) changes exactly once per global
 * filter change, or not at all when it is the same — a select option toggled
 * on, then off, and one character typed into the text filter, then removed.
 * Rendering stages of one result (cards mounting in their columns, a chart's
 * labels drawn after its entry animation) are not changes; an intermediate
 * result (a partial grid, emptied columns) is.
 *
 * Times, only in perf mode (`DASHBOARD_PERF=1`, a production build served by
 * `vite preview`, one worker, runs started at a load average under 8); each
 * is the median of three rounds:
 * - a select toggle changes every widget within 400 ms of the click, with no
 *   long task over 150 ms (W4);
 * - one typed character changes every widget within 900 ms of the key (300 ms
 *   of it is the input's debounce), and the key event takes at most 100 ms (W4);
 * - Edit and Done each paint within 200 ms (W12);
 * - after Enter in a grid cell, every widget that shows the row reflects the
 *   new value within 150 ms (W23);
 * - from the Grid tab back to the Dashboard tab, every visible widget shows
 *   data within 1,000 ms and all 12 within 1,500 ms (W6).
 *
 * The employees suite is opt-in (seeding takes minutes):
 *   RUN_LARGE_DATABASE=1 EMPLOYEES_ROW_LIMIT=2000 [LARGE_DATABASE_CACHE=<file>] \
 *     npx playwright test playwright/e2e/database/dashboard-perf-conditions.spec.ts --workers=1
 * A server that requires a Pro plan for Dashboard views also needs
 * APPFLOWY_TEST_POSTGRES_CONTAINER (see subscription-test-helpers.ts).
 */
import { APIRequestContext, expect, Locator, Page, test } from '@playwright/test';

import {
  adoptEmployeesWorkspace,
  createDashboardOverEmployeesViews,
  EMPLOYEES,
  ensureEmployeesViews,
  leaveAndReturnInApp,
  loadingScenario,
  loadingWidgets,
  LoadingWidget,
  loadStats,
  openDashboardUntilLoaded,
  readPageRecord,
  startLoadRecording,
  waitForWidgetData,
  widgetLocatorOf,
} from '../../support/dashboard-loading-helpers';
import { isDashboardPerfMode, nextFrames, paintLatency } from '../../support/dashboard-perf-probe';
import { ChangeMeasure, measureChange, settledTimeline } from '../../support/dashboard-performance-timeline';
import {
  DashboardSelectors,
  dashboardViewId,
  fixtureDatabase,
  globalFilterChip,
  readDashboardSetting,
  waitForDashboardSync,
  writeDashboardSetting,
} from '../../support/dashboard-test-helpers';
import {
  EMPLOYEE_FIELDS,
  openSeededEmployeesDatabase,
  rememberEmployeeCell,
  resetEmployeesDatabaseSettings,
  restoreEmployeeCells,
} from '../../support/employees-database';

/** Seeding the employees database takes minutes. */
const SCENARIO_TIMEOUT_MS = 45 * 60 * 1000;
const SELECT_FILTER = 'Department';
const TEXT_FILTER = 'Name';
/** `FieldType.SingleSelect` with `SelectOptionFilterCondition.OptionIs`; `FieldType.RichText` with `TextFilterCondition.TextContains`. */
const SINGLE_SELECT = 3;
const OPTION_IS = 0;
const RICH_TEXT = 0;
const TEXT_CONTAINS = 2;
/** The option toggled: no fixed view of the dashboard filters on it, so every widget's result changes. */
const TOGGLED_OPTION = 'mktg';
/** The character typed into the Name filter. */
const TYPED_CHARACTER = 'a';
/** The grid whose cell is edited, and the property edited: a sorted grid and the Sum chart read it. */
const EDITED_GRID = `${EMPLOYEES} Grid`;
const EDITED_FIELD = EMPLOYEE_FIELDS.Salary;
/** Rounds per measurement in perf mode: the budget applies to the median. */
const ROUNDS = 3;

/** PERFORMANCE-REPORT 4.3 B: targets after W4, W6, W12 and W23. */
const SELECT_TOGGLE_MS = 400;
const SELECT_TOGGLE_LONGEST_TASK_MS = 150;
const TYPED_CHARACTER_MS = 900;
const KEY_EVENT_MS = 100;
const EDIT_MODE_PAINT_MS = 200;
const CELL_EDIT_MS = 150;
const TAB_RETURN_VISIBLE_MS = 1_000;
const TAB_RETURN_ALL_MS = 1_500;

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.RUN_LARGE_DATABASE, 'the employees suite is opt-in (RUN_LARGE_DATABASE=1)');

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

/** The employees database, its 12 views and a new database with a dashboard showing them, open in View mode. */
async function prepareEmployeesDashboard(page: Page, request: APIRequestContext) {
  const seeded = await openSeededEmployeesDatabase(page, request);

  await resetEmployeesDatabaseSettings(page);
  await expect(page.getByTestId('database-grid')).toHaveAttribute('data-row-count', String(seeded.rowIds.length), {
    timeout: 120_000,
  });
  await adoptEmployeesWorkspace(page, request);
  await ensureEmployeesViews(page, request);
  await createDashboardOverEmployeesViews(page, request);
}

/** A Department (select) and a Name (text) global filter over the employees database, both empty. */
async function addGlobalFilters(page: Page, request: APIRequestContext) {
  const employees = fixtureDatabase(page, EMPLOYEES);
  const { global_filters: current } = await readDashboardSetting(page);
  const wanted = [
    {
      id: 'gf-perf-conditions-select',
      name: SELECT_FILTER,
      ty: SINGLE_SELECT,
      condition: OPTION_IS,
      content: '',
      targets: { [employees.databaseId]: EMPLOYEE_FIELDS.Department },
      target_order: [employees.databaseId],
    },
    {
      id: 'gf-perf-conditions-text',
      name: TEXT_FILTER,
      ty: RICH_TEXT,
      condition: TEXT_CONTAINS,
      content: '',
      targets: { [employees.databaseId]: EMPLOYEE_FIELDS.Name },
      target_order: [employees.databaseId],
    },
  ];
  const missing = wanted.filter((filter) => !current.some((existing) => existing.name === filter.name));

  if (missing.length > 0) {
    await writeDashboardSetting(page, { global_filters: [...current, ...missing] });
    await waitForDashboardSync(page, request);
  }

  await expect(globalFilterChip(page, SELECT_FILTER)).toBeVisible({ timeout: 60_000 });
  await expect(globalFilterChip(page, TEXT_FILTER)).toBeVisible({ timeout: 60_000 });
}

function widgetNamed(page: Page, label: string): LoadingWidget {
  const widget = loadingWidgets(page).find((candidate) => candidate.label === label);

  if (!widget) throw new Error(`The dashboard has no "${label}" widget`);
  return widget;
}

/** Escape until no popover, menu or editor is open, then two quiet frames. */
async function closeOverlays(page: Page) {
  const open = page.locator('[data-slot="popover-content"], [role="menu"], [role="dialog"]');

  for (let attempt = 0; attempt < 5 && (await open.count()) > 0; attempt += 1) await page.keyboard.press('Escape');
  await expect(open).toHaveCount(0);
  await nextFrames(page);
}

/** Opens the editor of a global filter pill and waits for its value control. */
async function openFilterEditor(page: Page, name: string, control: string) {
  await closeOverlays(page);
  await globalFilterChip(page, name).click();
  await expect(page.locator(control).first()).toBeVisible();
  // The editor's own entrance settles before anything is measured.
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// In-page timeline of widget content changes and input events
// ---------------------------------------------------------------------------

/** Each widget changed once when its result changed, and not at all when it did not. */
function expectOneChangePerWidget(measure: ChangeMeasure, what: string) {
  const expected = Object.fromEntries(
    Object.keys(measure.changes).map((label) => [label, measure.changed.includes(label) ? 1 : 0])
  );

  expect(measure.changes, `content changes per widget after ${what}`).toEqual(expected);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// The interactions
// ---------------------------------------------------------------------------

function optionRow(page: Page, optionId: string): Locator {
  return page.locator(`[data-testid="dashboard-global-filter-option"][data-option-id="${optionId}"]`);
}

/** Toggles the option with a pointer press on its row (the press is the measured input). */
async function toggleOption(page: Page, optionId: string) {
  const row = optionRow(page, optionId);
  const checked = await row.getAttribute('data-checked');

  await row.click();
  await expect(row).not.toHaveAttribute('data-checked', checked ?? 'false');
}

/** The first row of the grid widget, and the cell of `fieldId` in it. */
async function firstRowCell(page: Page, widget: LoadingWidget, fieldId: string) {
  const scope = widgetLocatorOf(page, widget);
  const row = scope.locator('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])').first();
  const rowId = ((await row.getAttribute('data-testid')) ?? '').slice('grid-row-'.length);

  return scope.getByTestId(`grid-cell-${rowId}-${fieldId}`);
}

/** Opens the cell's editor and types `value`, without committing it: the Enter is the measured input. */
async function typeIntoCell(page: Page, cell: Locator, value: string) {
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const input = cell.locator('textarea, input').first();

  await expect(input).toBeVisible();
  await input.fill(value);
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test.describe('Dashboard conditions performance (12 widgets over the employees database)', () => {
  test.afterEach(async ({ page }) => {
    await restoreEmployeeCells(page);
  });

  test('changes each widget once per condition change and stays within the conditions budgets', async ({
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(SCENARIO_TIMEOUT_MS);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepareEmployeesDashboard(page, request);
    await addGlobalFilters(page, request);
    await startLoadRecording(page);
    await openDashboardUntilLoaded(page);
    // The last rows and charts settle after their load completes.
    await page.waitForTimeout(2_000);
    const perf = isDashboardPerfMode();
    const rounds = perf ? ROUNDS : 1;
    const results: Record<string, unknown> = { perfMode: perf, baseUrl: process.env.BASE_URL ?? null };
    // Each section's numbers are logged as they are taken, so a later failure keeps them.
    const report = (name: string, value: unknown) => {
      results[name] = value;
      console.log(`[perf-conditions] ${name} ${JSON.stringify(value)}`);
    };

    // --- W4: a select option toggled on and off --------------------------------------------
    await openFilterEditor(page, SELECT_FILTER, '[data-testid="dashboard-global-filter-option"]');
    const selectOn: ChangeMeasure[] = [];
    const selectOff: ChangeMeasure[] = [];

    for (let round = 0; round < rounds; round += 1) {
      selectOn.push(await measureChange(page, 'pointerdown', () => toggleOption(page, TOGGLED_OPTION)));
      selectOff.push(await measureChange(page, 'pointerdown', () => toggleOption(page, TOGGLED_OPTION)));
    }

    report('selectOn', selectOn);
    report('selectOff', selectOff);
    await closeOverlays(page);

    // --- W4: one character typed into the text filter, then removed --------------------------
    await openFilterEditor(page, TEXT_FILTER, '[data-testid="dashboard-global-filter-content"]');
    const textInput = page.getByTestId('dashboard-global-filter-content');

    await expect(textInput).toBeFocused();
    const typed: ChangeMeasure[] = [];
    const removed: ChangeMeasure[] = [];

    for (let round = 0; round < rounds; round += 1) {
      typed.push(await measureChange(page, 'keydown', () => page.keyboard.press(TYPED_CHARACTER)));
      removed.push(await measureChange(page, 'keydown', () => page.keyboard.press('Backspace')));
    }

    report('typed', typed);
    report('removed', removed);
    await closeOverlays(page);

    // --- W12: Edit and Done ------------------------------------------------------------------
    const editPaints: number[] = [];
    const donePaints: number[] = [];

    for (let round = 0; round < rounds; round += 1) {
      editPaints.push(
        (
          await paintLatency(page, () => DashboardSelectors.editButton(page).click(), {
            appears: '[data-testid="dashboard-done-button"]',
          })
        ).toPaintMs
      );
      await page.waitForTimeout(800);
      donePaints.push(
        (
          await paintLatency(page, () => DashboardSelectors.doneButton(page).click(), {
            appears: '[data-testid="dashboard-edit-button"]',
          })
        ).toPaintMs
      );
      await page.waitForTimeout(800);
    }

    report('editPaintMs', editPaints);
    report('donePaintMs', donePaints);

    // --- W23: Enter in a cell ------------------------------------------------------------------
    const edited = widgetNamed(page, EDITED_GRID);
    const cellEdits: ChangeMeasure[] = [];
    const salaryCell = await firstRowCell(page, edited, EDITED_FIELD);
    const originalSalary = ((await salaryCell.textContent()) ?? '').replace(/[^0-9.-]/g, '');
    const editedRowId = (await salaryCell.getAttribute('data-testid'))!.slice(
      'grid-cell-'.length,
      -`-${EDITED_FIELD}`.length
    );

    await rememberEmployeeCell(page, fixtureDatabase(page, EMPLOYEES).databaseId, editedRowId, EDITED_FIELD);
    // The largest salary moves the row to the top of the sorted grid, and changes the Sum chart.
    for (let round = 0; round < rounds; round += 1) {
      const salary = String(9_000_000 + round);

      await typeIntoCell(page, salaryCell, salary);
      const measure = await measureChange(
        page,
        'keydown',
        () => page.keyboard.press('Enter'),
        { rowId: editedRowId, fieldId: EDITED_FIELD },
        async () => {
          await expect.poll(async () => ((await salaryCell.textContent()) ?? '').replace(/[^0-9.-]/g, '')).toBe(salary);
        }
      );

      expect(measure.changed, 'the Sum chart received the committed salary edit').toContain(`${EMPLOYEES} Loading Sum`);
      cellEdits.push(measure);
    }

    report('cellEdits', cellEdits);
    await typeIntoCell(page, salaryCell, originalSalary || '0');
    await page.keyboard.press('Enter');
    await settledTimeline(page).catch(() => undefined);

    // --- W6: the Grid tab, then the Dashboard tab again --------------------------------------
    const tabReturns: { visibleMs: number; allMs: number; derivedComputes: number }[] = [];
    const inputDiagnostics = process.env.DASHBOARD_PERF_INPUT_DIAGNOSTICS === '1';
    const tabReturnInputs: unknown[] = [];

    for (let round = 0; round < rounds; round += 1) {
      if (inputDiagnostics) {
        // Observe the real input without changing the existing pre-click timing anchor.
        await page.evaluate((viewId) => {
          const events: { type: string; at: number; eventAt: number }[] = [];

          (window as any).__DASHBOARD_TAB_RETURN_INPUTS__ = events;
          const record = (event: Event) => {
            if (!event.isTrusted || !(event.target instanceof Element)) return;
            if (!event.target.closest(`[data-testid="view-tab-${viewId}"]`)) return;
            events.push({ type: event.type, at: Date.now(), eventAt: performance.timeOrigin + event.timeStamp });
            if (event.type === 'click') {
              document.removeEventListener('pointerdown', record, true);
              document.removeEventListener('click', record, true);
            }
          };

          document.addEventListener('pointerdown', record, { capture: true, passive: true });
          document.addEventListener('click', record, { capture: true, passive: true });
        }, dashboardViewId(page));
      }

      // The derived results the return computes (W6 b): 0 while the kept ones are current.
      await page.evaluate(() => (window as any).__DASHBOARD_LOAD_STATS__?.reset());
      await leaveAndReturnInApp(page, 1_000);
      const openedAt = loadingScenario(page).openedAt ?? Date.now();
      const widgets = loadingWidgets(page);

      await waitForWidgetData(page, widgets);
      const { data, frames, ready } = await readPageRecord(page);
      const visible = loadingScenario(page).visibleAtOpen ?? new Set<string>();
      const after = (ids: string[]) => Math.max(...ids.map((id) => data[id] - openedAt));

      const { derivedComputes } = await loadStats(page);

      tabReturns.push({
        visibleMs: after(widgets.filter((widget) => visible.has(widget.id)).map((widget) => widget.id)),
        allMs: after(widgets.map((widget) => widget.id)),
        derivedComputes: Object.values(derivedComputes).reduce((sum, count) => sum + count, 0),
      });
      if (inputDiagnostics) {
        const inputs = await page.evaluate(() => (window as any).__DASHBOARD_TAB_RETURN_INPUTS__ as
          { type: string; at: number; eventAt: number }[]);
        const pointer = inputs.find((event) => event.type === 'pointerdown');
        const click = inputs.find((event) => event.type === 'click');
        const lastVisible = Math.max(...widgets.filter((widget) => visible.has(widget.id)).map((widget) => data[widget.id]));

        tabReturnInputs.push({
          preClickVisibleMs: lastVisible - openedAt,
          pointerDownDelayMs: pointer ? pointer.at - openedAt : null,
          clickDelayMs: click ? click.at - openedAt : null,
          pointerToVisibleMs: pointer ? lastVisible - pointer.at : null,
          clickToVisibleMs: click ? lastVisible - click.at : null,
          eventClockDifferenceMs: pointer ? pointer.at - pointer.eventAt : null,
          widgets: widgets.map((widget) => ({
            label: widget.label,
            visible: visible.has(widget.id),
            frameMs: frames[widget.id] - openedAt,
            readyMs: ready[widget.id] - openedAt,
            dataMs: data[widget.id] - openedAt,
          })),
        });
      }

      await page.waitForTimeout(2_000);
    }

    report('tabReturns', tabReturns);
    if (inputDiagnostics) report('tabReturnInputs', tabReturnInputs);
    await testInfo.attach('dashboard-perf-conditions', {
      contentType: 'application/json',
      body: JSON.stringify(results, null, 2),
    });

    // --- Counts (any build) ------------------------------------------------------------------
    selectOn.forEach((measure) => expectOneChangePerWidget(measure, `turning the "${TOGGLED_OPTION}" option on`));
    selectOff.forEach((measure) => expectOneChangePerWidget(measure, `turning the "${TOGGLED_OPTION}" option off`));
    typed.forEach((measure) => expectOneChangePerWidget(measure, `typing "${TYPED_CHARACTER}"`));
    removed.forEach((measure) => expectOneChangePerWidget(measure, `removing "${TYPED_CHARACTER}"`));
    // Every widget shows the employees: each one's result changes with the option.
    expect(selectOn[0].changed.length, 'widgets whose result changed with the option').toBe(loadingWidgets(page).length);

    if (!perf) return;

    // --- Times (perf mode) -------------------------------------------------------------------
    const toggles = [...selectOn, ...selectOff];

    expect
      .soft(median(toggles.map((m) => m.everyWidgetMs)), 'ms from a select toggle to every widget changed')
      .toBeLessThanOrEqual(SELECT_TOGGLE_MS);
    expect
      .soft(median(toggles.map((m) => m.longTasks.maxMs)), 'longest task of a select toggle, ms')
      .toBeLessThanOrEqual(SELECT_TOGGLE_LONGEST_TASK_MS);
    expect
      .soft(median(typed.map((m) => m.everyWidgetMs)), 'ms from a typed character to every widget changed')
      .toBeLessThanOrEqual(TYPED_CHARACTER_MS);
    expect
      .soft(
        median(
          typed.map((m) => {
            expect(m.inputEventMs, 'Event Timing must be available for the key-event budget').not.toBeNull();
            return m.inputEventMs!;
          })
        ),
        'ms of the key event of a typed character'
      )
      .toBeLessThanOrEqual(KEY_EVENT_MS);
    expect.soft(median(editPaints), 'ms from Edit to its paint').toBeLessThanOrEqual(EDIT_MODE_PAINT_MS);
    expect.soft(median(donePaints), 'ms from Done to its paint').toBeLessThanOrEqual(EDIT_MODE_PAINT_MS);
    expect
      .soft(median(cellEdits.map((m) => m.everyWidgetMs)), 'ms from Enter in a cell to every widget showing the row')
      .toBeLessThanOrEqual(CELL_EDIT_MS);
    expect
      .soft(median(tabReturns.map((m) => m.visibleMs)), 'ms from the Dashboard tab to data in every visible widget')
      .toBeLessThanOrEqual(TAB_RETURN_VISIBLE_MS);
    expect
      .soft(median(tabReturns.map((m) => m.allMs)), 'ms from the Dashboard tab to data in all 12 widgets')
      .toBeLessThanOrEqual(TAB_RETURN_ALL_MS);
  });
});
