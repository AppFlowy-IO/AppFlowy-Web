import { BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { DatabaseGridSelectors, DatabaseViewSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();

type PublishedTemplateState = {
  marker: string;
  publisherEmail: string;
  sourceViewOrder: string[];
  publishedUrl?: string;
  consumerContext?: BrowserContext;
  consumerPage?: Page;
};

const stateByPage = new WeakMap<Page, PublishedTemplateState>();

After(async ({ page }) => {
  const state = stateByPage.get(page);

  await state?.consumerContext?.close();
  stateByPage.delete(page);
});

Given('a publisher has a database container with multiple ordered views', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const publisherEmail = generateRandomEmail();

  await signInAndCreateDatabaseView(page, request, publisherEmail, 'Grid', {
    verify: async (databasePage) => {
      await expect(DatabaseViewSelectors.viewTab(databasePage).first()).toBeVisible({ timeout: 15000 });
    },
  });
  await waitForGridReady(page);
  await addDatabaseView(page, 'Board');
  await addDatabaseView(page, 'Calendar');

  const gridTab = DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' }).first();

  await gridTab.click({ force: true });
  await waitForGridReady(page);

  const sourceViewOrder = await databaseViewLabels(page);

  expect(sourceViewOrder).toEqual(['Grid', 'Board', 'Calendar']);

  stateByPage.set(page, {
    marker: `Published template row ${Date.now()}`,
    publisherEmail,
    sourceViewOrder,
  });
});

Given('the publisher adds identifiable row data', async ({ page }) => {
  const state = requireState(page);

  await DatabaseGridSelectors.firstCell(page).click({ force: true });
  await page.keyboard.type(state.marker);
  await page.keyboard.press('Escape');
  await expect(DatabaseGridSelectors.grid(page)).toContainText(state.marker, { timeout: 15000 });

  // Reload before publishing so the scenario proves the row reached the server,
  // rather than duplicating unsaved browser state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.grid(page)).toContainText(state.marker, { timeout: 30000 });
});

When('the publisher publishes the database container as a template', async ({ page }) => {
  const state = requireState(page);

  state.publishedUrl = await publishCurrentDatabase(page);
});

When('another account starts with the published template', async ({ page, request, browser }) => {
  const state = requireState(page);
  const publishedUrl = requirePublishedUrl(state);
  const origin = new URL(publishedUrl).origin;
  const consumerEmail = generateRandomEmail();

  expect(consumerEmail).not.toBe(state.publisherEmail);

  const consumerContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  });
  const consumerPage = await consumerContext.newPage();

  state.consumerContext = consumerContext;
  state.consumerPage = consumerPage;
  setupPageErrorHandling(consumerPage);

  await signInAndWaitForApp(consumerPage, request, consumerEmail);
  await consumerPage.goto(publishedUrl, { waitUntil: 'domcontentloaded' });

  const startWithTemplate = consumerPage.getByRole('button', {
    name: 'Start with this template',
  });

  await expect(startWithTemplate).toBeVisible({ timeout: 30000 });
  await startWithTemplate.click();

  const destinationDialog = consumerPage.getByRole('dialog').filter({ hasText: 'Where would you like to add' }).last();

  await expect(destinationDialog).toBeVisible({ timeout: 15000 });

  const generalSpace = destinationDialog.getByTestId('space-item').filter({ hasText: 'General' }).first();

  await expect(generalSpace).toBeVisible({ timeout: 30000 });
  await generalSpace.click();

  const addButton = destinationDialog.getByRole('button', { name: 'Add', exact: true });

  await expect(addButton).toBeEnabled();

  const duplicateResponsePromise = consumerPage.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;

      return response.request().method() === 'POST' && pathname.endsWith('/published-duplicate');
    },
    { timeout: 60000 }
  );

  await addButton.click();

  const duplicateResponse = await duplicateResponsePromise;

  expect(
    duplicateResponse.ok(),
    `Published template duplication failed with HTTP ${duplicateResponse.status()}`
  ).toBeTruthy();

  const openInBrowser = consumerPage.getByRole('button', { name: 'Open in browser' });

  await expect(openInBrowser).toBeVisible({ timeout: 30000 });
  await openInBrowser.click();
  await expect(consumerPage).toHaveURL(/\/app\//, { timeout: 30000 });
  await expect(consumerPage.locator('.appflowy-database')).toBeVisible({ timeout: 60000 });
});

Then('the duplicated database views keep the publisher order', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);

  await expect
    .poll(() => databaseViewLabels(consumerPage), {
      timeout: 60000,
      message: `Expected duplicated database views: ${state.sourceViewOrder.join(', ')}`,
    })
    .toEqual(state.sourceViewOrder);
});

Then('the duplicated database contains the publisher row data', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const gridTab = DatabaseViewSelectors.viewTab(consumerPage).filter({ hasText: 'Grid' }).first();

  await gridTab.click({ force: true });
  await waitForGridReady(consumerPage);
  await expect(DatabaseGridSelectors.grid(consumerPage)).toContainText(state.marker, { timeout: 60000 });
});

async function addDatabaseView(page: Page, viewType: 'Board' | 'Calendar'): Promise<void> {
  const previousCount = await DatabaseViewSelectors.viewTab(page).count();
  const addButton = DatabaseViewSelectors.addViewButton(page);

  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.click();

  const menuItem = DatabaseViewSelectors.viewTypeOption(page, viewType);

  await expect(menuItem).toBeVisible({ timeout: 10000 });
  await menuItem.click();
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(previousCount + 1, { timeout: 30000 });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType })).toBeVisible({
    timeout: 15000,
  });
}

async function publishCurrentDatabase(page: Page): Promise<string> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 15000 });
  await ShareSelectors.shareButton(page).click({ force: true });

  const sharePopover = ShareSelectors.sharePopover(page);

  await expect(sharePopover).toBeVisible({ timeout: 10000 });
  await sharePopover.getByText('Publish', { exact: true }).click({ force: true });

  const publishButton = ShareSelectors.publishConfirmButton(page);

  await expect(publishButton).toBeEnabled({ timeout: 15000 });
  await publishButton.click({ force: true });
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 30000 });

  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace, 'Expected a publish namespace').not.toBe('');
  expect(publishName, 'Expected a publish name').not.toBe('');

  const publishedUrl = `${new URL(page.url()).origin}/${namespace}/${publishName}`;

  await page.keyboard.press('Escape');
  return publishedUrl;
}

async function databaseViewLabels(page: Page): Promise<string[]> {
  const labels = await DatabaseViewSelectors.viewTab(page).allInnerTexts();

  return labels.map((label) => label.trim());
}

function requireState(page: Page): PublishedTemplateState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Published database template scenario state is missing');
  }

  return state;
}

function requirePublishedUrl(state: PublishedTemplateState): string {
  if (!state.publishedUrl) {
    throw new Error('The database has not been published');
  }

  return state.publishedUrl;
}

function requireConsumerPage(state: PublishedTemplateState): Page {
  if (!state.consumerPage) {
    throw new Error('The consumer account has not duplicated the template');
  }

  return state.consumerPage;
}
