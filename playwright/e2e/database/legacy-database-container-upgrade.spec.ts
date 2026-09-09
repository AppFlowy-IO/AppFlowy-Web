import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { duplicateCurrentPageViaHeader, pageNamesByCopyText } from '../../support/duplicate-test-helpers';
import { currentViewIdFromUrl, ensurePageExpandedByViewId } from '../../support/page-utils';
import { itemDirectChildPageItems, PageSelectors } from '../../support/selectors';
import { setupPageErrorHandling } from '../../support/test-config';

const fixture = {
  email: process.env.LEGACY_DATABASE_E2E_EMAIL ?? '',
  password: process.env.LEGACY_DATABASE_E2E_PASSWORD ?? '',
  workspaceId: process.env.LEGACY_DATABASE_E2E_WORKSPACE_ID ?? '',
  viewId: process.env.LEGACY_DATABASE_E2E_VIEW_ID ?? '',
};

const fixtureConfigured = Object.values(fixture).every(Boolean);

type UpgradeDatabaseContainerResult = {
  database_id: string;
  container_view_id: string;
  database_view_id: string;
  upgraded: boolean;
};

type DatabaseContainerUpgradeStatusResult = {
  eligible: boolean;
  already_upgraded: boolean;
};

function upgradeEndpointPath(viewId: string): string {
  return `/api/workspace/${fixture.workspaceId}/page-view/${viewId}/upgrade-database-container`;
}

function readUpgradeStatus(body: unknown): DatabaseContainerUpgradeStatusResult {
  if (!body || typeof body !== 'object') throw new Error('Upgrade status response was not an object');

  const response = body as { code?: unknown; data?: unknown; message?: unknown };

  if (response.code !== 0 || !response.data || typeof response.data !== 'object') {
    throw new Error(`Upgrade status response failed: ${String(response.message ?? response.code)}`);
  }

  const result = response.data as Partial<DatabaseContainerUpgradeStatusResult>;

  if (typeof result.eligible !== 'boolean' || typeof result.already_upgraded !== 'boolean') {
    throw new Error('Upgrade status response did not contain the expected eligibility result');
  }

  return result as DatabaseContainerUpgradeStatusResult;
}

function readUpgradeResult(body: unknown): UpgradeDatabaseContainerResult {
  if (!body || typeof body !== 'object') throw new Error('Upgrade response was not an object');

  const response = body as { code?: unknown; data?: unknown; message?: unknown };

  if (response.code !== 0 || !response.data || typeof response.data !== 'object') {
    throw new Error(`Upgrade response failed: ${String(response.message ?? response.code)}`);
  }

  const result = response.data as Partial<UpgradeDatabaseContainerResult>;

  if (
    typeof result.database_id !== 'string' ||
    typeof result.container_view_id !== 'string' ||
    typeof result.database_view_id !== 'string' ||
    typeof result.upgraded !== 'boolean'
  ) {
    throw new Error('Upgrade response did not contain the expected database-container result');
  }

  return result as UpgradeDatabaseContainerResult;
}

