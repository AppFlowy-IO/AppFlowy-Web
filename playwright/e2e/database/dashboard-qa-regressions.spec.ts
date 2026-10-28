import { expect, test } from '@playwright/test';

import { ViewLayout } from '../../../src/application/types';
import {
  chooseNewViewType,
  closeDockedPicker,
  newWidget,
  newWidgetRecord,
  refuseChartViewCreation,
  viewsOwnedBy,
} from '../../support/dashboard-add-widget-helpers';
import { startFrameworkErrorRecording } from '../../support/dashboard-error-collector';
import {
  addDashboardView,
  chooseWidgetMenuAction,
  cleanupDashboardFixture,
  createDatabaseViewThroughApi,
  DashboardSelectors,
  DatabaseViewLayout,
  fixtureDatabase,
  hostDatabase,
  leaveEditMode,
  openDashboard,
  openDatabasePage,
  openWidgetPicker,
  prepareDashboardFixture,
  readDatabaseViews,
  reloadDashboard,
  seedDashboardWidgets,
  waitForDashboardSync,
  widgetLocator,
} from '../../support/dashboard-test-helpers';
import { addFormQuestion, dismissAutoCreateDialogIfPresent } from '../../support/form-test-helpers';

test.afterEach(async ({ page, request }) => cleanupDashboardFixture(page, request));

test('a table default can become an admitted Chart, persist and be removed without leaving a spare view', async ({
  page,
  request,
}) => {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  // An unresolved/billing-limited plan falls back to Table in the real add flow.
  // Refuse only its initial Number Chart; the explicit Chart choice is admitted.
  await refuseChartViewCreation(page);
  const widgetId = await openWidgetPicker(page);
  const table = await newWidgetRecord(page);

  await expect(newWidget(page).getByTestId('database-grid')).toBeVisible();
  await page.unroute('**/page-view/*/database-view');
  const errors = await startFrameworkErrorRecording(page);

  await chooseNewViewType(page, 'Chart');
  await expect.poll(async () => (await newWidgetRecord(page)).view_id).not.toBe(table.view_id);
  const chart = await newWidgetRecord(page);

  await expect
    .poll(
      async () =>
        (await readDatabaseViews(page, hostDatabase(page).databaseId)).find((view) => view.id === chart.view_id)?.layout
    )
    .toBe(DatabaseViewLayout.Chart);
  await expect(newWidget(page).getByTestId('database-grid')).toHaveCount(0);
  await closeDockedPicker(page);
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);
  await reloadDashboard(page);
  const widget = DashboardSelectors.widget(page, widgetId);

  await expect(widget).toHaveAttribute('data-view-id', chart.view_id);
  await expect.poll(() => viewsOwnedBy(page, hostDatabase(page).databaseId)).toEqual([chart.view_id]);
  await DashboardSelectors.editButton(page).click();
  await chooseWidgetMenuAction(page, widget, 'delete');
  await leaveEditMode(page);
  await expect(DashboardSelectors.widgets(page)).toHaveCount(0);
  await expect.poll(() => viewsOwnedBy(page, hostDatabase(page).databaseId)).toEqual([]);
  await errors.expectNone();
});

test('a refused Chart choice keeps the table name, layout and data after refresh', async ({ page, request }) => {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  await refuseChartViewCreation(page);
  const widgetId = await openWidgetPicker(page);
  const table = await newWidgetRecord(page);

  const refused = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/database-view') &&
      response.request().postDataJSON()?.layout === ViewLayout.Chart
  );

  await DashboardSelectors.pickerLayoutOption(page, DatabaseViewLayout.Chart).click();
  await refused;
  await expect(DashboardSelectors.newViewTile(page, DatabaseViewLayout.Grid)).toHaveAttribute('data-selected', 'true');
  await expect(DashboardSelectors.newViewName(page)).toHaveValue('Table');
  await expect(newWidget(page).getByTestId('database-grid')).toBeVisible();
  expect((await newWidgetRecord(page)).view_id).toBe(table.view_id);
  await closeDockedPicker(page);
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);
  await reloadDashboard(page);
  const widget = DashboardSelectors.widget(page, widgetId);

  await expect(widget).toHaveAttribute('data-view-id', table.view_id);
  await expect(widget.getByTestId('database-grid')).toBeVisible();
  const view = (await readDatabaseViews(page, hostDatabase(page).databaseId)).find((item) => item.id === table.view_id);

  expect(view).toMatchObject({ name: 'Table', layout: DatabaseViewLayout.Grid });
});

test('changing a manually named table to Chart preserves its exact name', async ({ page, request }) => {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  await refuseChartViewCreation(page);
  const widgetId = await openWidgetPicker(page);

  await chooseNewViewType(page, 'Table');
  await DashboardSelectors.newViewName(page).fill('Quarterly overview');
  await DashboardSelectors.newViewName(page).press('Enter');
  await expect
    .poll(async () => {
      const record = await newWidgetRecord(page);
      return (await readDatabaseViews(page, hostDatabase(page).databaseId)).find((view) => view.id === record.view_id)
        ?.name;
    })
    .toBe('Quarterly overview');
  await page.unroute('**/page-view/*/database-view');
  await DashboardSelectors.newViewTile(page, DatabaseViewLayout.Chart).click();
  await expect
    .poll(async () => {
      const record = await newWidgetRecord(page);
      return (await readDatabaseViews(page, hostDatabase(page).databaseId)).find((view) => view.id === record.view_id)
        ?.layout;
    })
    .toBe(DatabaseViewLayout.Chart);
  await expect(DashboardSelectors.newViewName(page)).toHaveValue('Quarterly overview');
  await closeDockedPicker(page);
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);
  await reloadDashboard(page);
  const viewId = await DashboardSelectors.widget(page, widgetId).getAttribute('data-view-id');

  expect(
    (await readDatabaseViews(page, hostDatabase(page).databaseId)).find((view) => view.id === viewId)
  ).toMatchObject({ name: 'Quarterly overview', layout: DatabaseViewLayout.Chart });
});

test('a lazily opened Form widget renders questions and survives tab navigation and refresh', async ({
  page,
  request,
}) => {
  await prepareDashboardFixture(page, request, ['Projects']);
  await addDashboardView(page, 'Projects');
  const formId = await createDatabaseViewThroughApi(page, request, {
    database: 'Projects',
    name: 'Service request',
    folderLayout: ViewLayout.Form,
  });

  fixtureDatabase(page, 'Projects').views.Form = formId;
  const runtimeErrors: string[] = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (/Invalid hook call|Cannot read properties of null/.test(message.text())) runtimeErrors.push(message.text());
  });
  await seedDashboardWidgets(page, [
    { row: 1, label: 'Projects Grid' },
    { row: 2, label: 'Projects Form' },
  ]);
  const widget = widgetLocator(page, 'Projects Form');
  const builder = widget.getByTestId('form-builder-scroll-container');

  await widget.scrollIntoViewIfNeeded();
  await expect(builder).toBeVisible();
  await dismissAutoCreateDialogIfPresent(page);
  await addFormQuestion(page, 'RichText');
  await expect(widget.getByTestId('form-question-card')).not.toHaveCount(0);
  await leaveEditMode(page);
  await waitForDashboardSync(page, request);
  await openDatabasePage(page, 'Projects', fixtureDatabase(page, 'Projects').views.Grid);
  await expect(page.getByTestId('database-grid')).toBeVisible();
  await openDashboard(page);
  await expect(builder).toBeVisible();
  await reloadDashboard(page);
  await expect(builder).toBeVisible();
  await expect(widget.getByTestId('form-question-card')).not.toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});
