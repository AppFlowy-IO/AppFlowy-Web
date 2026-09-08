import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { getFeedCardRowIds, openFeedCard, waitForFeedCards } from '../../support/feed-test-helpers';
import { loginAndCreateGrid } from '../../support/filter-test-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import { BlockSelectors, DatabaseFeedSelectors, HeaderSelectors, RowDetailSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

Given('the Feed test app is initialized', async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ height: 900, width: 1440 });
});

When('the Feed user signs in anonymously', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
});

Then('the Feed user sees the home page with get started page', async ({ page }) => {
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
  await expect(
    page.locator('[data-testid="inline-add-page"], [data-testid="new-page-button"]').first()
  ).toBeVisible({ timeout: 20_000 });
});

When('the user creates a new page named {string} with feed layout', async ({ page }, name: string) => {
  await createDatabaseView(page, 'Feed', 8_000);
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible({ timeout: 30_000 });
  await waitForFeedCards(page, 3);
  await renameCurrentDatabasePage(page, name);
});

When('the user clicks the first feed card to open the row detail page', async ({ page }) => {
  await waitForFeedCards(page, 1);
  const [rowId] = await getFeedCardRowIds(page);

  await openFeedCard(page, rowId);
});

When('the user adds feed row document content {string}', async ({ page }, content: string) => {
  await typeInRowDocument(page, content);
});

When('the user closes the feed row detail page', async ({ page }) => {
  await closeRowDetailWithEscape(page);
  await expect(RowDetailSelectors.modal(page)).toHaveCount(0);
});

Then('the first feed card shows row document content {string}', async ({ page }, content: string) => {
  await waitForFeedCards(page, 1);
  const [rowId] = await getFeedCardRowIds(page);
  const preview = DatabaseFeedSelectors.documentPreviewByRowId(page, rowId);

  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText(content.slice(0, 12), { timeout: 30_000 });
});

When('the user creates a new document named {string} for the feed test', async ({ page }, name: string) => {
  const documentViewId = await createDocumentPageAndNavigate(page);
  const title = page.locator(`#editor-title-${documentViewId}`);

  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill(name);
  await page.keyboard.press('Enter');
});

When('the user inserts a linked feed {string} via slash menu', async ({ page }, feedName: string) => {
  const documentViewId = new URL(page.url()).pathname.split('/').filter(Boolean).pop() ?? '';

  expect(documentViewId).not.toBe('');
  await insertLinkedDatabaseViaSlash(page, documentViewId, feedName, 'Feed');
  await expect(BlockSelectors.blockByType(page, 'feed').first()).toBeVisible({ timeout: 30_000 });
});

Then('the linked feed shows row document content {string}', async ({ page }, content: string) => {
  const linkedFeed = BlockSelectors.blockByType(page, 'feed').first().getByTestId('database-feed');

  await expect(linkedFeed).toBeVisible({ timeout: 30_000 });
  await expect(linkedFeed.locator('[data-testid^="feed-card-"][data-row-id]').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(linkedFeed.locator('[data-testid^="feed-document-preview-"]').first()).toContainText(
    content.slice(0, 12),
    { timeout: 30_000 }
  );
});

Given('an editable Feed database is open for readonly parity', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await loginAndCreateGrid(page, request, generateRandomEmail());

  const documentViewId = await createDocumentPageAndNavigate(page);

  // Page locking is intentionally available only on documents. A linked Feed
  // mounted in that document inherits the ordinary App read-only context,
  // matching the existing List and Gallery readonly BDD convention.
  await insertLinkedDatabaseViaSlash(page, documentViewId, 'New Database', 'Feed');
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible({ timeout: 30_000 });
  await waitForFeedCards(page, 3);
});

Then('Feed mutation controls are available before locking', async ({ page }) => {
  const [rowId] = await getFeedCardRowIds(page);

  await expect(DatabaseFeedSelectors.newRowButton(page)).toBeVisible();
  await expect(page.getByTestId('database-new-row-button')).toBeVisible();
  await DatabaseFeedSelectors.cardByRowId(page, rowId).hover();
  await expect(DatabaseFeedSelectors.moreButtonByRowId(page, rowId)).toBeVisible();
});

When('I lock the mounted Feed database', async ({ page }) => {
  await HeaderSelectors.moreActionsButton(page).click();
  const lockItem = page.getByTestId('more-page-lock');

  await expect(lockItem).toBeVisible();
  await lockItem.click();
  await expect(page.getByTestId('page-locked-badge')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(DatabaseFeedSelectors.feed(page)).toBeVisible();
});

/** Desktop `feedControlsAreReadonly`: no add-row button and no more button on hover. */
Then('feed controls are readonly', async ({ page }) => {
  const [rowId] = await getFeedCardRowIds(page);

  await expect(DatabaseFeedSelectors.newRowButton(page)).toHaveCount(0);
  await expect(page.getByTestId('database-new-row-button')).toHaveCount(0);
  await DatabaseFeedSelectors.cardByRowId(page, rowId).hover();
  await expect(DatabaseFeedSelectors.moreButtonByRowId(page, rowId)).toHaveCount(0);
});
