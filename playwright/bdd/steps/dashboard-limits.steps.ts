/**
 * Steps of `dashboard-limits.feature`, the same Gherkin as desktop's
 * `dashboard_limits.feature`: bdd_widget_test brace syntax (`{12}`,
 * `{'4, 4, 3, 1'}`), matched by escaped Cucumber expressions as in
 * `dashboard-arrange.steps.ts`. Also the phone step of
 * `dashboard-mobile.feature` that shows a full dashboard (web syntax there).
 *
 * Reused from `dashboard-arrange.steps.ts`: the seeded dashboards, row hovers,
 * the widget menu, drags, `the dashboard has {n} widgets` / `rows`, row ids
 * and widths, undo and redo, the add-to-new-row button and `the dashboard
 * shows no limit banner`.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { closeDockedPicker } from '../../support/dashboard-add-widget-helpers';
import { widgetIdAt } from '../../support/dashboard-arrange-helpers';
import {
  collaboratorAddsWidgetInNewRow,
  dragHeightHandleBy,
  expectNoRefusalAnnounced,
  expectNoViewCreatedByDashboard,
  expectRefusalAnnounced,
  expectSavedRowCounts,
  expectSavedWidgetCount,
  expectSavedWidgetCountAtMost,
  expectWidgetsOnePerLineAtFullWidth,
  focusHeightHandle,
  installAnnouncementRecorder,
  openCollaboratorReplica,
  openDashboardSavedWithRows,
  openPhoneDashboardWithRows,
  readBothLayouts,
  saveRowHeightAsAnotherClient,
  settle,
  shownRowCounts,
  shownRowId,
  storedRowCounts,
  syncCollaboratorReplica,
} from '../../support/dashboard-limits-helpers';
import { expectNoEditingControls } from '../../support/dashboard-mobile-helpers';
import { WIDGET_TIMEOUT } from '../../support/dashboard-shared-helpers';
import {
  allWidgets,
  DASHBOARD_MAX_WIDGETS,
  DashboardSelectors,
  expectRowHeight,
  inviteDashboardMember,
  memberPage,
  openDashboardAsMember,
  openWidgetPicker,
  readDashboardSetting,
  waitForDashboardSync,
} from '../../support/dashboard-test-helpers';

const { Before, Given, When, Then } = createBdd();

/** A rendered height may differ from the saved one by a sub-pixel. */
const HEIGHT_TOLERANCE = 1;

Before({ tags: '@dashboard-limits' }, async ({ page }) => {
  await installAnnouncementRecorder(page.context());
});

// ---------------------------------------------------------------------------
// Layouts saved by another client
// ---------------------------------------------------------------------------

Given(
  'a dashboard whose saved layout holds rows of \\{{string}\\} widgets is open in edit mode',
  async ({ page, request }, counts: string) => {
    await openDashboardSavedWithRows(page, request, storedRowCounts(counts));
  }
);

When(
  'another client saves a height of \\{{int}\\} for dashboard row \\{{int}\\}',
  async ({ page }, height: number, row: number) => {
    await saveRowHeightAsAnotherClient(page, row, height);
  }
);

// ---------------------------------------------------------------------------
// Shown and saved widgets
// ---------------------------------------------------------------------------

Then('the dashboard shows \\{{int}\\} widgets', async ({ page }, count: number) => {
  await expect(DashboardSelectors.widgets(page)).toHaveCount(count, WIDGET_TIMEOUT);
});

Then('the dashboard shows at most \\{{int}\\} widgets', async ({ page }, count: number) => {
  await settle(page);
  expect(await DashboardSelectors.widgets(page).count()).toBeLessThanOrEqual(count);
});

Then('the saved dashboard layout holds \\{{int}\\} widgets', async ({ page, request }, count: number) => {
  await expectSavedWidgetCount(page, request, count);
});

Then('the saved dashboard layout holds at most \\{{int}\\} widgets', async ({ page, request }, count: number) => {
  await expectSavedWidgetCountAtMost(page, request, count);
});

Then('the dashboard shows rows of \\{{string}\\} widgets', async ({ page }, counts: string) => {
  await expect.poll(() => shownRowCounts(page), WIDGET_TIMEOUT).toEqual(storedRowCounts(counts));
});

Then('the saved dashboard layout has rows of \\{{string}\\} widgets', async ({ page, request }, counts: string) => {
  await expectSavedRowCounts(page, request, storedRowCounts(counts));
});

Then(
  'dashboard row \\{{int}\\} shows the widget ids \\{{string}\\}',
  async ({ page }, row: number, ids: string) => {
    const expected = ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    await expect
      .poll(async () => {
        const rows = await DashboardSelectors.rows(page).evaluateAll((elements) =>
          elements.map((element) =>
            Array.from(element.querySelectorAll('[data-testid="dashboard-widget"]')).map(
              (widget) => widget.getAttribute('data-widget-id') ?? ''
            )
          )
        );

        return rows[row - 1] ?? null;
      }, WIDGET_TIMEOUT)
      .toEqual(expected);
  }
);

Then('no widget appears twice in the saved dashboard layout', async ({ page }) => {
  const ids = allWidgets(await readDashboardSetting(page)).map((widget) => widget.id);

  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
});

Then(
  'the dashboard row \\{{int}\\} holds a copy of dashboard widget \\{{int}\\}',
  async ({ page }, row: number, source: number) => {
    const sourceId = await widgetIdAt(page, source);

    await expect
      .poll(async () => (await readDashboardSetting(page)).rows[row - 1]?.widgets.length, WIDGET_TIMEOUT)
      .toBe(1);
    const setting = await readDashboardSetting(page);
    const original = allWidgets(setting).find((widget) => widget.id === sourceId);
    const [copy] = setting.rows[row - 1].widgets;

    expect(original, `dashboard widget ${source} is still saved`).toBeDefined();
    expect(copy.id).not.toBe(sourceId);
    // A copy shows its own copy of the view, of the same database, at full width.
    expect(copy.view_id).not.toBe(original?.view_id);
    expect(copy.database_id).toBe(original?.database_id);
    expect(copy.width).toBe(12);
    await expect(DashboardSelectors.widget(page, copy.id)).toBeVisible(WIDGET_TIMEOUT);
  }
);

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

