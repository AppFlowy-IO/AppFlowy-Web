import { expect, test } from '@playwright/test';

import {
  addViewThroughTabs,
  cleanupDashboardFixture,
  fixtureDatabase,
  prepareDashboardFixture,
} from '../../support/dashboard-test-helpers';

test.afterEach(async ({ page, request }) => cleanupDashboardFixture(page, request));

test('one database tab click creates one history entry and Back returns to the previous view', async ({ page, request }) => {
  await prepareDashboardFixture(page, request, ['Projects']);
  const gridId = fixtureDatabase(page, 'Projects').views.Grid;
  const boardId = fixtureDatabase(page, 'Projects').views.Board ?? await addViewThroughTabs(page, 'Projects', 'Board');
  const grid = page.getByTestId(`view-tab-${gridId}`);
  const board = page.getByTestId(`view-tab-${boardId}`);

  await grid.click();
  await expect(grid).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('database-grid')).toBeVisible();
  const markedUrl = new URL(page.url());

  markedUrl.searchParams.set('qa_history_marker', 'preserved');
  await page.goto(markedUrl.toString());
  await expect(grid).toHaveAttribute('data-state', 'active');
  const before = await page.evaluate(() => history.state.idx as number);

  await board.click();
  await expect(board).toHaveAttribute('data-state', 'active');
  await expect(page.locator('.database-board')).toBeVisible();
  expect(await page.evaluate(() => history.state.idx)).toBe(before + 1);
  expect(new URL(page.url()).searchParams.get('qa_history_marker')).toBe('preserved');

  await board.click();
  expect(await page.evaluate(() => history.state.idx)).toBe(before + 1);

  await page.goBack();
  await expect(grid).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('database-grid')).toBeVisible();
  await page.goForward();
  await expect(board).toHaveAttribute('data-state', 'active');
  await expect(page.locator('.database-board')).toBeVisible();
  await board.click();
  await page.keyboard.press('ArrowLeft');
  await expect(grid).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('database-grid')).toBeVisible();
  expect(await page.evaluate(() => history.state.idx)).toBe(before + 2);
  expect(new URL(page.url()).searchParams.get('qa_history_marker')).toBe('preserved');
  await page.goBack();
  await expect(board).toHaveAttribute('data-state', 'active');
  await page.goForward();
  await expect(grid).toHaveAttribute('data-state', 'active');
});
