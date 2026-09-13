import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { expect, test } from '@playwright/test';

import {
  generateRandomEmail,
  getPrimaryFieldId,
  loginAndCreateGrid,
  typeTextIntoCell,
} from '../../support/filter-test-helpers';
import { DatabaseViewSelectors } from '../../support/selectors';

test('native Timeline schedules, moves, resizes, cancels, undoes, and reopens its dates', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await loginAndCreateGrid(page, request, generateRandomEmail());
  const primary = await getPrimaryFieldId(page);

  for (const [index, title] of [
    'Explore timeline layouts',
    'Design the AppFlowy experience',
    'Build and validate interactions',
  ].entries()) {
    await typeTextIntoCell(page, primary, index, title);
  }

  await DatabaseViewSelectors.addViewButton(page).click();
  const createTimelineResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/database-view') &&
      response.request().postDataJSON()?.layout === 10
  );

  await page.getByTestId('add-timeline-view-option').click();
  const response = await createTimelineResponse;

  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).code, 'Timeline creation must succeed on the connected server').toBe(0);
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('timeline-no-date-button')).toContainText('3');
  await page.getByTestId('timeline-no-date-button').click();
  for (let index = 0; index < 3; index++)
    await page.getByRole('button', { name: 'Schedule', exact: true }).first().click();
  await page.keyboard.press('Escape');

  const bars = page.locator('[data-testid^="timeline-bar-"]');

  await expect(bars).toHaveCount(3);
  const bar = bars.first();
  const readGeometry = () =>
    bar.evaluate((element) => ({
      left: parseFloat((element as HTMLElement).style.left),
      width: parseFloat((element as HTMLElement).style.width),
    }));
  const before = await readGeometry();
  const box = (await bar.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await readGeometry()).left).toBeCloseTo(before.left + 72, 1);

  await bar.hover();
  const endHandle = bar.getByRole('button', { name: /Resize end/ });
  const endBox = (await endHandle.boundingBox())!;

  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2 + 180, endBox.y + endBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await readGeometry()).width).toBeCloseTo(before.width + 180, 1);

  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

  await bar.locator('button').first().focus();
  await page.keyboard.press(undo);
  await expect.poll(async () => (await readGeometry()).width).toBeCloseTo(before.width, 1);
  await expect.poll(async () => (await readGeometry()).left).toBeCloseTo(before.left + 72, 1);

  const moved = (await bar.boundingBox())!;

  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width / 2 + 108, moved.y + moved.height / 2, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await readGeometry()).left).toBeCloseTo(before.left + 72, 1);

  // A new document must receive the committed row dates and native Timeline layout.
  await page.reload();
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect(bars).toHaveCount(3);
  await expect.poll(async () => (await readGeometry()).left).toBeCloseTo(before.left + 72, 1);

  await page.getByTestId('timeline-scale-button').click();
  await page.getByRole('menuitem', { name: 'Week', exact: true }).click();
  await expect(page.getByTestId('timeline-scale-button')).toContainText('Week');
  await page.reload();
  await expect(page.getByTestId('timeline-scale-button')).toContainText('Week', { timeout: 30_000 });
  await page.getByTestId('timeline-scale-button').click();
  await page.getByRole('menuitem', { name: 'Month', exact: true }).click();

  await page.screenshot({ path: testInfo.outputPath('appflowy-timeline.png'), fullPage: false });
  await testInfo.attach('AppFlowy Timeline', {
    path: testInfo.outputPath('appflowy-timeline.png'),
    contentType: 'image/png',
  });
});

test('creates a standalone Timeline with a date field, table properties, and collapsible groups', async ({
  page,
  request,
}, testInfo) => {
  await signInAndCreateDatabaseView(page, request, generateRandomEmail(), 'Timeline');
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('timeline-new-row').click();
  const title = page.getByTestId('row-title-input').last();
  await expect(title).toBeVisible();
  await title.fill('Plan the next release');
  await title.press('Tab');
  await closeRowDetailWithEscape(page);
  await expect(page.locator('[data-testid^="timeline-bar-"]')).toHaveCount(1);
  await expect(page.getByTestId('database-timeline')).toContainText('Plan the next release');

  await page.getByTestId('database-actions-settings').click();
  await page.getByRole('menuitem', { name: 'Table properties', exact: true }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'Date', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('timeline-viewport').getByText('Date', { exact: true })).toBeVisible();

  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('timeline-group-settings-trigger').hover();
  await page.locator('[data-testid^="timeline-group-by-field-"]').filter({ hasText: 'Tags' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const group = page.getByTestId('timeline-viewport').getByRole('button', { expanded: true });
  await expect(group).toHaveCount(1);
  await group.click();
  await expect(page.locator('[data-testid^="timeline-bar-"]')).toHaveCount(0);
  await page.getByTestId('timeline-viewport').getByRole('button', { expanded: false }).click();
  await expect(page.locator('[data-testid^="timeline-bar-"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-testid^="timeline-bar-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('appflowy-timeline-grouped.png') });
});

test('creates an inline Timeline through the slash menu and reopens it inside its document', async ({
  page,
  request,
}, testInfo) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
  const viewId = await createDocumentPageAndNavigate(page);
  const editor = page.locator(`#editor-${viewId}`);
  await editor.click({ position: { x: 200, y: 100 }, force: true });
  await page.keyboard.type('/timeline');
  await expect(page.getByTestId('slash-menu-timeline')).toBeVisible();
  await page.getByTestId('slash-menu-timeline').click();
  await expect(editor.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(editor.getByTestId('database-timeline')).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByTestId('timeline-new-row')).toBeVisible();
  await expect(editor.getByText('No rows match this view.', { exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('appflowy-timeline-inline.png') });
});
