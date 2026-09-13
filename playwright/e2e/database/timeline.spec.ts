import { expect, test, type Page } from '@playwright/test';

import { getCurrentDatabaseInfo, setRelationCellDirect, waitForDatabaseTestContext } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { TimelineSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import {
  activeViewRowIds,
  addTimelineView,
  barBox as sharedBarBox,
  chooseTimelineSettingsOption,
  clickRowCanvas,
  dragBy,
  injectFieldDirect,
  loginAndCreateCalendarWithRows,
  MONTH_COLUMN_WIDTH,
  setTextCellDirect,
  TimelineLayout,
} from '../../support/timeline-test-helpers';

const SCREENSHOT_DIR = process.env.TIMELINE_SCREENSHOT_DIR;
const BARS = '[data-testid^="timeline-bar-"]';
const SIDEBAR_ROWS = '[data-testid^="timeline-sidebar-row-"]';

async function barBox(page: Page, title: string) {
  return { bar: TimelineSelectors.barByTitle(page, title), box: await sharedBarBox(page, title) };
}

test.describe('Timeline view', () => {
  test('a Timeline view plots calendar rows as bars and switches scale', async ({ page, request }) => {
    test.setTimeout(240_000);
    await loginAndCreateCalendarWithRows(page, request, generateRandomEmail(), [
      { title: 'Design review', offsetDays: 0 },
      { title: 'Launch', offsetDays: 3 },
    ]);
    await addTimelineView(page, 2);

    const view = page.getByTestId('timeline-view');

    await expect(page.getByTestId('timeline-header-today')).toBeVisible();
    await expect(page.getByTestId('timeline-today-line')).toBeVisible();
    await expect(page.locator(BARS)).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(SIDEBAR_ROWS)).toHaveCount(2);
    await expect(view).toContainText('Design review');
    await expect(view).toContainText('Launch');
    await expect(page.getByTestId('timeline-zoom-trigger')).toHaveText(/Month/);
    await expect(page.getByTestId('timeline-title')).toHaveText(/\d{4}$/);

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/timeline-month.png`, fullPage: false });

    // Drag "Launch" two columns later: the bar moves by exactly two column widths.
    const columnWidth = MONTH_COLUMN_WIDTH;
    const before = await barBox(page, 'Launch');

    await dragBy(page, before.box.x + before.box.width / 2, before.box.y + before.box.height / 2, columnWidth * 2);
    await expect
      .poll(async () => (await barBox(page, 'Launch')).box.x, { timeout: 10_000 })
      .toBeCloseTo(before.box.x + columnWidth * 2, 0);

    // Resize "Design review" from its right edge to span three days.
    const design = await barBox(page, 'Design review');
    const handle = page.getByTestId(/^timeline-handle-end-/).first();
    const handleBox = await handle.boundingBox();

    if (!handleBox) throw new Error('Resize handle missing');
    await dragBy(page, handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, columnWidth * 2);
    await expect
      .poll(async () => (await barBox(page, 'Design review')).box.width, { timeout: 10_000 })
      .toBeCloseTo(design.box.width + columnWidth * 2, 0);

    // Undo restores the original length through the database history scope.
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await barBox(page, 'Design review')).box.width, { timeout: 10_000 })
      .toBeCloseTo(design.box.width, 0);

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/timeline-after-drag.png`, fullPage: false });

    await page.getByTestId('timeline-zoom-trigger').click();
    await page.getByTestId(`timeline-zoom-${TimelineLayout.Week}`).click();
    await expect(page.getByTestId('timeline-zoom-trigger')).toHaveText(/Week/);
    // Calendar-style week header: weekday name and day number ("Mon 15", "Thu Oct 1").
    await expect(page.getByTestId('timeline-header-today')).toHaveText(/^[A-Z][a-z]{2} (?:[A-Z][a-z]{2} )?\d{1,2}$/);
    await expect(page.locator(BARS)).toHaveCount(2);

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/timeline-week.png`, fullPage: false });

    // The scale persists on the view: reloading reopens at Week.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('timeline-view')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('timeline-zoom-trigger')).toHaveText(/Week/);

    // A new row is undated: it sits in the table, in "No date", and a click on its
    // canvas assigns the clicked day.
    await page.getByTestId('timeline-new-row').click();
    await expect(page.locator(SIDEBAR_ROWS)).toHaveCount(3, { timeout: 15_000 });
    await closeRowDetailWithEscape(page);
    await expect(page.locator('.no-date-button')).toContainText('(1)');
    // The undated row's canvas spans the whole scrolled range, so click inside
    // the visible part of it, just right of the docked table.
    const emptyId = (await page.locator('[data-testid^="timeline-row-empty-"]').first().getAttribute('data-testid'))
      ?.replace('timeline-row-empty-', '');

    if (!emptyId) throw new Error('Undated row canvas missing');
    await clickRowCanvas(page, emptyId);
    await expect(page.locator(BARS)).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('.no-date-button')).toHaveCount(0);

    // Hiding the table keeps every bar.
    await page.getByTestId('timeline-toggle-table').click();
    await expect(page.locator(SIDEBAR_ROWS)).toHaveCount(0);
    await expect(page.locator(BARS)).toHaveCount(3);

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/timeline-no-table.png`, fullPage: false });
  });
});

