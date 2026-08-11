import { APIRequestContext, BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { editFirstGridCell } from '../../support/duplicate-test-helpers';
import { DatabaseGridSelectors, DatabaseViewSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();
// ViewLayout.Calendar's wire value. Keep this API fixture independent from app aliases.
const CALENDAR_VIEW_LAYOUT = 3;

type PublishedTemplateState = {
  marker: string;
  publisherEmail: string;
  sourceViewOrder: string[];
  publishedUrl?: string;
  consumerContext?: BrowserContext;
  consumerPage?: Page;
};

type CreateDatabaseViewPayload = {
  parent_view_id: string;
  prev_view_id?: string;
  database_id: string;
  layout: number;
  name: string;
  embedded: boolean;
};

type ApiResponse<T> = {
  code?: number;
  data?: T;
  message?: string;
};

type CreateDatabaseViewResponse = {
  view_id: string;
};

type DatabaseViewCreationRequest = {
  url: string;
  payload: CreateDatabaseViewPayload;
};

const stateByPage = new WeakMap<Page, PublishedTemplateState>();

After(async ({ page }) => {
  const state = stateByPage.get(page);

  await state?.consumerContext?.close();
  stateByPage.delete(page);
});

Given('a publisher has a database container with a custom view order', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const publisherEmail = generateRandomEmail();

  await signInAndCreateDatabaseView(page, request, publisherEmail, 'Grid', {
    verify: async (databasePage) => {
      await expect(DatabaseViewSelectors.viewTab(databasePage).first()).toBeVisible({ timeout: 15000 });
    },
  });
  await waitForGridReady(page);
  const boardCreation = await addDatabaseView(page, 'Board');

  await expect
    .poll(() => databaseViewLabels(page), {
      timeout: 30000,
      message: 'Expected the first two database views to start in creation order',
    })
    .toEqual(['Grid', 'Board']);

  const gridTab = DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' }).first();

  await gridTab.click({ force: true });
  await waitForGridReady(page);

  const gridViewId = await databaseViewIdByLabel(page, 'Grid');

  // Create Calendar after Grid even though Board was created first. This makes
  // folder order differ from creation order without relying on timestamps:
  // folder = Grid, Calendar, Board; creation = Grid, Board, Calendar.
  await addDatabaseViewAfter(page, request, boardCreation, 'Calendar', gridViewId);

  const sourceViewOrder = await databaseViewLabels(page);

  expect(sourceViewOrder).toEqual(['Grid', 'Calendar', 'Board']);

  stateByPage.set(page, {
    marker: `Published template row ${Date.now()}`,
    publisherEmail,
    sourceViewOrder,
  });
});

Given('the publisher adds identifiable row data', async ({ page }) => {
  const state = requireState(page);

  await editFirstGridCell(page, DatabaseGridSelectors.grid(page), state.marker);
  await expect(DatabaseGridSelectors.grid(page)).toContainText(state.marker, { timeout: 15000 });

  // Reload before publishing so the scenario proves the row reached the server,
  // rather than duplicating unsaved browser state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.grid(page)).toContainText(state.marker, { timeout: 30000 });
  await expect
    .poll(() => databaseViewLabels(page), {
      timeout: 30000,
      message: `Expected the custom database view order to survive reload: ${state.sourceViewOrder.join(', ')}`,
    })
    .toEqual(state.sourceViewOrder);
});

When('the publisher publishes the database container as a template', async ({ page }) => {
  const state = requireState(page);

  state.publishedUrl = await publishCurrentDatabase(page);
});

When('another account opens the published template', async ({ page, request, browser }) => {
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
  await expect(DatabaseViewSelectors.viewTab(consumerPage).first()).toBeVisible({ timeout: 60000 });
});

Then('the published database views keep the publisher order', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);

  await expect
    .poll(() => databaseViewLabels(consumerPage), {
      timeout: 60000,
      message: `Expected published database views: ${state.sourceViewOrder.join(', ')}`,
    })
    .toEqual(state.sourceViewOrder);
});

