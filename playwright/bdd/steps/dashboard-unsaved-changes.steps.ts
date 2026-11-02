import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { openMenuScope } from '../../support/dashboard-global-filter-helpers';
import {
  addWidgetCheckboxFilter,
  calculateOnViewPage,
  chooseFromSaveMenu,
  clickToastUndo,
  clickWidgetPopoverControl,
  expectChipDot,
  expectSavedToast,
  fieldIdFor,
  filterBarControl,
  footerValue,
  isCheckedCell,
  PrivateSelectors,
  readRowCells,
  readSharedCalculation,
  selectCellNames,
  widgetOf,
  writeUnreadablePrivateState,
} from '../../support/dashboard-private-helpers';
import { WIDGET_TIMEOUT, WIDGET_TIMEOUT_MS } from '../../support/dashboard-shared-helpers';
import {
  addDashboardView,
  chooseGlobalFilterCondition,
  closeGlobalFilterMenu,
  DashboardSelectors,
  dashboardWorld,
  fixtureDatabase,
  leaveEditMode,
  memberPage,
  openDashboard,
  openDashboardAsMember,
  openGlobalFilterChip,
  prepareDashboardFixture,
  seedDashboardWidgets,
  waitForDatabaseContext,
} from '../../support/dashboard-test-helpers';

const { Given, When, Then } = createBdd();

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

/**
 * The fixture workspace, a dashboard on `host` with the two widgets side by
 * side in one row, and View mode (a dashboard created in this session opens
 * in Edit mode; Done leaves it).
 */
Given(
  'the {string} dashboard shows {string} and {string} in one row',
  async ({ page, request }, host: string, first: string, second: string) => {
    await prepareDashboardFixture(page, request);
    await addDashboardView(page, host);
    await seedDashboardWidgets(page, [
      { row: 1, label: first },
      { row: 1, label: second },
    ]);
    await leaveEditMode(page);
  }
);

// ---------------------------------------------------------------------------
// Dots and the toolbar button
// ---------------------------------------------------------------------------

Then('the dashboard filter button shows an unsaved dot', async ({ page }) => {
  await expect(PrivateSelectors.buttonDot(page)).toBeVisible(WIDGET_TIMEOUT);
});

Then('the dashboard filter button shows no unsaved dot', async ({ page }) => {
  await expect(DashboardSelectors.globalFilterButton(page)).toBeVisible(WIDGET_TIMEOUT);
  await expect(PrivateSelectors.buttonDot(page)).toHaveCount(0);
});

/** The toolbar button has no numeric badge (WP07/WP08): only its glyph (and a dot's screen-reader text). */
Then('the dashboard filter button shows no count', async ({ page }) => {
  const button = DashboardSelectors.globalFilterButton(page);

  await expect(button).toBeVisible(WIDGET_TIMEOUT);
  await expect(button.getByTestId('dashboard-global-filter-button-badge')).toHaveCount(0);
  await expect
    .poll(() =>
      button.evaluate((element) => {
        const clone = element.cloneNode(true) as HTMLElement;

        clone.querySelectorAll('[data-slot="unsaved-dot"]').forEach((dot) => dot.remove());
        return (clone.textContent ?? '').trim();
      })
    )
    .toBe('');
});

Then('the {string} widget Sort button shows an unsaved dot', async ({ page }, label: string) => {
  const widget = widgetOf(page, page, label);

  // A dirty tool stays visible without hovering the widget.
  await expect(PrivateSelectors.widgetSortDot(widget)).toBeVisible(WIDGET_TIMEOUT);
  await expect(widget.getByTestId('database-actions-sort')).toHaveAttribute('data-unsaved', 'true');
});

Then('the {string} widget Filter button shows an unsaved dot', async ({ page }, label: string) => {
  const widget = widgetOf(page, page, label);

  await expect(PrivateSelectors.widgetFilterDot(widget)).toBeVisible(WIDGET_TIMEOUT);
  await expect(widget.getByTestId('database-actions-filter')).toHaveAttribute('data-unsaved', 'true');
});

Then('the {string} widget Filter button shows no unsaved dot', async ({ page }, label: string) => {
  const widget = widgetOf(page, page, label);

  await expect(widget).toBeVisible(WIDGET_TIMEOUT);
  await expect(PrivateSelectors.widgetFilterDot(widget)).toHaveCount(0, WIDGET_TIMEOUT);
});

// ---------------------------------------------------------------------------
// The filter bar's Reset and "Save for everyone ˅"
// ---------------------------------------------------------------------------

Then('the filter bar shows {string} and {string}', async ({ page }, first: string, second: string) => {
  await expect(DashboardSelectors.privateControls(page)).toBeVisible(WIDGET_TIMEOUT);
  await expect(filterBarControl(page, first)).toHaveText(first);
  await expect(filterBarControl(page, second)).toHaveText(second);
});

Then('the filter bar shows no {string} button', async ({ page }, label: string) => {
  await expect(filterBarControl(page, label)).toHaveCount(0, WIDGET_TIMEOUT);
});

When('I choose {string} from the {string} menu', async ({ page }, item: string, menu: string) => {
  expect(menu).toBe('Save for everyone');
  await chooseFromSaveMenu(page, item);
});

// ---------------------------------------------------------------------------
// A widget's popover footer and the toast
// ---------------------------------------------------------------------------

When(
  'I click {string} in the {string} widget filters popover',
  async ({ page }, control: string, label: string) => {
    await clickWidgetPopoverControl(page, page, label, control);
  }
);

Then('I see the toast {string} with an {string} button', async ({ page }, message: string, undo: string) => {
  await expectSavedToast(page, message, undo);
});

