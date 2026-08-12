import { APIRequestContext, Browser, BrowserContext, expect, Page, test } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView, signInAndCreateDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { editFirstGridCell } from '../../support/duplicate-test-helpers';
import { currentViewIdFromUrl } from '../../support/page-utils';
import { DatabaseGridSelectors, DatabaseViewSelectors, ShareSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();
// ViewLayout.Calendar's wire value. Keep this API fixture independent from app aliases.
const CALENDAR_VIEW_LAYOUT = 3;
const NATHAN_PUBLISH_EMAIL = process.env.APPFLOWY_E2E_NATHAN_EMAIL?.trim() || 'nathan@avery.io';
const NATHAN_PUBLISH_ENABLED = process.env.APPFLOWY_E2E_NATHAN_PUBLISH === 'true';

type PublishedTemplateState = {
  marker: string;
  publisherEmail: string;
  sourceViewOrder: string[];
  sourceViewIds?: string[];
  publisherToken?: string;
  publisherWorkspaceId?: string;
  databaseContainerId?: string;
  publishedViewId?: string;
  cleanupPublisherDatabase?: boolean;
  publishedUrl?: string;
  consumerContext?: BrowserContext;
  consumerPage?: Page;
};

type FolderView = {
  view_id: string;
  name: string;
  is_published?: boolean;
  children?: FolderView[];
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

type PublishedInfo = {
  namespace: string;
  publish_name: string;
  view_id: string;
};

type DatabaseViewCreationRequest = {
  url: string;
  payload: CreateDatabaseViewPayload;
};

const stateByPage = new WeakMap<Page, PublishedTemplateState>();

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;

  const cleanupErrors: string[] = [];

  await state.consumerContext?.close().catch((error) => {
    cleanupErrors.push(`public browser cleanup: ${errorMessage(error)}`);
  });

  if (state.cleanupPublisherDatabase) {
    await cleanupPublisherDatabase(request, state).catch((error) => {
      cleanupErrors.push(`publisher database cleanup: ${errorMessage(error)}`);
    });
  }

  stateByPage.delete(page);

  if (cleanupErrors.length > 0) {
    throw new Error(`Published database template teardown failed:\n${cleanupErrors.join('\n')}`);
  }
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
  const sourceViewIds = await databaseViewIds(page);
  const publisherToken = await requireAuthToken(page);
  const publisherWorkspaceId = workspaceIdFromAppUrl(page.url());
  const databaseContainerId = await expectDatabaseContainerId(
    request,
    publisherToken,
    publisherWorkspaceId,
    sourceViewIds
  );

  expect(sourceViewOrder).toEqual(['Grid', 'Calendar', 'Board']);

  stateByPage.set(page, {
    marker: `Published template row ${Date.now()}`,
    publisherEmail,
    sourceViewOrder,
    sourceViewIds,
    publisherToken,
    publisherWorkspaceId,
    databaseContainerId,
    cleanupPublisherDatabase: true,
  });
});

Given(
  'the Nathan publish account has a temporary database container with a custom view order',
  async ({ page, request }) => {
    test.skip(
      !NATHAN_PUBLISH_ENABLED,
      'Set APPFLOWY_E2E_NATHAN_PUBLISH=true to run the stateful nathan@avery.io publish regression.'
    );

    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAndWaitForApp(page, request, NATHAN_PUBLISH_EMAIL);

    const publisherToken = await requireAuthToken(page);
    const publisherWorkspaceId = workspaceIdFromAppUrl(page.url());
    const rootsBefore = await workspaceRootIds(request, publisherToken, publisherWorkspaceId);

    await createDatabaseView(page, 'Grid', 5000);
    await waitForGridReady(page);

    const databaseContainerId = await expectNewWorkspaceRoot(
      request,
      publisherToken,
      publisherWorkspaceId,
      rootsBefore,
      currentViewIdFromUrl(page)
    );
    const state: PublishedTemplateState = {
      marker: `Nathan published template row ${Date.now()}`,
      publisherEmail: NATHAN_PUBLISH_EMAIL,
      publisherToken,
      publisherWorkspaceId,
      databaseContainerId,
      cleanupPublisherDatabase: true,
      sourceViewOrder: [],
    };

    stateByPage.set(page, state);

    const boardCreation = await addDatabaseView(page, 'Board');
    const gridTab = DatabaseViewSelectors.viewTab(page).filter({ hasText: 'Grid' }).first();

    await gridTab.click({ force: true });
    await waitForGridReady(page);

    const gridViewId = await databaseViewIdByLabel(page, 'Grid');

    await addDatabaseViewAfter(page, request, boardCreation, 'Calendar', gridViewId);

    state.sourceViewOrder = await databaseViewLabels(page);
    state.sourceViewIds = await databaseViewIds(page);

    expect(state.sourceViewOrder).toEqual(['Grid', 'Calendar', 'Board']);
    await expectFolderViewOrder(request, state);
  }
);

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