When('that account starts with the published template', async ({ page }) => {
  const consumerPage = requireConsumerPage(requireState(page));
  const startWithTemplate = consumerPage.getByRole('button', {
    name: 'Start with this template',
  });

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

async function addDatabaseView(page: Page, viewType: 'Board' | 'Calendar'): Promise<DatabaseViewCreationRequest> {
  const previousCount = await DatabaseViewSelectors.viewTab(page).count();
  const addButton = DatabaseViewSelectors.addViewButton(page);

  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.click();

  const menuItem = DatabaseViewSelectors.viewTypeOption(page, viewType);

  await expect(menuItem).toBeVisible({ timeout: 10000 });
  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/database-view'),
    { timeout: 30000 }
  );

  await menuItem.click();

  const createResponse = await createResponsePromise;

  expect(createResponse.ok(), `Creating ${viewType} failed with HTTP ${createResponse.status()}`).toBeTruthy();
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(previousCount + 1, { timeout: 30000 });
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType })).toBeVisible({
    timeout: 15000,
  });

  return {
    url: createResponse.url(),
    payload: createResponse.request().postDataJSON() as CreateDatabaseViewPayload,
  };
}

async function addDatabaseViewAfter(
  page: Page,
  request: APIRequestContext,
  creationRequest: DatabaseViewCreationRequest,
  viewType: 'Calendar',
  prevViewId: string
): Promise<void> {
  const token = await requireAuthToken(page);
  const response = await request.post(creationRequest.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
      ...creationRequest.payload,
      prev_view_id: prevViewId,
      layout: CALENDAR_VIEW_LAYOUT,
      name: viewType,
    },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<CreateDatabaseViewResponse> | null;

  if (!response.ok() || body?.code !== 0 || !body.data?.view_id) {
    throw new Error(
      `Creating ${viewType} in custom order failed with HTTP ${response.status()}: ${JSON.stringify(body)}`
    );
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
  await expect(DatabaseViewSelectors.viewTab(page).filter({ hasText: viewType })).toBeVisible({ timeout: 30000 });
}

async function databaseViewIdByLabel(page: Page, label: string): Promise<string> {
  const testId = await DatabaseViewSelectors.viewTab(page)
    .filter({ hasText: label })
    .first()
    .getAttribute('data-testid');
  const viewId = testId?.replace(/^view-tab-/, '');

  if (!viewId || viewId === testId) throw new Error(`Could not resolve database view id for ${label}`);
  return viewId;
}

async function publishCurrentDatabase(page: Page): Promise<string> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 15000 });
  await ShareSelectors.shareButton(page).click({ force: true });

  const sharePopover = ShareSelectors.sharePopover(page);

  await expect(sharePopover).toBeVisible({ timeout: 10000 });
  await sharePopover.getByText('Publish', { exact: true }).click({ force: true });

  const publishButton = ShareSelectors.publishConfirmButton(page);

  await expect(publishButton).toBeEnabled({ timeout: 15000 });
  const publishResponsePromise = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;

      return response.request().method() === 'POST' && pathname.endsWith('/publish');
    },
    { timeout: 60000 }
  );
  const publishError = page.locator('[data-sonner-toast][data-type="error"]').last();
  const publishErrorPromise = publishError.waitFor({ state: 'visible', timeout: 60000 }).then(async () => ({
    error: (await publishError.innerText()).trim(),
  }));

  await publishButton.click({ force: true });
  const publishResult = await Promise.race([
    publishResponsePromise.then((response) => ({ response })),
    publishErrorPromise,
  ]);

  if ('error' in publishResult) {
    throw new Error(`Publishing failed before sending the request: ${publishResult.error}`);
  }

  const { response: publishResponse } = publishResult;

  expect(publishResponse.ok(), `Publishing failed with HTTP ${publishResponse.status()}`).toBeTruthy();
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

async function requireAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const rawToken = localStorage.getItem('token');

    if (rawToken) {
      try {
        const parsed = JSON.parse(rawToken) as { access_token?: string };

        if (parsed.access_token) return parsed.access_token;
      } catch {
        // Fall back to the test-only token mirror below.
      }
    }

    return localStorage.getItem('af_auth_token') ?? '';
  });

  if (!token) throw new Error('The signed-in browser has no access token');
  return token;
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
    throw new Error('The consumer account has not opened the published template');
  }

  return state.consumerPage;
}
