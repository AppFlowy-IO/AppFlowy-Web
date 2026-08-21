import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { addGalleryView, getActiveRowIds } from '../../support/gallery-test-helpers';
import { createDocumentPageAndNavigate } from '../../support/page-utils';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape, typeInRowDocument } from '../../support/row-detail-helpers';
import {
  DatabaseGallerySelectors,
  DatabaseViewSelectors,
  PageSelectors,
  RowDetailSelectors,
  ViewActionSelectors,
} from '../../support/selectors';
import { renameCurrentPage } from '../../support/duplicate-test-helpers';
import { setupPageErrorHandling } from '../../support/test-config';

const { Then, When } = createBdd();

type GalleryStackingState = {
  activePage: Page;
  galleryPageId: string;
  galleryViewId: string;
};

const states = new WeakMap<Page, GalleryStackingState>();

function getState(rootPage: Page): GalleryStackingState {
  const state = states.get(rootPage);

  if (!state) throw new Error('The Gallery row-detail stacking test has not created its database');
  return state;
}

function getActivePage(rootPage: Page): Page {
  return getState(rootPage).activePage;
}

When(
  'the user creates a Gallery database named {string} for row-detail stacking',
  async ({ page }, galleryName: string) => {
    await createDatabaseView(page, 'Grid', 7_000);
    await waitForGridReady(page);
    await renameCurrentDatabasePage(page, galleryName);
    const galleryViewId = await addGalleryView(page);
    const galleryPageId = (await PageSelectors.titleInput(page).first().getAttribute('id'))?.replace(
      /^editor-title-/,
      ''
    );

    if (!galleryPageId) throw new Error('Unable to resolve the Gallery database page ID');

    await expect.poll(() => getActiveRowIds(page), { timeout: 20_000 }).toHaveLength(3);
    states.set(page, { activePage: page, galleryPageId, galleryViewId });
  }
);

When('the user clicks the row-detail stacking Gallery card at position {int}', async ({ page }, position: number) => {
  const activePage = getActivePage(page);
  const card = DatabaseGallerySelectors.cards(activePage).nth(position);

  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
});

Then('exactly one stacking-test row detail page is visible', async ({ page }) => {
  const activePage = getActivePage(page);

  await expect(RowDetailSelectors.modal(activePage)).toHaveCount(1, { timeout: 15_000 });
  await expect(RowDetailSelectors.modal(activePage)).toBeVisible();
});

Then('the current stacking-test row detail page has a document', async ({ page }) => {
  const activePage = getActivePage(page);

  await expect(RowDetailSelectors.modal(activePage).last().getByTestId('editor-content')).toBeVisible({
    timeout: 20_000,
  });
});

When('the user adds stacking-test row document content {string}', async ({ page }, content: string) => {
  await typeInRowDocument(getActivePage(page), content);
});

When('the user presses Escape to close the stacking-test row detail page', async ({ page }) => {
  await closeRowDetailWithEscape(getActivePage(page));
});

When('the user closes the stacking-test row detail page', async ({ page }) => {
  await closeRowDetailWithEscape(getActivePage(page));
});

Then('the stacking-test row detail page is not visible', async ({ page }) => {
  await expect(RowDetailSelectors.modal(getActivePage(page))).toHaveCount(0, { timeout: 15_000 });
});

Then(
  'the current stacking-test row detail page contains text {string} {int} time',
  async ({ page }, content: string, count: number) => {
    const activePage = getActivePage(page);
    const editor = RowDetailSelectors.modal(activePage).last().getByTestId('editor-content');

    await expect(editor.getByText(content, { exact: true })).toHaveCount(count, { timeout: 20_000 });
  }
);

When('the user clicks the stacking-test new row button in the database toolbar', async ({ page }) => {
  const activePage = getActivePage(page);
  const rowCount = (await getActiveRowIds(activePage)).length;

  await activePage.getByTestId('database-new-row-button').click();
  await expect.poll(() => getActiveRowIds(activePage), { timeout: 20_000 }).toHaveLength(rowCount + 1);
});

When(
  'the user creates a document named {string} and opens the stacking-test Gallery database in a new browser tab',
  async ({ page }, documentName: string) => {
    const state = getState(page);

    await createDocumentPageAndNavigate(page);
    await renameCurrentPage(page, documentName);

    const galleryItem = PageSelectors.itemByViewId(page, state.galleryPageId);

    await expect(galleryItem).toBeVisible({ timeout: 20_000 });
    await galleryItem.hover({ force: true });
    await galleryItem.getByTestId('page-more-actions').first().click({ force: true });
    await expect(ViewActionSelectors.openNewTabButton(page)).toBeVisible({ timeout: 10_000 });

    const popupPromise = page.waitForEvent('popup');

    await ViewActionSelectors.openNewTabButton(page).click();
    const popup = await popupPromise;

    setupPageErrorHandling(popup);
    await popup.setViewportSize({ height: 900, width: 1440 });
    await popup.waitForLoadState('domcontentloaded');
    await expect(DatabaseViewSelectors.viewTab(popup, state.galleryViewId)).toBeVisible({ timeout: 30_000 });
    state.activePage = popup;
  }
);

When('the user switches to the Gallery view in the new stacking-test database tab', async ({ page }) => {
  const state = getState(page);
  const activePage = state.activePage;

  await DatabaseViewSelectors.viewTab(activePage, state.galleryViewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(activePage)).toHaveAttribute(
    'data-testid',
    `view-tab-${state.galleryViewId}`
  );
  await expect(DatabaseGallerySelectors.gallery(activePage)).toBeVisible({ timeout: 30_000 });
});