When('the publisher publishes the Board database view as a template', async ({ page, request }) => {
  const state = requireState(page);
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const boardIndex = state.sourceViewOrder.indexOf('Board');

  if (boardIndex < 0) throw new Error('The source database does not contain a Board view');

  const boardViewId = requireValue(sourceViewIds[boardIndex], 'Board database view id');

  state.publishedViewId = boardViewId;
  state.publishedUrl = await publishDatabaseChildView(request, page, state, boardViewId);
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

When('I open the temporary database public link in a fresh browser', async ({ page, browser }) => {
  const state = requireState(page);

  await openPublicDatabase(browser, state);
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

Then('the public outline shows the database container and dot-style child views', async ({ page, request }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const container = await sourceDatabaseContainer(request, state);
  const containerRow = publishedOutlineItem(consumerPage, containerId);

  await expandPublishedOutlineSpace(consumerPage);
  await expect(containerRow).toBeVisible({ timeout: 30000 });
  await expandPublishedOutlineItem(containerRow);
  await expect(containerRow.getByTestId('page-name')).toHaveText(container.name);
  await expect(containerRow.getByTestId('database-view-dot')).toHaveCount(0);

  for (const viewId of sourceViewIds) {
    const childRow = publishedOutlineItem(consumerPage, viewId);

    await expect(childRow).toBeVisible({ timeout: 30000 });
    await expect(childRow.getByTestId('database-view-dot')).toHaveCount(1);
  }
});

Then('the public outline highlights only the container and active database view', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const activeViewId = await activePublicDatabaseViewId(consumerPage);

  await expect(publishedOutlineItem(consumerPage, containerId)).toHaveAttribute('data-selected', 'true');

  for (const viewId of sourceViewIds) {
    await expect(publishedOutlineItem(consumerPage, viewId)).toHaveAttribute(
      'data-selected',
      viewId === activeViewId ? 'true' : 'false'
    );
  }
});

When('the public outline opens the {string} database view', async ({ page }, viewLabel: string) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const viewId = sourceViewIdByLabel(state, viewLabel);

  await publishedOutlineItem(consumerPage, viewId).getByTestId('page-name').click({ force: true });
});

Then(
  'the public database route keeps its published anchor and selects {string}',
  async ({ page }, viewLabel: string) => {
    const state = requireState(page);
    const consumerPage = requireConsumerPage(state);
    const publishedUrl = new URL(requirePublishedUrl(state));
    const expectedViewId = sourceViewIdByLabel(state, viewLabel);

    await expect
      .poll(
        () => {
          const currentUrl = new URL(consumerPage.url());

          return {
            pathname: currentUrl.pathname,
            selectedViewId: currentUrl.searchParams.get('v'),
          };
        },
        {
          timeout: 30000,
          message: `Expected the public outline to select ${viewLabel} without leaving ${publishedUrl.pathname}`,
        }
      )
      .toEqual({
        pathname: publishedUrl.pathname,
        selectedViewId: expectedViewId,
      });
    await expect(DatabaseViewSelectors.viewTab(consumerPage, expectedViewId)).toHaveAttribute('data-state', 'active');
  }
);

When('the public outline opens the database container', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const containerId = requireValue(state.databaseContainerId, 'database container id');

  await publishedOutlineItem(consumerPage, containerId).getByTestId('page-name').click({ force: true });
});

Then('the public outline remains expanded', async ({ page }) => {
  const state = requireState(page);
  const consumerPage = requireConsumerPage(state);
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');

  await expect(publishedOutlineItem(consumerPage, containerId).getByTestId('outline-toggle-collapse')).toBeVisible();

  for (const viewId of sourceViewIds) {
    await expect(publishedOutlineItem(consumerPage, viewId)).toBeVisible();
  }
});

Then('the published child-view outline keeps the database view order', async ({ page, request }) => {
  const state = requireState(page);
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const publishedViewId = requireValue(state.publishedViewId, 'published database view id');

  await expect
    .poll(async () => publishedOutlineDatabaseState(request, state), {
      timeout: 30000,
      message: 'Expected the published child view to retain its database container and source view order',
    })
    .toEqual({
      containerId,
      childViewIds: sourceViewIds,
      publishedChildViewIds: [publishedViewId],
    });
});

Then(
  'the published outline contains the temporary container and all its views in source order',
  async ({ page, request }) => {
    const state = requireState(page);
    const containerId = requireValue(state.databaseContainerId, 'database container id');
    const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');

    await expect
      .poll(async () => publishedOutlineDatabase(request, state), {
        timeout: 30000,
        message: 'Expected the published outline to contain every database view in source order',
      })
      .toEqual({ containerId, childViewIds: sourceViewIds });

    await openPublishedPagesList(page);
    await expect(publishedPageRow(page, containerId)).toBeVisible({ timeout: 30000 });

    for (const viewId of sourceViewIds) {
      await expect(publishedPageRow(page, viewId)).toBeHidden();
    }
  }
);

When('I unpublish the temporary database container from published pages', async ({ page }) => {
  const state = requireState(page);
  const workspaceId = requireValue(state.publisherWorkspaceId, 'publisher workspace id');
  const databaseContainerId = requireValue(state.databaseContainerId, 'database container id');
  const containerRow = publishedPageRow(page, databaseContainerId);

  await expect(containerRow).toBeVisible({ timeout: 30000 });
  await containerRow.getByTestId('published-item-actions').click();

  const unpublishAction = page.locator('[data-testid="published-item-action-unpublish"]:visible');

  await expect(unpublishAction).toBeVisible({ timeout: 10000 });

  const unpublishResponsePromise = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;

      return (
        response.request().method() === 'POST' &&
        pathname === `/api/workspace/${workspaceId}/page-view/${databaseContainerId}/unpublish`
      );
    },
    { timeout: 60000 }
  );

  await unpublishAction.click();

  const unpublishResponse = await unpublishResponsePromise;

  expect(
    unpublishResponse.ok(),
    `Unpublishing the temporary database failed with HTTP ${unpublishResponse.status()}`
  ).toBeTruthy();
});

