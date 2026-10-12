import { expect, test, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView, type DatabaseViewType } from '../../support/database-ui-helpers';
import { ensurePageExpandedByViewId } from '../../support/page-utils';
import {
  BoardSelectors,
  ChartSelectors,
  DatabaseFeedSelectors,
  DatabaseGallerySelectors,
  DatabaseGridSelectors,
  DatabaseListSelectors,
  DatabaseViewSelectors,
  FormSelectors,
  TimelineSelectors,
} from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import { grantTestProSubscription, mockProBillingResponses } from '../../support/subscription-test-helpers';

const layouts: { name: DatabaseViewType; value: number; content: (page: Page) => ReturnType<Page['locator']> }[] = [
  { name: 'Grid', value: 0, content: DatabaseGridSelectors.grid },
  { name: 'Board', value: 1, content: BoardSelectors.boardContainer },
  { name: 'Chart', value: 3, content: (page) => page.getByTestId('database-chart') },
  { name: 'Form', value: 7, content: (page) => page.getByTestId('form-builder-scroll-container') },
  {
    name: 'Calendar',
    value: 2,
    content: (page) => page.locator('.database-calendar:not(.sticky-header-wrapper)').first(),
  },
  { name: 'List', value: 4, content: DatabaseListSelectors.list },
  { name: 'Gallery', value: 5, content: DatabaseGallerySelectors.gallery },
  { name: 'Feed', value: 6, content: DatabaseFeedSelectors.feed },
  { name: 'Timeline', value: 8, content: TimelineSelectors.view },
];

async function expectRenderedContent(page: Page, layout: DatabaseViewType, rowIds: string[]) {
  // Row containers and the chart wrapper mount before their data arrives. Wait
  // for user-visible content rather than treating placeholder counts as ready.
  if (layout === 'Grid') {
    await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
    await expect(DatabaseGridSelectors.grid(page).locator('.primary-cell')).toHaveCount(3);
    await expect(page.locator('[data-testid^="primary-cell-loading-"]')).toHaveCount(0);
  } else if (layout === 'Board') {
    await expect(BoardSelectors.cards(page)).toHaveCount(3);
    for (const title of ['Card 1', 'Card 2', 'Card 3']) {
      await expect(BoardSelectors.cards(page).filter({ hasText: title })).toBeVisible();
    }
  } else if (layout === 'List') {
    await expect(DatabaseListSelectors.rows(page)).toHaveCount(3);
    for (const id of rowIds) {
      await expect(DatabaseListSelectors.rowById(page, id)).toBeVisible();
      await expect(page.getByTestId(`list-primary-cell-${id}`)).toHaveText(/\S/);
    }

    await expect(DatabaseListSelectors.list(page).getByRole('status', { name: 'Loading row', exact: true })).toHaveCount(0);
  } else if (layout === 'Gallery') {
    await expect(DatabaseGallerySelectors.cards(page)).toHaveCount(3);
    for (const id of rowIds) {
      await expect(DatabaseGallerySelectors.cardByRowId(page, id)).toBeVisible();
      await expect(DatabaseGallerySelectors.titleByRowId(page, id)).toHaveText(/\S/);
    }

    await expect(DatabaseGallerySelectors.gallery(page).getByRole('status', { name: 'Loading row', exact: true })).toHaveCount(0);
  } else if (layout === 'Feed') {
    await expect(DatabaseFeedSelectors.loading(page)).toBeHidden();
    await expect(DatabaseFeedSelectors.cards(page)).toHaveCount(3);
    for (const id of rowIds) await expect(DatabaseFeedSelectors.titleByRowId(page, id)).toHaveText(/\S/);
  } else if (layout === 'Chart') {
    // A real SVG or the explicit no-data state is valid. A blank wrapper or
    // spinner is not; default schemas contain groupable fields.
    await expect(ChartSelectors.chart(page).locator('svg.recharts-surface').or(ChartSelectors.emptyStateNoData(page))).toBeVisible();
    await expect(ChartSelectors.emptyStateNoField(page)).toBeHidden();
  } else if (layout === 'Calendar') {
    await expect(page.locator('.database-calendar .fc-daygrid-day').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  } else if (layout === 'Timeline') {
    await expect(TimelineSelectors.sidebarRows(page)).toHaveCount(3);
    for (const id of rowIds) await expect(TimelineSelectors.sidebarRow(page, id)).toBeVisible();
    await expect(TimelineSelectors.today(page)).toBeVisible();
  } else if (layout === 'Form') {
    await expect(FormSelectors.autoCreateDialog(page).or(FormSelectors.addQuestionButton(page))).toBeVisible();
    if (await FormSelectors.autoCreateDialog(page).isVisible()) {
      await FormSelectors.autoCreateStartFromScratch(page).click();
    }

    await expect(FormSelectors.autoCreateDialog(page)).toBeHidden();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(FormSelectors.addQuestionButton(page)).toBeVisible();
    await expect(FormSelectors.accessBanner(page)).toHaveAttribute('data-tier', 'workspace');
    await expect(FormSelectors.accessBanner(page)).toContainText(/Only members at .+ can fill out this form\./);
    await expect(FormSelectors.accessBanner(page)).not.toContainText(/Loading|unavailable/);
    await expect(FormSelectors.previewButton(page)).toBeEnabled();
    await expect(FormSelectors.shareButton(page)).toBeEnabled();
  }

  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /^Creating(?:\.{3}|…)$/ })).toBeHidden();
}