When('I click {string} in the toast', async ({ page }, label: string) => {
  expect(label).toBe('Undo');
  await clickToastUndo(page);
});

// ---------------------------------------------------------------------------
// This device's storage
// ---------------------------------------------------------------------------

Given('this device holds unreadable unsaved changes for the dashboard', async ({ page, request }) => {
  await writeUnreadablePrivateState(page, request);
});

// ---------------------------------------------------------------------------
// Footer calculations (P0-5)
// ---------------------------------------------------------------------------

/** Opened once on the view's full grid page, where a writer's grid stores the shared value. */
Given(
  'the {string} view calculates the sum of {string}',
  async ({ page }, label: string, property: string) => {
    await calculateOnViewPage(page, label, property, 'Sum', () => openDashboard(page));
  }
);

Then(
  'the {string} widget footer shows the {string} sum {string}',
  async ({ page }, label: string, property: string, value: string) => {
    const widget = widgetOf(page, page, label);

    await expect(footerValue(widget, fieldIdFor(page, label, property))).toHaveText(value, WIDGET_TIMEOUT);
  }
);

/** Read from the source view's `calculations` after a moment: a widget never writes it. */
Then(
  'the shared {string} sum of the {string} view is still {string}',
  async ({ page }, property: string, label: string, value: string) => {
    await page.waitForTimeout(1_000);
    const shared = await readSharedCalculation(page, label, property);

    // `CalculationType.Sum`, still holding the total of every row.
    expect(shared?.type).toBe(4);
    expect(Number(shared?.value)).toBe(Number(value));
  }
);

When('the member opens the {string} grid', async ({ page }, database: string) => {
  const world = dashboardWorld(page);
  const fixture = fixtureDatabase(page, database);
  const member = world.member?.page ?? (await openDashboardAsMember(page));

  await member.goto(`/app/${world.workspaceId}/${fixture.pageId}?v=${fixture.views.Grid}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForDatabaseContext(member, fixture.databaseId);
});

Then(
  'the member sees the {string} sum {string} in the grid footer',
  async ({ page }, property: string, value: string) => {
    const fieldId = fixtureDatabase(page, 'Tasks').fieldIds[property];

    expect(fieldId, `Tasks has no "${property}" property`).toBeTruthy();
    await expect(footerValue(memberPage(page), fieldId)).toHaveText(value, { timeout: WIDGET_TIMEOUT_MS });
  }
);

// ---------------------------------------------------------------------------
// New rows (P0-5): prefilled from private and global filters
// ---------------------------------------------------------------------------

When(
  'I add a {string} checkbox filter inside the {string} widget',
  async ({ page }, property: string, label: string) => {
    await addWidgetCheckboxFilter(page, page, label, property);
  }
);

Then(
  'the {string} row of {string} has {string} set to {string} and {string} checked',
  async ({ page, request }, title: string, database: string, select: string, option: string, checkbox: string) => {
    await expect
      .poll(
        async () => {
          const cells = await readRowCells(page, request, database, title);

          return { [select]: selectCellNames(cells[select]), [checkbox]: isCheckedCell(cells[checkbox]) };
        },
        { timeout: WIDGET_TIMEOUT_MS, message: `waiting for "${title}" to be saved with its prefilled cells` }
      )
      .toEqual({ [select]: [option], [checkbox]: true });
  }
);

// ---------------------------------------------------------------------------
// A read-only member
// ---------------------------------------------------------------------------

Then('the member sees an unsaved dot on the {string} global filter', async ({ page }, name: string) => {
  await expectChipDot(memberPage(page), name);
});

When('the member reloads the dashboard', async ({ page }) => {
  const member = memberPage(page);

  await member.reload({ waitUntil: 'domcontentloaded' });
  await expect(DashboardSelectors.view(member)).toBeVisible({ timeout: WIDGET_TIMEOUT_MS });
});

/** Readers change the values of existing filters only (WP07 decision 2): from the pill's editor. */
When(
  'the member chooses the {string} condition in the {string} global filter',
  async ({ page }, condition: string, name: string) => {
    const member = memberPage(page);

    if (await DashboardSelectors.globalFilterMenu(member).isVisible()) await closeGlobalFilterMenu(member);
    await openGlobalFilterChip(member, name);
    await chooseGlobalFilterCondition(member, condition);
    await closeGlobalFilterMenu(member);
  }
);

/** The toolbar popover that is open: the member's (a reader's filter list) when it shows one. */
Then('the dashboard toolbar filter popover lists the global filter {string}', async ({ page }, name: string) => {
  const scope = await openMenuScope(page, dashboardWorld(page).member?.page);
  const menu = DashboardSelectors.globalFilterMenu(scope);

  await expect(menu).toHaveAttribute('data-screen', 'reader-list');
  await expect(DashboardSelectors.globalFilterReaderItems(scope).filter({ hasText: name })).toHaveCount(1);
});

Then('the dashboard toolbar filter popover has no add button', async ({ page }) => {
  const scope = await openMenuScope(page, dashboardWorld(page).member?.page);

  await expect(DashboardSelectors.globalFilterMenu(scope)).toBeVisible();
  await expect(DashboardSelectors.globalFilterSearch(scope)).toHaveCount(0);
  await expect(DashboardSelectors.globalFilterFieldOptions(scope)).toHaveCount(0);
  await expect(DashboardSelectors.globalFilterMultipleSources(scope)).toHaveCount(0);
  await expect(DashboardSelectors.globalFilterBarAdd(scope)).toHaveCount(0);
});
