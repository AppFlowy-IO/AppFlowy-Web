import { APIRequestContext, BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp, signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { DatabaseGridSelectors, ShareSelectors, SidebarSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const FIXTURE_EMAIL = 'pdf_db_relation@appflowy.io';
const FIXTURE_PASSWORD = 'AppFlowy!@123';
const FIXTURE_WORKSPACE_ID = 'd767a65f-8d86-4f34-8498-07d2e7eed114';
const SOURCE_DATABASE_VIEW_ID = 'b92c86f7-e385-43c2-a480-cca651beba35';
const SOURCE_GRID_VIEW_ID = 'c21f0728-18ef-404b-8b4f-909bcf4d1fdd';
const RELATED_DATABASE_VIEW_ID = 'e20165e8-0e95-40a4-927c-8e0ee3475d47';
const RELATED_GRID_VIEW_ID = 'acb652f6-61c2-442b-a526-1d3ecc5c96f7';
const RELATION_CONTENT = 'Related DB content';
const FIXTURE_PUBLISH_VIEW_IDS = [
  SOURCE_DATABASE_VIEW_ID,
  SOURCE_GRID_VIEW_ID,
  RELATED_DATABASE_VIEW_ID,
  RELATED_GRID_VIEW_ID,
] as const;

type ApiResponse<T> = {
  code?: number;
  data?: T;
  message?: string;
};

type FolderView = {
  view_id: string;
  name: string;
  children?: FolderView[];
};

type DuplicateResult = {
  view_id: string;
  database_mappings: Record<string, string[]>;
};

type PublishState = Record<(typeof FIXTURE_PUBLISH_VIEW_IDS)[number], boolean>;

type RelationTemplateState = {
  publisherToken?: string;
  initialPublishState?: PublishState;
  publishedUrl?: string;
  consumerContext?: BrowserContext;
  consumerPage?: Page;
  consumerToken?: string;
  consumerWorkspaceId?: string;
  destinationSpaceId?: string;
  destinationChildrenBefore?: Set<string>;
  createdDestinationRoots: Set<string>;
  destinationDepth?: string | null;
  duplicateResult?: DuplicateResult;
};

const stateByPage = new WeakMap<Page, RelationTemplateState>();

Before({ tags: '@published-relation-template' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, { createdDestinationRoots: new Set() });
});

After({ tags: '@published-relation-template' }, async ({ page, request }) => {
  const state = stateByPage.get(page);

  if (!state) return;

  const cleanupErrors: string[] = [];

  await cleanupDestinationCopies(request, state).catch((error) => {
    cleanupErrors.push(`destination cleanup: ${errorMessage(error)}`);
  });
  await state.consumerContext?.close().catch((error) => {
    cleanupErrors.push(`consumer context cleanup: ${errorMessage(error)}`);
  });
  await restoreFixturePublishState(request, state).catch((error) => {
    cleanupErrors.push(`fixture publish-state restore: ${errorMessage(error)}`);
  });

  stateByPage.delete(page);

  if (cleanupErrors.length > 0) {
    throw new Error(`Relation template teardown failed:\n${cleanupErrors.join('\n')}`);
  }
});

Given('the seeded relation template fixture exists', async () => {
  // Fixture source:
  // AppFlowy-Cloud-Premium/backup/README.md (`pdf_db_relation@appflowy.io`)
  // Server regression:
  // tests/workspace/publish/duplication_test.rs::
  // publishing_only_database_with_relation_includes_related_database_in_template
});

Given('I sign in as the relation template fixture publisher', async ({ page, request }) => {
  const state = getState(page);

  await signInWithPasswordViaUi(page, FIXTURE_EMAIL, FIXTURE_PASSWORD, 2000);
  await expect(page).toHaveURL(/\/app\//, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

  state.publisherToken = await requireAuthToken(page);
  state.initialPublishState = Object.fromEntries(
    await Promise.all(FIXTURE_PUBLISH_VIEW_IDS.map(async (viewId) => [viewId, await isPublished(request, viewId)]))
  ) as PublishState;

  // Both databases must begin unpublished. Otherwise an old server can reuse an
  // already-published relation target and conceal the auto-publish regression.
  for (const viewId of FIXTURE_PUBLISH_VIEW_IDS) {
    await setPublished(request, state.publisherToken, viewId, false);
  }
});

Given('the seeded relation cell resolves before publishing', async ({ page }) => {
  await openFixtureView(page, RELATED_GRID_VIEW_ID);
  await expect(DatabaseGridSelectors.grid(page)).toContainText(RELATION_CONTENT, { timeout: 30000 });

  // Opening the related database first primes a fresh browser's local collab
  // cache, matching the fixture's existing relation-cell integration test.
  await openFixtureView(page, SOURCE_GRID_VIEW_ID);
  await expect(page.locator('.relation-cell').first()).toContainText(RELATION_CONTENT, {
    timeout: 30000,
  });
});

When('I publish only the seeded source database as a template', async ({ page, request }) => {
  const state = getState(page);

  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 30000 });
  await ShareSelectors.shareButton(page).click({ force: true });

  const sharePopover = ShareSelectors.sharePopover(page);

  await expect(sharePopover).toBeVisible({ timeout: 15000 });
  await sharePopover.getByText('Publish', { exact: true }).click({ force: true });

  const publishButton = ShareSelectors.publishConfirmButton(page);

  await expect(publishButton).toBeEnabled({ timeout: 30000 });

  const publishResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());

      return response.request().method() === 'POST' && url.pathname === `/api/workspace/${FIXTURE_WORKSPACE_ID}/publish`;
    },
    { timeout: 60000 }
  );

  await publishButton.click({ force: true });

  const publishResponse = await publishResponsePromise;

  expect(
    publishResponse.ok(),
    `Publishing the relation fixture failed with HTTP ${publishResponse.status()}`
  ).toBeTruthy();
  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 60000 });

  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  expect(namespace, 'Expected the fixture publisher to have a publish namespace').not.toBe('');
  expect(publishName, 'Expected the source database to have a publish name').not.toBe('');

  state.publishedUrl = `${new URL(page.url()).origin}/${namespace}/${publishName}`;

  await expect
    .poll(() => isPublished(request, SOURCE_DATABASE_VIEW_ID), {
      timeout: 30000,
      message: 'Expected the source database to be published',
    })
    .toBe(true);
});