async function openEligibleLegacyView(page: Page, viewId: string): Promise<void> {
  const statusResponsePromise = page.waitForResponse(
    async (response) => {
      const url = new URL(response.url());

      if (response.request().method() !== 'GET' || url.pathname !== upgradeEndpointPath(viewId) || !response.ok()) {
        return false;
      }

      // RetryLater is encoded as an HTTP 200 application error. Wait for the eventual successful
      // classification so this regression remains compatible with the UI's bounded convergence retry.
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;

      return body?.code === 0;
    },
    { timeout: 90_000 }
  );

  await page.goto(`/app/${fixture.workspaceId}/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => currentViewIdFromUrl(page), { timeout: 30_000 }).toBe(viewId);

  const statusResponse = await statusResponsePromise;

  expect(statusResponse.ok()).toBe(true);
  expect(readUpgradeStatus(await statusResponse.json())).toEqual({
    eligible: true,
    already_upgraded: false,
  });
  const upgradeBanner = page.getByTestId('legacy-database-upgrade-banner');

  await expect(upgradeBanner).toBeVisible({ timeout: 60_000 });
  await expect(upgradeBanner).toContainText('Upgrade to the latest database version.');
}

async function signInAndOpenOriginal(page: Page): Promise<void> {
  setupPageErrorHandling(page);
  await signInWithPasswordViaUi(page, fixture.email, fixture.password);
  await openEligibleLegacyView(page, fixture.viewId);
}

async function viewName(page: Page, viewId: string): Promise<string> {
  const name = PageSelectors.pageByViewId(page, viewId).getByTestId('page-name');

  await expect(name).toBeVisible({ timeout: 30_000 });
  return (await name.innerText()).trim();
}

async function viewIdsForVisibleCopies(page: Page, sourceName: string): Promise<string[]> {
  return pageNamesByCopyText(page, sourceName).evaluateAll((names) =>
    names.map((name) => {
      const item = name.closest('[data-testid="page-item"]');
      const row = item
        ? Array.from(item.children).find((child) => child.getAttribute('data-testid')?.startsWith('page-'))
        : null;
      const testId = row?.getAttribute('data-testid');

      if (!testId?.startsWith('page-')) throw new Error('Copied sidebar view did not expose its view ID');
      return testId.slice('page-'.length);
    })
  );
}

async function visibleDirectChildViewIds(parentItem: Locator): Promise<string[]> {
  return parentItem.locator(itemDirectChildPageItems(true)).evaluateAll((items) =>
    items.map((item) => {
      const row = Array.from(item.children).find((child) => child.getAttribute('data-testid')?.startsWith('page-'));
      const testId = row?.getAttribute('data-testid');

      if (!testId?.startsWith('page-')) throw new Error('Sidebar child did not expose its view ID');
      return testId.slice('page-'.length);
    })
  );
}

async function descendantViewIdsInDfsFolderOrder(parentItem: Locator): Promise<string[]> {
  const descendantIds: string[] = [];
  // Do not add `:visible`: collapsed descendants remain mounted inside nested MUI Collapse
  // wrappers, and the migration must flatten those views too.
  const directChildren = parentItem.locator(itemDirectChildPageItems());
  const childCount = await directChildren.count();

  for (let index = 0; index < childCount; index++) {
    const childItem = directChildren.nth(index);
    const testId = await childItem.locator(':scope > [data-testid^="page-"]').first().getAttribute('data-testid');

    if (!testId?.startsWith('page-')) throw new Error('Sidebar descendant did not expose its view ID');
    descendantIds.push(testId.slice('page-'.length));
    descendantIds.push(...(await descendantViewIdsInDfsFolderOrder(childItem)));
  }

  return descendantIds;
}

async function expandedDirectChildViewIds(page: Page, parentViewId: string): Promise<string[]> {
  await ensurePageExpandedByViewId(page, parentViewId);
  const parentItem = PageSelectors.itemByViewId(page, parentViewId);

  await expect(parentItem).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await visibleDirectChildViewIds(parentItem)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  return visibleDirectChildViewIds(parentItem);
}

async function expandedDescendantViewIdsInDfsFolderOrder(page: Page, parentViewId: string): Promise<string[]> {
  const directChildIds = await expandedDirectChildViewIds(page, parentViewId);
  const parentItem = PageSelectors.itemByViewId(page, parentViewId);

  // This seeded fixture intentionally contains a Board nested below another database view.
  // Waiting for more DFS descendants than direct children ensures lazy outline hydration has
  // exposed that nested topology before the pre-migration snapshot is accepted.
  await expect
    .poll(async () => (await descendantViewIdsInDfsFolderOrder(parentItem)).length, { timeout: 30_000 })
    .toBeGreaterThan(directChildIds.length);
  return descendantViewIdsInDfsFolderOrder(parentItem);
}

test.describe('Legacy database container upgrade', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !fixtureConfigured,
    'Set LEGACY_DATABASE_E2E_EMAIL, LEGACY_DATABASE_E2E_PASSWORD, ' +
      'LEGACY_DATABASE_E2E_WORKSPACE_ID, and LEGACY_DATABASE_E2E_VIEW_ID to run this seeded-account suite.'
  );

  test('shows the migration button without modifying the original legacy database', async ({ page }) => {
    await signInAndOpenOriginal(page);

    await expect(page.getByTestId('upgrade-database-container-button')).toBeVisible();
    await expect.poll(() => currentViewIdFromUrl(page)).toBe(fixture.viewId);
  });

  test('migrates only a newly duplicated legacy database and keeps every copied tab', async ({ page }) => {
    test.setTimeout(180_000);
    await signInAndOpenOriginal(page);

    const sourceName = await viewName(page, fixture.viewId);
    const originalDescendantViewIds = await expandedDescendantViewIdsInDfsFolderOrder(page, fixture.viewId);
    const existingCopyIds = new Set(await viewIdsForVisibleCopies(page, sourceName));

    await duplicateCurrentPageViaHeader(page);

    await expect
      .poll(
        async () => {
          const copyIds = await viewIdsForVisibleCopies(page, sourceName);
          return copyIds.filter((viewId) => !existingCopyIds.has(viewId)).length;
        },
        { timeout: 90_000, message: 'Expected exactly one new legacy database copy in the sidebar' }
      )
      .toBe(1);

    const duplicateViewIds = (await viewIdsForVisibleCopies(page, sourceName)).filter(
      (viewId) => !existingCopyIds.has(viewId)
    );
    const duplicateViewId = duplicateViewIds[0];

    expect(duplicateViewId).toBeTruthy();
    expect(duplicateViewId).not.toBe(fixture.viewId);

    await openEligibleLegacyView(page, duplicateViewId);

    const copiedDescendantViewIds = await expandedDescendantViewIdsInDfsFolderOrder(page, duplicateViewId);
    const upgradeResponsePromise = page.waitForResponse(
      async (response) => {
        const url = new URL(response.url());

        if (
          response.request().method() !== 'POST' ||
          url.pathname !== upgradeEndpointPath(duplicateViewId) ||
          !response.ok()
        ) {
          return false;
        }

        // The UI retries HTTP-200 RetryLater responses; read the result only after an application success.
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;

        return body?.code === 0;
      },
      { timeout: 90_000 }
    );

    await page.getByTestId('upgrade-database-container-button').click();
    const upgradeResponse = await upgradeResponsePromise;

    expect(upgradeResponse.ok()).toBe(true);
    const result = readUpgradeResult(await upgradeResponse.json());

    expect(result.upgraded).toBe(true);
    expect(result.database_view_id).toBe(duplicateViewId);
    expect(result.container_view_id).not.toBe(duplicateViewId);
    expect(result.container_view_id).not.toBe(fixture.viewId);
    await expect(page.getByTestId('legacy-database-upgrade-banner')).toBeHidden({ timeout: 30_000 });

    const containerRow = PageSelectors.pageByViewId(page, result.container_view_id);
    const containerItem = PageSelectors.itemByViewId(page, result.container_view_id);

    // Wait for reconciliation and persisted expansion before reloading the preserved route.
    await expect(containerRow.getByTestId('outline-toggle-collapse')).toBeVisible({ timeout: 60_000 });
    await expect(PageSelectors.pageByViewId(page, duplicateViewId)).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => currentViewIdFromUrl(page), { timeout: 30_000 }).toBe(duplicateViewId);
    await expect(page.getByTestId('legacy-database-upgrade-banner')).toHaveCount(0, { timeout: 60_000 });

    await expect(containerRow).toBeVisible({ timeout: 60_000 });
    await expect(containerRow).toHaveAttribute('data-selected', 'true');
    await expect(containerRow.getByTestId('outline-toggle-collapse')).toBeVisible();
    await expect(PageSelectors.pageByViewId(page, duplicateViewId)).toHaveAttribute('data-selected', 'true');
    await expect
      .poll(() => visibleDirectChildViewIds(containerItem), {
        timeout: 60_000,
        message: 'Expected the preserved database root and every copied descendant directly under the new container',
      })
      .toEqual([duplicateViewId, ...copiedDescendantViewIds]);

    await openEligibleLegacyView(page, fixture.viewId);
    await expect
      .poll(() => expandedDescendantViewIdsInDfsFolderOrder(page, fixture.viewId), { timeout: 30_000 })
      .toEqual(originalDescendantViewIds);
  });
});