test.describe('Timeline dependencies and progress', () => {
  test('arrows, move-with-dependents, progress handle, hover card and selection', async ({ page, request }) => {
    test.setTimeout(240_000);
    await loginAndCreateCalendarWithRows(page, request, generateRandomEmail(), [
      { title: 'Design', offsetDays: 0 },
      { title: 'Build', offsetDays: 2 },
    ]);
    await addTimelineView(page, 2);
    const view = page.getByTestId('timeline-view');

    await waitForDatabaseTestContext(page);
    const { databaseId } = await getCurrentDatabaseInfo(page);
    const rowIds = await activeViewRowIds(page);
    const [designId, buildId] = rowIds;

    await injectFieldDirect(page, {
      fieldId: 'rel-deps',
      name: 'Blocked by',
      fieldType: 10,
      typeOption: { database_id: databaseId, is_two_way: false, source_limit: 0, target_limit: 0 },
    });
    await injectFieldDirect(page, { fieldId: 'num-progress', name: 'Progress', fieldType: 1, typeOption: { format: 0 } });
    // Build depends on Design; Design is 40% done.
    await setRelationCellDirect(page, 'rel-deps', 1, [designId]);
    await setTextCellDirect(page, designId, 'num-progress', 1, '40');

    await chooseTimelineSettingsOption(page, 'timeline-dependency-field-rel-deps');
    await expect(page.locator('[data-testid="timeline-arrow"]')).toHaveCount(1, { timeout: 15_000 });
    // This spec asserts frappe's move_dependencies behaviour ("keep the time
    // between items"); the default "only when dates overlap" is covered by BDD.
    await chooseTimelineSettingsOption(page, 'timeline-shift-1');

    await chooseTimelineSettingsOption(page, 'timeline-progress-field-num-progress');
    await expect(page.getByTestId(`timeline-progress-${designId}`)).toHaveAttribute('style', /width: 40%/, {
      timeout: 15_000,
    });

    // Moving the predecessor drags its dependent along by the same distance.
    const columnWidth = MONTH_COLUMN_WIDTH;
    const designBefore = await barBox(page, 'Design');
    const buildBefore = await barBox(page, 'Build');

    await dragBy(page, designBefore.box.x + designBefore.box.width / 2, designBefore.box.y + designBefore.box.height / 2, columnWidth * 2);
    await expect
      .poll(async () => (await barBox(page, 'Design')).box.x, { timeout: 10_000 })
      .toBeCloseTo(designBefore.box.x + columnWidth * 2, 0);
    await expect
      .poll(async () => (await barBox(page, 'Build')).box.x, { timeout: 10_000 })
      .toBeCloseTo(buildBefore.box.x + columnWidth * 2, 0);
    // One undo reverts both bars together.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await barBox(page, 'Build')).box.x, { timeout: 10_000 }).toBeCloseTo(buildBefore.box.x, 0);
    await expect.poll(async () => (await barBox(page, 'Design')).box.x, { timeout: 10_000 }).toBeCloseTo(designBefore.box.x, 0);
    await expect(page.locator('[data-testid="timeline-arrow"]')).toHaveCount(1);

    // The dependent cannot be dragged before its dependency's start.
    await dragBy(page, buildBefore.box.x + buildBefore.box.width / 2, buildBefore.box.y + buildBefore.box.height / 2, -columnWidth * 6);
    // Compare against Design's live position: the drag may auto-scroll the canvas.
    await expect
      .poll(async () => (await barBox(page, 'Build')).box.x - (await barBox(page, 'Design')).box.x, { timeout: 10_000 })
      .toBeCloseTo(0, 0);

    // Resize Design to three days so the progress handle has room, then drag it.
    const endHandle = page.getByTestId(`timeline-handle-end-${designId}`);
    const endBox = await endHandle.boundingBox();

    if (!endBox) throw new Error('Resize handle missing');
    await dragBy(page, endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, columnWidth * 3);
    await expect
      .poll(async () => (await barBox(page, 'Design')).box.width, { timeout: 10_000 })
      .toBeCloseTo(designBefore.box.width + columnWidth * 3, 0);

    const designBar = await barBox(page, 'Design');

    await page.mouse.move(designBar.box.x + designBar.box.width / 2, designBar.box.y + designBar.box.height / 2);
    // Radix also mounts a visually hidden copy for screen readers; assert on the tooltip role.
    const hoverCard = page.getByRole('tooltip').getByTestId('timeline-bar-hover-card');

    await expect(hoverCard).toBeVisible({ timeout: 5_000 });
    await expect(hoverCard).toContainText('Design');
    await expect(hoverCard).toContainText('40% complete');

    const progressHandle = page.getByTestId(`timeline-handle-progress-${designId}`);
    const handleBox = await progressHandle.boundingBox();

    if (!handleBox) throw new Error('Progress handle missing');
    await dragBy(page, handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, designBar.box.width / 2);
    await expect
      .poll(async () => {
        const style = (await page.getByTestId(`timeline-progress-${designId}`).getAttribute('style')) ?? '';
        const match = /width: (\d+)%/.exec(style);

        return match ? Number(match[1]) : -1;
      }, { timeout: 10_000 })
      .toBeGreaterThan(80);

    // Selecting from the table highlights the bar; clicking the empty grid clears it.
    await page.getByTestId(`timeline-sidebar-row-${buildId}`).click();
    await expect(page.getByTestId(`timeline-row-${buildId}`)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId(`timeline-bar-${buildId}`)).toHaveAttribute('data-selected', 'true');
    const buildRowCanvas = await page.getByTestId(`timeline-row-${buildId}`).boundingBox();
    const viewBox = await view.boundingBox();

    if (!buildRowCanvas || !viewBox) throw new Error('Row missing');
    await page.mouse.click(viewBox.x + viewBox.width - 60, buildRowCanvas.y + buildRowCanvas.height / 2);
    await expect(page.getByTestId(`timeline-row-${buildId}`)).not.toHaveAttribute('data-selected', 'true');

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/timeline-dependencies.png`, fullPage: false });
  });
});