When('another account opens the published relation template', async ({ page, request, browser }) => {
  const state = getState(page);
  const publishedUrl = requirePublishedUrl(state);
  const consumerContext = await browser.newContext({
    baseURL: new URL(publishedUrl).origin,
    viewport: { width: 1440, height: 900 },
  });
  const consumerPage = await consumerContext.newPage();

  state.consumerContext = consumerContext;
  state.consumerPage = consumerPage;
  setupPageErrorHandling(consumerPage);

  await signInAndWaitForApp(consumerPage, request, generateRandomEmail());

  state.consumerToken = await requireAuthToken(consumerPage);
  state.consumerWorkspaceId = workspaceIdFromAppUrl(consumerPage.url());

  const destinationFolder = await getWorkspaceFolder(request, state.consumerToken, state.consumerWorkspaceId);
  const generalSpace = destinationFolder.children?.find((view) => view.name === 'General');

  if (!generalSpace) {
    throw new Error('The consumer workspace does not contain the General space');
  }

  state.destinationSpaceId = generalSpace.view_id;
  state.destinationChildrenBefore = new Set((generalSpace.children ?? []).map((view) => view.view_id));

  await consumerPage.goto(publishedUrl, { waitUntil: 'domcontentloaded' });
  await expect(consumerPage.getByRole('button', { name: 'Start with this template' })).toBeVisible({
    timeout: 60000,
  });
  await expect(DatabaseGridSelectors.grid(consumerPage)).toBeVisible({ timeout: 60000 });
});

Then('the published relation cell shows {string}', async ({ page }, expectedContent: string) => {
  const consumerPage = requireConsumerPage(getState(page));

  await expect(consumerPage.locator('.relation-cell').first()).toContainText(expectedContent, {
    timeout: 60000,
  });
});