When('the user clicks the add to row button of dashboard row \\{{int}\\}', async ({ page }, row: number) => {
  const button = DashboardSelectors.addWidgetRowButton(page, await shownRowId(page, row));

  await expect(button).toHaveCount(1);
  // `aria-disabled` keeps the pointer events (the press is announced), so skip the enabled wait.
  await button.click({ force: true });
});

When('the user clicks the dashboard widget menu item \\{{string}\\}', async ({ page }, id: string) => {
  const item = page.getByTestId(`dashboard-widget-menu-${id}`);

  await expect(item).toBeVisible();
  await item.click({ force: true });
});

Then('the refusal \\{{string}\\} was announced', async ({ page }, text: string) => {
  await expectRefusalAnnounced(page, text);
});

Then('no refusal was announced', async ({ page }) => {
  await expectNoRefusalAnnounced(page);
});

Then('no \\{{string}\\} picker is open', async ({ page }, _title: string) => {
  await settle(page);
  await expect(DashboardSelectors.picker(page)).toHaveCount(0);
  await expect(DashboardSelectors.pendingWidget(page)).toHaveCount(0);
});

Then('the dashboard created no view', async ({ page }) => {
  await expectNoViewCreatedByDashboard(page);
});

Then('the add to new row button is enabled', async ({ page }) => {
  const button = DashboardSelectors.grid(page).getByTestId('dashboard-add-widget-button');

  await expect(button).toHaveCount(1);
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

// ---------------------------------------------------------------------------
// Row heights
// ---------------------------------------------------------------------------

When(
  'the user drags the height handle of dashboard row \\{{int}\\} by \\{{int}\\} pixels',
  async ({ page }, row: number, pixels: number) => {
    await dragHeightHandleBy(page, row, pixels);
  }
);

Then('the dashboard row \\{{int}\\} is \\{{int}\\} pixels tall', async ({ page }, row: number, height: number) => {
  await expectRowHeight(page, row, height, { renderedTolerance: HEIGHT_TOLERANCE });
});

When('the user focuses the height handle of dashboard row \\{{int}\\}', async ({ page }, row: number) => {
  await focusHeightHandle(page, row);
});

When('the user presses the Arrow Up key', async ({ page }) => {
  await page.keyboard.press('ArrowUp');
});

When('the user presses the Arrow Down key', async ({ page }) => {
  await page.keyboard.press('ArrowDown');
});

// ---------------------------------------------------------------------------
// A collaborator
// ---------------------------------------------------------------------------

When('a collaborator adds a widget to the dashboard in a new row', async ({ page }) => {
  await openCollaboratorReplica(page);
  const widgetId = await collaboratorAddsWidgetInNewRow(page);

  await syncCollaboratorReplica(page);
  await expect(DashboardSelectors.widget(page, widgetId)).toBeVisible(WIDGET_TIMEOUT);
});

When('the user and a collaborator each add a widget at the same time', async ({ page }) => {
  // Both start from the same 11 widgets and neither sees the other's add before it is written.
  await openCollaboratorReplica(page);
  await collaboratorAddsWidgetInNewRow(page);
  await openWidgetPicker(page);
  await closeDockedPicker(page);
  await syncCollaboratorReplica(page);
});

Then('the user and the collaborator see the same dashboard layout', async ({ page }) => {
  const { user, collaborator } = await readBothLayouts(page);

  expect(collaborator).toEqual(user);
  // What the user's dashboard renders is that layout (at most the first 12 widgets).
  const shown = await DashboardSelectors.widgets(page).evaluateAll((widgets) =>
    widgets.map((widget) => widget.getAttribute('data-widget-id') ?? '')
  );
  const saved = (user as { widgets: { id: string }[] }[]).flatMap((row) => row.widgets.map((widget) => widget.id));

  expect(shown).toEqual(saved.slice(0, DASHBOARD_MAX_WIDGETS));
});

// ---------------------------------------------------------------------------
// A read-only member
// ---------------------------------------------------------------------------

When('a read-only member opens the dashboard', async ({ page, request }) => {
  await waitForDashboardSync(page, request);
  await inviteDashboardMember(page, request, 'read-only');
  await openDashboardAsMember(page);
});

Then('the member sees \\{{int}\\} dashboard widgets', async ({ page }, count: number) => {
  await expect(DashboardSelectors.widgets(memberPage(page))).toHaveCount(count, WIDGET_TIMEOUT);
});

Then('the member sees no add, move or resize controls', async ({ page }) => {
  const member = memberPage(page);

  await expect(DashboardSelectors.editButton(member)).toHaveCount(0);
  await expectNoEditingControls(member);
});

// ---------------------------------------------------------------------------
// A phone (`dashboard-mobile.feature`, web syntax)
// ---------------------------------------------------------------------------

Given(
  'a phone shows a dashboard of {string} with {int} widgets in rows of {string}',
  async ({ page, request }, database: string, count: number, counts: string) => {
    const rows = storedRowCounts(counts);

    expect(rows.reduce((sum, value) => sum + value, 0)).toBe(count);
    await openPhoneDashboardWithRows(page, request, database, rows);
  }
);

Then('the dashboard shows {int} widgets one per line at full width', async ({ page }, count: number) => {
  await expectWidgetsOnePerLineAtFullWidth(page, count);
});
