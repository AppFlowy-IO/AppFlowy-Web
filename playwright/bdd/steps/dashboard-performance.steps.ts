import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import {
  addPerformanceFilter,
  addPerformanceWidget,
  assertMeasuredBudget,
  beginDashboardPerformance,
  dragPerformanceHandle,
  editedWidgetsTime,
  expectNoDashboardRetained,
  expectPerformanceChanges,
  leavePerformanceDashboard,
  maximumStall,
  newWidgetDataTime,
  performanceMeasurements,
  performanceSamples,
  performanceWorld,
  pointerPerformance,
  recordOpenTime,
  scrollPerformanceGrid,
  scrollPerformancePage,
  togglePerformanceFilter,
  togglePerformanceMode,
  typePerformanceFilter,
  visitForMemory,
} from '../../support/dashboard-performance-helpers';
import { enterEditMode } from '../../support/dashboard-test-helpers';

const { Given, When, Then, Before, After } = createBdd();

Before({ tags: '@dashboard-perf' }, async ({ $testInfo }) => {
  expect(process.env.DASHBOARD_PERF, 'time budgets require DASHBOARD_PERF=1 and the production preview').toBe('1');
  $testInfo.setTimeout(45 * 60 * 1000);
});

After({ tags: '@dashboard-perf' }, async ({ page, $testInfo }) => {
  await $testInfo.attach('dashboard-performance-measurements', {
    contentType: 'application/json',
    body: JSON.stringify(
      { scenario: $testInfo.title, measurements: performanceMeasurements(page), samples: performanceSamples(page) },
      null,
      2
    ),
  });
});

Given('dashboard performance is being recorded', async ({ page }) => {
  await beginDashboardPerformance(page);
});

Given('I entered Edit mode', async ({ page }) => {
  await enterEditMode(page);
});

Given('the dashboard has a text global filter on Name', async ({ page, request }) => {
  await addPerformanceFilter(page, request, 'text');
});

Given('the dashboard has a select global filter on Department', async ({ page, request }) => {
  await addPerformanceFilter(page, request, 'select');
});

When('I scroll the dashboard down and back up', async ({ page }) => {
  await scrollPerformancePage(page);
});
When('I scroll the plain grid widget down {int} notches', async ({ page }, count: number) => {
  await scrollPerformanceGrid(page, count);
});
When('I move the pointer across every dashboard row', async ({ page }) => {
  await pointerPerformance(page, false);
});
When('I move the pointer across the bar chart', async ({ page }) => {
  await pointerPerformance(page, true);
});
When('I enter Edit mode', async ({ page }) => {
  await togglePerformanceMode(page, true);
});
When('I leave Edit mode', async ({ page }) => {
  await togglePerformanceMode(page, false);
});
When('I drag the height handle of the first row down for {int} seconds', async ({ page }, seconds: number) => {
  await dragPerformanceHandle(page, 'height', seconds);
});
When('I drag the width handle between the first two widgets for {int} seconds', async ({ page }, seconds: number) => {
  await dragPerformanceHandle(page, 'width', seconds);
});
When(
  'I type the letters a and n into the Name global filter one at a time, waiting for every widget after each',
  async ({ page }) => {
    await typePerformanceFilter(page);
  }
);
When('I select Engineering in the Department global filter', async ({ page }) => {
  await togglePerformanceFilter(page, false);
});
When('I clear the Department global filter', async ({ page }) => {
  await togglePerformanceFilter(page, true);
});
When('I add a widget showing the employees Grid view', async ({ page }) => {
  await addPerformanceWidget(page);
});
When('I leave the dashboard', async ({ page }) => {
  await leavePerformanceDashboard(page);
});
When('I leave and reopen the dashboard {int} times', async ({ page }, count: number) => {
  expect(count).toBe(3);
  await visitForMemory(page, count);
});
When('I leave the dashboard and wait {int} seconds', async ({ page }, seconds: number) => {
  await leavePerformanceDashboard(page);
  await page.waitForTimeout(seconds * 1000);
});

Then('the first widget showed data within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'first widget data', await recordOpenTime(page, 'first'), budget);
});
Then('every visible widget completed within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'visible widgets complete', await recordOpenTime(page, 'visible'), budget);
});
Then('every widget completed within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'all widgets complete', await recordOpenTime(page, 'all'), budget);
});
Then('no frame stalled for more than {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'longest main-thread stall', await maximumStall(page), budget);
});
Then('every widget that shows the row reflected the change within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'cell edit reaches widgets', editedWidgetsTime(page), budget);
});
Then('at most {int} percent of frames missed the frame budget', async ({ page }, budget: number) => {
  const frames = performanceWorld(page).frames;

  expect(frames, 'the input phase sampled animation frames').toBeDefined();
  assertMeasuredBudget(page, 'dropped frames percent', frames!.droppedPct, budget);
});
Then('the dashboard settled within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'mode toggle settled', performanceWorld(page).settledMs!, budget);
});
Then('for each letter every widget changed within {int} ms', async ({ page }, budget: number) => {
  const changes = performanceWorld(page).changes;

  expect(changes).toHaveLength(2);
  for (const [index, change] of changes!.entries())
    assertMeasuredBudget(page, `typed letter ${index + 1}`, change.everyWidgetMs, budget);
});
Then('for each letter each widget changed at most {int} times', async ({ page }, maximum: number) => {
  expectPerformanceChanges(page, maximum);
});
Then('every widget changed within {int} ms', async ({ page }, budget: number) => {
  const changes = performanceWorld(page).changes;

  expect(changes).toHaveLength(1);
  assertMeasuredBudget(page, 'select filter changed widgets', changes![0].everyWidgetMs, budget);
});
Then('each widget changed at most {int} times', async ({ page }, maximum: number) => {
  expectPerformanceChanges(page, maximum);
});
Then('the new widget showed data within {int} ms', async ({ page }, budget: number) => {
  assertMeasuredBudget(page, 'new widget data', await newWidgetDataTime(page), budget);
});
Then(
  'the memory after the third visit is within {int} percent of the memory after the first',
  async ({ page }, percent: number) => {
    const memory = performanceWorld(page).memory;

    expect(memory).toHaveLength(3);
    assertMeasuredBudget(page, 'third visit heap MB', memory![2], memory![0] * (1 + percent / 100));
  }
);
Then('nothing of the dashboard is still in memory', async ({ page }) => {
  await expectNoDashboardRetained(page);
});