When('the publisher unpublishes the published database child view', async ({ page, request }) => {
  const state = requireState(page);
  const token = requireValue(state.publisherToken, 'publisher token');
  const workspaceId = requireValue(state.publisherWorkspaceId, 'publisher workspace id');
  const publishedViewId = requireValue(state.publishedViewId, 'published database view id');

  await postVoid(request, token, `/api/workspace/${workspaceId}/page-view/${publishedViewId}/unpublish`);
});

Then('the published outline no longer contains the temporary container or its views', async ({ page, request }) => {
  const state = requireState(page);
  const publishedViewIds = requirePublishedViewIds(state);
  const containerId = requireValue(state.databaseContainerId, 'database container id');

  await expect
    .poll(() => isPublished(request, containerId), {
      timeout: 30000,
      message: 'Expected the database container publication to be removed',
    })
    .toBe(false);

  await expect
    .poll(
      async () =>
        publishedOutlineViewIds(request, state).then((viewIds) => publishedViewIds.some((id) => viewIds.has(id))),
      {
        timeout: 30000,
        message: 'Expected the container and its database-view metadata to leave the published outline',
      }
    )
    .toBe(false);

  for (const viewId of publishedViewIds) {
    await expect(publishedPageRow(page, viewId)).toBeHidden({ timeout: 30000 });
  }
});