for (const layout of layouts) {
  test(`new ${layout.name} database uses its native recipe and keeps sidebar, tab and content aligned after reload`, async ({
    page,
    request,
  }, info) => {
    if (layout.name === 'Timeline') await mockProBillingResponses(page);
    await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
    if (layout.name === 'Timeline') grantTestProSubscription(page);
    const creations: string[] = [];
    const conversions: string[] = [];

    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/v2/page-view/database/default'))
        creations.push(req.postData()!);
      if (req.method() !== 'GET' && /\/change-layout(?:\?|$)/.test(req.url())) conversions.push(req.url());
    });
    const response = page.waitForResponse(
      (item) => item.request().method() === 'POST' && item.url().endsWith('/v2/page-view/database/default')
    );

    await createDatabaseView(page, layout.name, 0);
    const created = await response;
    const body = await created.json();
    const command = created.request().postDataJSON();

    expect(body.code).toBe(0);
    expect(command.database.layout).toBe(layout.value);
    expect(command.container_id).toBe(body.data.result.view_id);
    expect(command.database.database_id).toBe(body.data.result.database_id);
    expect(command).not.toHaveProperty('page_data');
    expect(command.database).not.toHaveProperty('encoded_collab');
    const container = page.getByTestId(`page-${command.container_id}`);
    const tab = DatabaseViewSelectors.viewTab(page, command.database.view_id);
    const rowIds = command.database.initial_row_ids as string[];

    const assertSelection = async () => {
      if (layout.name === 'Form') {
        await ensurePageExpandedByViewId(page, command.container_id);
        await expect(page.getByTestId(`page-${command.database.view_id}`)).toHaveAttribute('data-selected', 'true');
        const item = page.locator(`[data-testid="page-item"]:has(> [data-testid="page-${command.container_id}"])`).first();

        await expect(item.locator(':scope > .MuiCollapse-root')).toHaveClass(/MuiCollapse-entered/);
      } else {
        await expect(container).toHaveAttribute('data-selected', 'true');
      }
    };

    await assertSelection();
    await expect(tab).toHaveAttribute('data-state', 'active');
    await expect(tab).toContainText(layout.name);
    await expect(layout.content(page)).toBeVisible();
    await expectRenderedContent(page, layout.name, rowIds);
    expect(creations).toHaveLength(1);
    expect(conversions).toEqual([]);
    const screenshotPath = info.outputPath(`created-${layout.name.toLowerCase()}.png`);

    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
    await info.attach(`created-${layout.name.toLowerCase()}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
    await page.reload();
    await assertSelection();
    await expect(tab).toHaveAttribute('data-state', 'active');
    await expect(layout.content(page)).toBeVisible();
    await expectRenderedContent(page, layout.name, rowIds);
    await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(layout.name === 'Form' ? 2 : 1);
    expect(creations).toHaveLength(1);
  });
}
