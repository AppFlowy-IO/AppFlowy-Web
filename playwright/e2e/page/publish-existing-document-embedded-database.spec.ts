/**
 * Publish Existing Document with Embedded Database
 *
 * Regression coverage for a real seeded workspace page. The synthetic publish
 * fixture proves the happy path; this spec targets the existing Project Tracker
 * page shape so embedded database extraction matches production document data.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';
import {
  DatabaseGridSelectors,
  SidebarSelectors,
} from '../../support/selectors';

type ApiResponse<T> = {
  code: number;
  data?: T;
  message: string;
};

type WorkspaceView = {
  view_id: string;
  name: string;
  children?: WorkspaceView[];
};

type PublishedInfo = {
  namespace: string;
  publish_name: string;
  view_id: string;
};

type PublishedSnapshotPayload = {
  kind: string;
  view: {
    viewId: string;
  };
};

const existingEmail = process.env.APPFLOWY_E2E_EXISTING_EMAIL ?? 'nathan@appflowy.io';
const existingPassword = process.env.APPFLOWY_E2E_EXISTING_PASSWORD;
const targetPageName = process.env.APPFLOWY_E2E_EXISTING_PUBLISH_PAGE ?? 'Project Tracker 2';

function apiUrl(path: string): string {
  return new URL(path, TestConfig.apiUrl).toString();
}

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const directToken = localStorage.getItem('af_auth_token');

    if (directToken) return directToken;

    const tokenJson = localStorage.getItem('token');

    if (!tokenJson) return null;

    try {
      return (JSON.parse(tokenJson) as { access_token?: string }).access_token ?? null;
    } catch {
      return null;
    }
  });

  expect(token).toBeTruthy();

  return token!;
}

async function currentWorkspaceId(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const url = new URL(page.url());
    const [, workspaceId] = url.pathname.split('/').filter(Boolean);

    if (workspaceId) return workspaceId;

    await page.waitForTimeout(500);
  }

  throw new Error(`Could not read workspace id from current URL: ${page.url()}`);
}

async function apiRequest<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown
): Promise<T> {
  const response = await request.fetch(apiUrl(path), {
    method,
    data,
    failOnStatusCode: false,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();

  expect(response.ok(), text).toBeTruthy();

  const body = JSON.parse(text) as ApiResponse<T>;

  expect(body.code, text).toBe(0);
  expect(body.data, text).toBeTruthy();

  return body.data!;
}

async function apiVoidRequest(
  request: APIRequestContext,
  token: string,
  method: 'POST',
  path: string,
  data?: unknown
): Promise<void> {
  const response = await request.fetch(apiUrl(path), {
    method,
    data,
    failOnStatusCode: false,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();

  expect(response.ok(), text).toBeTruthy();

  const body = JSON.parse(text) as ApiResponse<unknown>;

  expect(body.code, text).toBe(0);
}

function findViewByName(view: WorkspaceView, name: string): WorkspaceView | undefined {
  if (view.name === name) return view;

  for (const child of view.children ?? []) {
    const match = findViewByName(child, name);

    if (match) return match;
  }

  return undefined;
}

async function findExistingPage(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string
): Promise<WorkspaceView> {
  const folder = await apiRequest<WorkspaceView>(
    request,
    token,
    'GET',
    `/api/workspace/${workspaceId}/folder?depth=20`
  );
  const view = findViewByName(folder, name);

  expect(view?.view_id, `Expected to find existing page named "${name}"`).toBeTruthy();

  return view!;
}

async function embeddedDatabaseViewIdsFromEditor(page: Page, documentViewId: string): Promise<string[]> {
  return page.evaluate((currentDocumentViewId) => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const testWindow = window as Window & {
      __TEST_EDITORS__?: Record<
        string,
        {
          children?: unknown[];
        }
      >;
    };
    const editor = testWindow.__TEST_EDITORS__?.[currentDocumentViewId];
    const ids = new Set<string>();

    const addId = (value: unknown) => {
      if (typeof value === 'string' && uuidPattern.test(value)) {
        ids.add(value);
      }
    };

    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const node = value as {
        type?: string;
        data?: {
          view_id?: unknown;
          viewId?: unknown;
          database_view_id?: unknown;
          view_ids?: unknown;
          viewIds?: unknown;
          database_view_ids?: unknown;
        };
      };
      const type = node.type;

      if (['grid', 'board', 'calendar', 'list', 'gallery', 'chart'].includes(type ?? '')) {
        addId(node.data?.view_id);
        addId(node.data?.viewId);
        addId(node.data?.database_view_id);

        for (const values of [node.data?.view_ids, node.data?.viewIds, node.data?.database_view_ids]) {
          if (Array.isArray(values)) values.forEach(addId);
        }
      }

      Object.values(value).forEach(visit);
    };

    visit(editor?.children ?? []);

    return Array.from(ids);
  }, documentViewId);
}

async function embeddedDatabaseViewIdsFromTabs(page: Page): Promise<string[]> {
  const testIds = await page.locator('[data-testid^="view-tab-"]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('data-testid') ?? '')
      .filter((testId) => testId.startsWith('view-tab-'))
  );

  return Array.from(new Set(testIds.map((testId) => testId.replace(/^view-tab-/, '')).filter(Boolean)));
}

async function waitForEmbeddedDatabaseViewIds(page: Page, documentViewId: string): Promise<string[]> {
  await expect
    .poll(
      async () => {
        const editorIds = await embeddedDatabaseViewIdsFromEditor(page, documentViewId);

        if (editorIds.length > 0) return editorIds;

        return embeddedDatabaseViewIdsFromTabs(page);
      },
      { timeout: 30000 }
    )
    .not.toEqual([]);

  const editorIds = await embeddedDatabaseViewIdsFromEditor(page, documentViewId);

  return editorIds.length > 0 ? editorIds : embeddedDatabaseViewIdsFromTabs(page);
}

async function maybePublishedInfo(
  request: APIRequestContext,
  viewId: string
): Promise<PublishedInfo | undefined> {
  const response = await request.get(apiUrl(`/api/workspace/v1/published-info/${viewId}`), {
    failOnStatusCode: false,
  });
  const text = await response.text();

  if (!response.ok()) return undefined;

  const body = JSON.parse(text) as ApiResponse<PublishedInfo>;

  if (body.code !== 0 || body.data?.view_id !== viewId) return undefined;

  return body.data;
}

async function expectPublishedInfo(
  request: APIRequestContext,
  viewId: string
): Promise<PublishedInfo> {
  let latestBody = '';

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(apiUrl(`/api/workspace/v1/published-info/${viewId}`), {
      failOnStatusCode: false,
    });

    latestBody = await response.text();

    if (response.ok()) {
      const body = JSON.parse(latestBody) as ApiResponse<PublishedInfo>;

      if (body.code === 0 && body.data?.view_id === viewId) {
        expect(body.data.publish_name).toBeTruthy();
        return body.data;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`View was not published: ${viewId}. Last response: ${latestBody}`);
}

async function expectDatabaseSnapshot(
  request: APIRequestContext,
  publishedInfo: PublishedInfo
): Promise<void> {
  const response = await request.get(
    apiUrl(`/api/workspace/v2/published/${publishedInfo.namespace}/${publishedInfo.publish_name}/snapshot`),
    { failOnStatusCode: false }
  );
  const text = await response.text();

  expect(response.ok(), text).toBeTruthy();

  const body = JSON.parse(text) as ApiResponse<PublishedSnapshotPayload>;

  expect(body.code, text).toBe(0);
  expect(body.data?.kind, text).toBe('database');
  expect(body.data?.view.viewId, text).toBe(publishedInfo.view_id);
}

async function expectCommentsDoNotOverlapDatabase(page: Page): Promise<void> {
  const comments = page.getByTestId('global-comment');

  await expect(comments).toBeVisible({ timeout: 30000 });
  await comments.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const comment = document.querySelector('[data-testid="global-comment"]');
          const database = document.querySelector('[class*="appflowy-database"]');

          if (!comment || !database) return false;

          const commentRect = comment.getBoundingClientRect();
          const rows = Array.from(database.querySelectorAll('[data-row-id]'));

          return rows.every((row) => {
            const rowRect = row.getBoundingClientRect();

            return rowRect.bottom <= commentRect.top || rowRect.top >= commentRect.bottom;
          });
        }),
      { timeout: 10000 }
    )
    .toBe(true);
}

async function publishExistingPage(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string,
  publishName?: string
): Promise<PublishedInfo> {
  const existingInfo = await maybePublishedInfo(request, viewId);

  await apiVoidRequest(
    request,
    token,
    'POST',
    `/api/workspace/${workspaceId}/page-view/${viewId}/publish`,
    publishName || existingInfo?.publish_name
      ? { publish_name: publishName || existingInfo?.publish_name }
      : {}
  );

  return expectPublishedInfo(request, viewId);
}

async function unpublishIfPublished(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  viewId: string
): Promise<void> {
  const existingInfo = await maybePublishedInfo(request, viewId);

  if (!existingInfo) return;

  await apiVoidRequest(
    request,
    token,
    'POST',
    `/api/workspace/${workspaceId}/page-view/${viewId}/unpublish`
  );
}

async function expectNotPublished(
  request: APIRequestContext,
  viewId: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        return (await maybePublishedInfo(request, viewId)) ? 'published' : 'unpublished';
      },
      { timeout: 30000 }
    )
    .toBe('unpublished');
}

test.describe('Publish existing document with embedded database', () => {
  test.skip(!existingPassword, 'Set APPFLOWY_E2E_EXISTING_PASSWORD to run this seeded-workspace regression test.');
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('publishes embedded databases for Project Tracker 2', async ({
    page,
    request,
    browser,
  }) => {
    await signInWithPasswordViaUi(page, existingEmail, existingPassword!, 3000);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

    const token = await getAccessToken(page);
    const workspaceId = await currentWorkspaceId(page);
    const targetPage = await findExistingPage(request, token, workspaceId, targetPageName);

    await page.goto(`/app/${workspaceId}/${targetPage.view_id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(targetPageName, { timeout: 30000 });
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 30000 });

    const embeddedViewIds = await waitForEmbeddedDatabaseViewIds(page, targetPage.view_id);

    expect(embeddedViewIds.length, 'Expected the target document to contain at least one embedded database view').toBeGreaterThan(0);
    testLog.info(`Embedded database view IDs: ${embeddedViewIds.join(', ')}`);

    const previousParentPublishInfo = await maybePublishedInfo(request, targetPage.view_id);

    await unpublishIfPublished(request, token, workspaceId, targetPage.view_id);
    await expectNotPublished(request, targetPage.view_id);

    for (const embeddedViewId of embeddedViewIds) {
      await unpublishIfPublished(request, token, workspaceId, embeddedViewId);
      await expectNotPublished(request, embeddedViewId);
    }

    const parentPublishInfo = await publishExistingPage(
      request,
      token,
      workspaceId,
      targetPage.view_id,
      previousParentPublishInfo?.publish_name
    );
    const publishedUrl = new URL(
      `/${parentPublishInfo.namespace}/${parentPublishInfo.publish_name}`,
      TestConfig.baseUrl
    ).toString();

    for (const embeddedViewId of embeddedViewIds) {
      const publishedInfo = await expectPublishedInfo(request, embeddedViewId);

      await expectDatabaseSnapshot(request, publishedInfo);
    }

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();

    setupPageErrorHandling(publicPage);
    await publicPage.goto(publishedUrl, { waitUntil: 'load' });

    await expect(publicPage.locator('body')).toContainText(targetPageName, { timeout: 30000 });
    await expect(publicPage.locator('body')).not.toContainText("This page hasn't been published yet");
    await expect(publicPage.locator('[class*="appflowy-database"]').last()).toBeVisible({ timeout: 30000 });
    await expect(publicPage.locator('[data-testid="database-grid"]').last()).toBeVisible({ timeout: 30000 });
    await expectCommentsDoNotOverlapDatabase(publicPage);

    await publicContext.close();
  });
});