When('that account starts with the relation template in {string}', async ({ page, request }, spaceName: string) => {
  const state = getState(page);
  const consumerPage = requireConsumerPage(state);
  const consumerWorkspaceId = requireValue(state.consumerWorkspaceId, 'consumer workspace id');

  const spaceResponsePromise = consumerPage.waitForResponse(
    (response) => {
      const url = new URL(response.url());

      return (
        response.request().method() === 'GET' &&
        url.pathname === `/api/workspace/${consumerWorkspaceId}/view/${consumerWorkspaceId}`
      );
    },
    { timeout: 60000 }
  );

  await consumerPage.getByRole('button', { name: 'Start with this template' }).click();

  const spaceResponse = await spaceResponsePromise;

  expect(spaceResponse.ok(), `Loading destination spaces failed with HTTP ${spaceResponse.status()}`).toBeTruthy();
  state.destinationDepth = new URL(spaceResponse.url()).searchParams.get('depth');

  const destinationDialog = consumerPage.getByRole('dialog').filter({ hasText: 'Where would you like to add' }).last();

  await expect(destinationDialog).toBeVisible({ timeout: 30000 });

  const destinationSpace = destinationDialog.getByTestId('space-item').filter({ hasText: spaceName }).first();

  await expect(destinationSpace).toBeVisible({ timeout: 30000 });
  await destinationSpace.click();

  const addButton = destinationDialog.getByRole('button', { name: 'Add', exact: true });

  await expect(addButton).toBeEnabled({ timeout: 15000 });

  const duplicateResponsePromise = consumerPage.waitForResponse(
    (response) => {
      const url = new URL(response.url());

      return (
        response.request().method() === 'POST' &&
        url.pathname === `/api/workspace/${consumerWorkspaceId}/published-duplicate`
      );
    },
    { timeout: 60000 }
  );

  await addButton.click();

  const duplicateResponse = await duplicateResponsePromise;
  const responseBody = (await duplicateResponse.json().catch(() => null)) as ApiResponse<DuplicateResult> | null;

  expect(
    duplicateResponse.ok() && responseBody?.code === 0 && responseBody.data,
    `Relation template duplication failed with HTTP ${duplicateResponse.status()}: ${JSON.stringify(responseBody)}`
  ).toBeTruthy();

  state.duplicateResult = responseBody!.data!;
  await recordCreatedDestinationRoots(request, state);

  const openInBrowser = consumerPage.getByRole('button', { name: /Open in browser/i });

  await expect(openInBrowser).toBeVisible({ timeout: 30000 });
  await openInBrowser.click();
  await expect(consumerPage).toHaveURL(/\/app\//, { timeout: 30000 });
  await expect(DatabaseGridSelectors.grid(consumerPage)).toBeVisible({ timeout: 60000 });
});

Then('the destination space request uses depth 2', async ({ page }) => {
  expect(getState(page).destinationDepth).toBe('2');
});

Then('the relation template duplication contains {int} database mappings', async ({ page }, count: number) => {
  const result = requireDuplicateResult(getState(page));

  expect(Object.keys(result.database_mappings)).toHaveLength(count);
});

Then('the duplicated relation cell shows {string}', async ({ page }, expectedContent: string) => {
  const consumerPage = requireConsumerPage(getState(page));

  await expect(consumerPage.locator('.relation-cell').first()).toContainText(expectedContent, {
    timeout: 60000,
  });
});

Then('the duplicated relation cell does not show {string}', async ({ page }, inaccessibleText: string) => {
  const consumerPage = requireConsumerPage(getState(page));
  const relationCell = consumerPage.locator('.relation-cell').first();

  await expect(relationCell).not.toContainText(inaccessibleText);
  await expect(consumerPage.getByText(inaccessibleText, { exact: true })).toHaveCount(0);
});

When('I reload the duplicated relation template without its mapping query', async ({ page }) => {
  const consumerPage = requireConsumerPage(getState(page));

  // The duplication URL seeds the mapping once. Removing that query before
  // reload verifies the app can restore related databases from local storage.
  await consumerPage.evaluate(() => {
    const url = new URL(window.location.href);

    url.searchParams.delete('db_mappings');
    window.history.replaceState(null, '', url);
  });
  await consumerPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(DatabaseGridSelectors.grid(consumerPage)).toBeVisible({ timeout: 60000 });
});

async function openFixtureView(page: Page, viewId: string): Promise<void> {
  await page.goto(`/app/${FIXTURE_WORKSPACE_ID}/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 60000 });
  await expect(DatabaseGridSelectors.cells(page).first()).toBeVisible({ timeout: 60000 });
}

async function getWorkspaceFolder(request: APIRequestContext, token: string, workspaceId: string): Promise<FolderView> {
  // A destination selector only needs the workspace, its spaces, and each
  // space's immediate children, so this intentionally mirrors the web request.
  return getApi<FolderView>(request, token, `/api/workspace/${workspaceId}/view/${workspaceId}?depth=2`);
}

async function recordCreatedDestinationRoots(request: APIRequestContext, state: RelationTemplateState): Promise<void> {
  const token = requireValue(state.consumerToken, 'consumer token');
  const workspaceId = requireValue(state.consumerWorkspaceId, 'consumer workspace id');
  const destinationSpaceId = requireValue(state.destinationSpaceId, 'destination space id');
  const before = state.destinationChildrenBefore;

  if (!before) throw new Error('Destination child baseline is missing');

  await expect
    .poll(
      async () => {
        const folder = await getWorkspaceFolder(request, token, workspaceId);
        const destination = findView(folder, destinationSpaceId);
        const created = (destination?.children ?? []).filter((view) => !before.has(view.view_id));

        state.createdDestinationRoots = new Set(created.map((view) => view.view_id));
        return created.length;
      },
      {
        timeout: 30000,
        message: 'Expected the duplicated template to create destination pages',
      }
    )
    .toBeGreaterThan(0);
}

async function cleanupDestinationCopies(request: APIRequestContext, state: RelationTemplateState): Promise<void> {
  if (
    !state.consumerToken ||
    !state.consumerWorkspaceId ||
    !state.destinationSpaceId ||
    !state.destinationChildrenBefore
  ) {
    return;
  }

  const folder = await getWorkspaceFolder(request, state.consumerToken, state.consumerWorkspaceId);
  const destination = findView(folder, state.destinationSpaceId);

  for (const child of destination?.children ?? []) {
    if (!state.destinationChildrenBefore.has(child.view_id)) {
      state.createdDestinationRoots.add(child.view_id);
    }
  }

  for (const viewId of state.createdDestinationRoots) {
    await postVoid(
      request,
      state.consumerToken,
      `/api/workspace/${state.consumerWorkspaceId}/page-view/${viewId}/move-to-trash`
    );
    await deleteVoid(request, state.consumerToken, `/api/workspace/${state.consumerWorkspaceId}/trash/${viewId}`);
  }
}

async function restoreFixturePublishState(request: APIRequestContext, state: RelationTemplateState): Promise<void> {
  if (!state.publisherToken || !state.initialPublishState) return;

  // Reconcile the source first and relation target last because publishing A
  // can auto-publish B. A second pass handles parent/child side effects.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const viewId of FIXTURE_PUBLISH_VIEW_IDS) {
      await setPublished(request, state.publisherToken, viewId, state.initialPublishState[viewId]);
    }
  }
}

async function setPublished(
  request: APIRequestContext,
  token: string,
  viewId: string,
  expected: boolean
): Promise<void> {
  if ((await isPublished(request, viewId)) === expected) return;

  const action = expected ? 'publish' : 'unpublish';
  const data = expected ? { comments_enabled: true, duplicate_enabled: true } : undefined;

  await postVoid(request, token, `/api/workspace/${FIXTURE_WORKSPACE_ID}/page-view/${viewId}/${action}`, data);
  await expect
    .poll(() => isPublished(request, viewId), {
      timeout: 30000,
      message: `Expected fixture view ${viewId} published=${expected}`,
    })
    .toBe(expected);
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

async function deleteVoid(request: APIRequestContext, token: string, path: string): Promise<void> {
  const response = await request.delete(`${TestConfig.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`DELETE ${path} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`);
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

function workspaceIdFromAppUrl(urlValue: string): string {
  const segments = new URL(urlValue).pathname.split('/').filter(Boolean);
  const appIndex = segments.indexOf('app');
  const workspaceId = appIndex >= 0 ? segments[appIndex + 1] : undefined;

  if (!workspaceId) throw new Error(`Could not read a workspace id from ${urlValue}`);
  return workspaceId;
}

function findView(root: FolderView, viewId: string): FolderView | undefined {
  if (root.view_id === viewId) return root;

  for (const child of root.children ?? []) {
    const found = findView(child, viewId);

    if (found) return found;
  }

  return undefined;
}

function getState(page: Page): RelationTemplateState {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Published relation template scenario state is missing');
  return state;
}

function requirePublishedUrl(state: RelationTemplateState): string {
  return requireValue(state.publishedUrl, 'published relation template URL');
}

function requireConsumerPage(state: RelationTemplateState): Page {
  return requireValue(state.consumerPage, 'consumer page');
}

function requireDuplicateResult(state: RelationTemplateState): DuplicateResult {
  return requireValue(state.duplicateResult, 'relation template duplicate result');
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