Then("the temporary database's former public link is unavailable", async ({ page }) => {
  const state = requireState(page);
  const publicPage = requireConsumerPage(state);
  const publishedUrl = requirePublishedUrl(state);
  const cacheBustedUrl = new URL(publishedUrl);

  cacheBustedUrl.searchParams.set('unpublished-check', Date.now().toString());
  await publicPage.goto(cacheBustedUrl.toString(), { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      async () => {
        const pathname = new URL(publicPage.url()).pathname;
        const bodyText = await publicPage.locator('body').innerText();

        return pathname === '/login' || bodyText.includes("This page hasn't been published yet");
      },
      {
        timeout: 30000,
        message: 'Expected the former public link to redirect to login or show the unpublished state',
      }
    )
    .toBe(true);
  await expect(DatabaseViewSelectors.viewTab(publicPage)).toHaveCount(0, { timeout: 30000 });
});

Then('the published outline no longer contains the source database', async ({ page, request }) => {
  const state = requireState(page);
  const sourceDatabaseViewIds = requirePublishedViewIds(state);

  await expect
    .poll(
      async () => {
        const publishedIds = await publishedOutlineViewIds(request, state);

        return sourceDatabaseViewIds.some((viewId) => publishedIds.has(viewId));
      },
      {
        timeout: 30000,
        message: 'Expected the unpublished child view and its database outline metadata to be removed',
      }
    )
    .toBe(false);
});

Then('the former database child public link is unavailable', async ({ page }) => {
  const state = requireState(page);
  const publicPage = requireConsumerPage(state);
  const cacheBustedUrl = new URL(requirePublishedUrl(state));

  cacheBustedUrl.searchParams.set('unpublished-check', Date.now().toString());
  await publicPage.goto(cacheBustedUrl.toString(), { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      async () => {
        const pathname = new URL(publicPage.url()).pathname;
        const bodyText = await publicPage.locator('body').innerText();

        return pathname === '/login' || bodyText.includes("This page hasn't been published yet");
      },
      {
        timeout: 30000,
        message: 'Expected the former database child public link to become unavailable',
      }
    )
    .toBe(true);
  await expect(DatabaseViewSelectors.viewTab(publicPage)).toHaveCount(0, { timeout: 30000 });
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

async function databaseViewIds(page: Page): Promise<string[]> {
  const testIds = await DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs.map((tab) => tab.getAttribute('data-testid') ?? '')
  );

  return testIds.map((testId) => {
    const viewId = testId.replace(/^view-tab-/, '');

    if (!viewId || viewId === testId) {
      throw new Error(`Could not resolve a database view id from ${testId || 'an empty test id'}`);
    }

    return viewId;
  });
}

function publishedOutlineItem(page: Page, viewId: string) {
  return page.locator(`[data-testid="outline-item-${viewId}"]:visible`).first();
}

async function expandPublishedOutlineSpace(page: Page): Promise<void> {
  const spaceName = page.getByTestId('space-name').first();

  await expect(spaceName).toBeVisible({ timeout: 30000 });

  const spaceRow = spaceName.locator('xpath=ancestor::*[starts-with(@data-testid, "outline-item-")][1]');

  await expandPublishedOutlineItem(spaceRow);
}

async function expandPublishedOutlineItem(outlineItem: ReturnType<typeof publishedOutlineItem>): Promise<void> {
  const expandButton = outlineItem.getByTestId('outline-toggle-expand');

  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }

  await expect(outlineItem.getByTestId('outline-toggle-collapse')).toBeVisible();
}

async function activePublicDatabaseViewId(page: Page): Promise<string> {
  const testId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');
  const viewId = testId?.replace(/^view-tab-/, '');

  if (!viewId || viewId === testId) {
    throw new Error(`Could not resolve the active public database view from ${testId || 'an empty test id'}`);
  }

  return viewId;
}

function sourceViewIdByLabel(state: PublishedTemplateState, viewLabel: string): string {
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const viewIndex = state.sourceViewOrder.indexOf(viewLabel);

  if (viewIndex < 0 || !sourceViewIds[viewIndex]) {
    throw new Error(`The source database does not contain a ${viewLabel} view`);
  }

  return sourceViewIds[viewIndex];
}

async function sourceDatabaseContainer(request: APIRequestContext, state: PublishedTemplateState): Promise<FolderView> {
  const token = requireValue(state.publisherToken, 'publisher token');
  const workspaceId = requireValue(state.publisherWorkspaceId, 'publisher workspace id');
  const containerId = requireValue(state.databaseContainerId, 'database container id');

  return getApi<FolderView>(request, token, `/api/workspace/${workspaceId}/view/${containerId}?depth=2`);
}

async function publishDatabaseChildView(
  request: APIRequestContext,
  page: Page,
  state: PublishedTemplateState,
  viewId: string
): Promise<string> {
  const token = requireValue(state.publisherToken, 'publisher token');
  const workspaceId = requireValue(state.publisherWorkspaceId, 'publisher workspace id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');

  // The page-view endpoint exercises the direct child-view publish contract.
  // Pass a deliberately reversed order so the published folder remains the
  // authoritative source for the database tab order.
  await postVoid(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}/publish`, {
    visible_database_view_ids: [...sourceViewIds].reverse(),
    duplicate_enabled: true,
  });

  const publishInfo = await expectPublishedInfo(request, viewId);

  return `${new URL(page.url()).origin}/${publishInfo.namespace}/${publishInfo.publish_name}`;
}

async function expectPublishedInfo(request: APIRequestContext, viewId: string): Promise<PublishedInfo> {
  let publishedInfo: PublishedInfo | undefined;

  await expect
    .poll(
      async () => {
        const response = await request.get(`${TestConfig.apiUrl}/api/workspace/v1/published-info/${viewId}`, {
          failOnStatusCode: false,
        });
        const body = (await response.json().catch(() => null)) as ApiResponse<PublishedInfo> | null;

        publishedInfo = response.ok() && body?.code === 0 ? body.data : undefined;
        return publishedInfo?.view_id;
      },
      {
        timeout: 30000,
        message: `Expected database view ${viewId} to be published`,
      }
    )
    .toBe(viewId);

  return requireValue(publishedInfo, 'published database view info');
}

async function openPublicDatabase(browser: Browser, state: PublishedTemplateState): Promise<void> {
  const publishedUrl = requirePublishedUrl(state);
  const publicContext = await browser.newContext({
    baseURL: new URL(publishedUrl).origin,
    viewport: { width: 1440, height: 900 },
  });
  const publicPage = await publicContext.newPage();

  state.consumerContext = publicContext;
  state.consumerPage = publicPage;
  setupPageErrorHandling(publicPage);

  await publicPage.goto(publishedUrl, { waitUntil: 'domcontentloaded' });
  await expect(publicPage.locator('body')).not.toContainText("This page hasn't been published yet", {
    timeout: 30000,
  });
  await expect(DatabaseViewSelectors.viewTab(publicPage).first()).toBeVisible({ timeout: 60000 });
}

async function openPublishedPagesList(page: Page): Promise<void> {
  if (
    await ShareSelectors.publishManageModal(page)
      .isVisible()
      .catch(() => false)
  )
    return;

  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.shareButton(page).click({ force: true });

  const sharePopover = ShareSelectors.sharePopover(page);

  await expect(sharePopover).toBeVisible({ timeout: 15000 });
  await sharePopover.getByTestId('publish-tab').click({ force: true });
  await expect(ShareSelectors.openPublishSettingsButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.openPublishSettingsButton(page).click({ force: true });
  await expect(ShareSelectors.publishManageModal(page)).toBeVisible({ timeout: 30000 });
  await expect(ShareSelectors.publishManagePanel(page)).toBeVisible({ timeout: 30000 });
}

function publishedPageRow(page: Page, viewId: string) {
  return ShareSelectors.publishManageModal(page).getByTestId(`published-item-row-${viewId}`);
}

async function publishedOutlineDatabase(
  request: APIRequestContext,
  state: PublishedTemplateState
): Promise<{ containerId: string; childViewIds: string[] } | null> {
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const outline = await getPublishedOutline(request, state);
  const container = findFolderView(outline, containerId);

  if (!container?.is_published) return null;

  return {
    containerId: container.view_id,
    childViewIds: (container.children ?? []).map((view) => view.view_id),
  };
}

async function publishedOutlineDatabaseState(
  request: APIRequestContext,
  state: PublishedTemplateState
): Promise<{
  containerId: string;
  childViewIds: string[];
  publishedChildViewIds: string[];
} | null> {
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const outline = await getPublishedOutline(request, state);
  const container = findFolderView(outline, containerId);

  if (!container) return null;

  return {
    containerId: container.view_id,
    childViewIds: (container.children ?? []).map((view) => view.view_id),
    publishedChildViewIds: (container.children ?? []).filter((view) => view.is_published).map((view) => view.view_id),
  };
}

async function publishedOutlineViewIds(request: APIRequestContext, state: PublishedTemplateState): Promise<Set<string>> {
  const outline = await getPublishedOutline(request, state);
  const viewIds = new Set<string>();

  collectViewIds(outline, viewIds);
  return viewIds;
}

async function getPublishedOutline(request: APIRequestContext, state: PublishedTemplateState): Promise<FolderView> {
  const publishedUrl = new URL(requirePublishedUrl(state));
  const namespace = publishedUrl.pathname.split('/').filter(Boolean)[0];

  if (!namespace) throw new Error(`Could not read a publish namespace from ${publishedUrl.toString()}`);

  const response = await request.get(
    `${TestConfig.apiUrl}/api/workspace/published-outline/${encodeURIComponent(namespace)}`,
    { failOnStatusCode: false }
  );
  const body = (await response.json().catch(() => null)) as ApiResponse<FolderView> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`Fetching the published outline failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }

  return body.data;
}

function findFolderView(view: FolderView, viewId: string): FolderView | undefined {
  if (view.view_id === viewId) return view;

  for (const child of view.children ?? []) {
    const found = findFolderView(child, viewId);

    if (found) return found;
  }

  return undefined;
}

function collectViewIds(view: FolderView, viewIds: Set<string>): void {
  viewIds.add(view.view_id);

  for (const child of view.children ?? []) {
    collectViewIds(child, viewIds);
  }
}

async function expectFolderViewOrder(request: APIRequestContext, state: PublishedTemplateState): Promise<void> {
  const token = requireValue(state.publisherToken, 'publisher token');
  const workspaceId = requireValue(state.publisherWorkspaceId, 'publisher workspace id');
  const containerId = requireValue(state.databaseContainerId, 'database container id');
  const sourceViewIds = requireValue(state.sourceViewIds, 'source database view ids');
  const container = await getApi<FolderView>(
    request,
    token,
    `/api/workspace/${workspaceId}/view/${containerId}?depth=2`
  );

  expect(
    (container.children ?? []).map((view) => view.view_id),
    'Expected the folder database-view order to match the source tab order'
  ).toEqual(sourceViewIds);
}

async function expectDatabaseContainerId(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  sourceViewIds: string[]
): Promise<string> {
  let containerId = '';

  await expect
    .poll(
      async () => {
        const workspace = await getApi<FolderView>(
          request,
          token,
          `/api/workspace/${workspaceId}/view/${workspaceId}?depth=4`
        );

        containerId = findDatabaseContainerByChildIds(workspace, sourceViewIds)?.view_id ?? '';
        return containerId;
      },
      {
        timeout: 30000,
        message: 'Expected to find the database container for the source database views',
      }
    )
    .not.toBe('');

  return containerId;
}

function findDatabaseContainerByChildIds(view: FolderView, sourceViewIds: string[]): FolderView | undefined {
  const childViewIds = new Set((view.children ?? []).map((child) => child.view_id));

  if (sourceViewIds.length > 0 && sourceViewIds.every((viewId) => childViewIds.has(viewId))) {
    return view;
  }

  for (const child of view.children ?? []) {
    const container = findDatabaseContainerByChildIds(child, sourceViewIds);

    if (container) return container;
  }

  return undefined;
}

async function workspaceRootIds(request: APIRequestContext, token: string, workspaceId: string): Promise<Set<string>> {
  const workspace = await getApi<FolderView>(
    request,
    token,
    `/api/workspace/${workspaceId}/view/${workspaceId}?depth=4`
  );

  return new Set(workspace.children?.flatMap((space) => space.children ?? []).map((view) => view.view_id) ?? []);
}

async function expectNewWorkspaceRoot(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  rootsBefore: Set<string>,
  currentViewId: string
): Promise<string> {
  let createdRootId = '';

  await expect
    .poll(
      async () => {
        const workspace = await getApi<FolderView>(
          request,
          token,
          `/api/workspace/${workspaceId}/view/${workspaceId}?depth=4`
        );
        const newRoots =
          workspace.children
            ?.flatMap((space) => space.children ?? [])
            .filter((view) => !rootsBefore.has(view.view_id)) ?? [];
        const matchingRoot = newRoots.find((view) => containsView(view, currentViewId));

        createdRootId = matchingRoot?.view_id ?? (newRoots.length === 1 ? newRoots[0].view_id : '');
        return createdRootId;
      },
      {
        timeout: 30000,
        message: 'Expected the temporary database container to appear in the workspace folder',
      }
    )
    .not.toBe('');

  return createdRootId;
}

function containsView(view: FolderView, viewId: string): boolean {
  return view.view_id === viewId || (view.children ?? []).some((child) => containsView(child, viewId));
}

async function isPublished(request: APIRequestContext, viewId: string): Promise<boolean> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/v1/published-info/${viewId}`, {
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

  return response.ok() && body?.code === 0 && body.data !== undefined;
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`GET ${path} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function cleanupPublisherDatabase(request: APIRequestContext, state: PublishedTemplateState): Promise<void> {
  const token = state.publisherToken;
  const workspaceId = state.publisherWorkspaceId;
  const containerId = state.databaseContainerId;

  if (!token || !workspaceId || !containerId) return;

  for (const viewId of [containerId, ...(state.sourceViewIds ?? [])]) {
    if (await isPublished(request, viewId)) {
      await postVoid(request, token, `/api/workspace/${workspaceId}/page-view/${viewId}/unpublish`);
    }
  }

  await deleteWorkspaceView(request, token, workspaceId, containerId);
}

async function postVoid(
  request: APIRequestContext,
  token: string,
  path: string,
  data?: Record<string, unknown>
): Promise<void> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`POST ${path} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
  }
}

async function deleteWorkspaceView(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string
): Promise<void> {
  const moveResponse = await request.post(
    `${TestConfig.apiUrl}/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`,
    {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    }
  );

  if (moveResponse.status() === 404) return;

  const moveBody = (await moveResponse.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (!moveResponse.ok() || moveBody?.code !== 0) {
    throw new Error(`Moving ${viewId} to trash failed with HTTP ${moveResponse.status()}: ${JSON.stringify(moveBody)}`);
  }

  const deleteResponse = await request.delete(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/trash/${viewId}`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const deleteBody = (await deleteResponse.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (deleteResponse.status() !== 404 && (!deleteResponse.ok() || deleteBody?.code !== 0)) {
    throw new Error(
      `Deleting ${viewId} from trash failed with HTTP ${deleteResponse.status()}: ${JSON.stringify(deleteBody)}`
    );
  }
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

function requirePublishedViewIds(state: PublishedTemplateState): string[] {
  return [
    requireValue(state.databaseContainerId, 'database container id'),
    ...requireValue(state.sourceViewIds, 'source database view ids'),
  ];
}

function workspaceIdFromAppUrl(urlValue: string): string {
  const segments = new URL(urlValue).pathname.split('/').filter(Boolean);
  const appIndex = segments.indexOf('app');
  const workspaceId = appIndex >= 0 ? segments[appIndex + 1] : undefined;

  if (!workspaceId) throw new Error(`Could not read a workspace id from ${urlValue}`);
  return workspaceId;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
