import { expect, Page } from '@playwright/test';

import { DatabaseViewSelectors } from './selectors';

export async function getActiveDatabaseViewId(page: Page): Promise<string> {
  const activeTab = DatabaseViewSelectors.activeViewTab(page).first();
  const hasActiveTab = await activeTab
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (hasActiveTab) {
    const testId = await activeTab.getAttribute('data-testid');
    const viewId = testId?.replace(/^view-tab-/, '');

    if (viewId && viewId !== testId) {
      return viewId;
    }
  }

  const contextViewId = await page
    .evaluate(() => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;

      return typeof ctx?.activeViewId === 'string' ? ctx.activeViewId : null;
    })
    .catch(() => null);

  expect(contextViewId, 'Unable to resolve active database view id').toBeTruthy();
  return contextViewId as string;
}

export function withPublishedDatabaseView(url: string, viewId: string): string {
  const publishedUrl = new URL(url);

  publishedUrl.searchParams.set('v', viewId);
  return publishedUrl.toString();
}
