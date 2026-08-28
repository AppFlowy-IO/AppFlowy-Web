import { expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signUpAndLoginWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  createNamedGridPage,
  databaseBlocks,
  editorForView,
  insertLinkedGridViaSlash,
} from '../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate, currentViewIdFromUrl } from '../../support/page-utils';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then } = createBdd();

const PASSWORD = 'AppFlowy123!';
const SOURCE_DATABASE_NAME = 'Open Original Source';

type LinkedDatabaseState = {
  documentUrl: string;
  documentViewId: string;
  sourceViewId: string;
};

const stateByPage = new WeakMap<Page, LinkedDatabaseState>();

function requireState(page: Page): LinkedDatabaseState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Linked database open-original state was not initialized');

  return state;
}

function linkedGrid(page: Page) {
  const state = requireState(page);

  return databaseBlocks(editorForView(page, state.documentViewId)).first();
}

async function expectSourceDatabase(page: Page, sourceViewId: string) {
  await expect
    .poll(() => currentViewIdFromUrl(page), {
      message: 'Expected the linked database action to open the original database view',
      timeout: 15_000,
    })
    .toBe(sourceViewId);
  await expect(page.getByTestId('page-title-input').filter({ hasText: SOURCE_DATABASE_NAME })).toBeVisible({
    timeout: 15_000,
  });
}

Given('a document contains a linked Grid for open-original testing', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpAndLoginWithPasswordViaUi(page, request, generateRandomEmail(), PASSWORD);
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });

  await createNamedGridPage(page, SOURCE_DATABASE_NAME);
  const sourceViewId = currentViewIdFromUrl(page);
  const documentViewId = await createDocumentPageAndNavigate(page);

  await insertLinkedGridViaSlash(page, documentViewId, SOURCE_DATABASE_NAME);

  const documentUrl = page.url();

  stateByPage.set(page, { documentUrl, documentViewId, sourceViewId });
  await expect(linkedGrid(page)).toBeVisible({ timeout: 30_000 });
});

Then('the linked Grid shows an open-original header action', async ({ page }) => {
  await expect(linkedGrid(page).getByTestId('embedded-database-open-original')).toBeVisible({ timeout: 15_000 });
});

When('I open the linked Grid from its header', async ({ page }) => {
  await linkedGrid(page).getByTestId('embedded-database-open-original').click();
});

Then('the original Grid page is open', async ({ page }) => {
  await expectSourceDatabase(page, requireState(page).sourceViewId);
});

When('I return to the linked Grid document', async ({ page }) => {
  const state = requireState(page);

  await page.goto(state.documentUrl, { waitUntil: 'domcontentloaded' });
  await expect(linkedGrid(page)).toBeVisible({ timeout: 30_000 });
});

When('I open the linked Grid from its toolbar', async ({ page }) => {
  await linkedGrid(page).getByTestId('database-actions-open-as-page').click();
});
