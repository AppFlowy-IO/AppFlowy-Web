/**
 * Publish Document with Embedded Database
 *
 * Regression coverage for documents that contain inline database views.
 * Publishing the document must also publish the embedded database view so the
 * public document can load that database snapshot.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  ShareSelectors,
  SidebarSelectors,
} from '../../support/selectors';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { testLog } from '../../support/test-helpers';

type ApiResponse<T> = {
  code: number;
  data?: T;
  message: string;
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

type WorkspaceView = {
  view_id: string;
  name: string;
  children?: WorkspaceView[];
};

type CreatePageResponse = {
  view_id: string;
  database_id?: string;
};

const ViewLayout = {
  Document: 0,
  Grid: 1,
} as const;

function apiUrl(path: string): string {
  return new URL(path, TestConfig.apiUrl).toString();
}

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('af_auth_token'));

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

async function setupDocumentWithEmbeddedDatabase(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  documentText: string
): Promise<{ documentViewId: string; embeddedViewId: string }> {
  const folder = await apiRequest<WorkspaceView>(
    request,
    token,
    'GET',
    `/api/workspace/${workspaceId}/folder?depth=2`
  );
  const generalSpace = folder.children?.find(view => view.name === 'General') ?? folder.children?.[0];

  expect(generalSpace?.view_id).toBeTruthy();

  const document = await apiRequest<CreatePageResponse>(
    request,
    token,
    'POST',
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: generalSpace!.view_id,
      layout: ViewLayout.Document,
      name: documentText,
      page_data: {
        type: 'page',
        children: [
          {
            type: 'paragraph',
            data: {
              delta: [{ insert: documentText }],
            },
          },
        ],
      },
    }
  );

  const embeddedDatabase = await apiRequest<CreatePageResponse>(
    request,
    token,
    'POST',
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: document.view_id,
      layout: ViewLayout.Grid,
      name: 'Embedded tracker',
    }
  );

  expect(embeddedDatabase.database_id).toBeTruthy();

  await apiVoidRequest(
    request,
    token,
    'POST',
    `/api/workspace/${workspaceId}/page-view/${document.view_id}/append-block`,
    {
      blocks: [
        {
          type: 'grid',
          data: {
            database_id: embeddedDatabase.database_id,
            parent_id: document.view_id,
            view_id: embeddedDatabase.view_id,
            view_ids: [embeddedDatabase.view_id],
          },
        },
      ],
    }
  );

  return {
    documentViewId: document.view_id,
    embeddedViewId: embeddedDatabase.view_id,
  };
}

async function publishCurrentPage(page: Page): Promise<string> {
  await expect(ShareSelectors.shareButton(page)).toBeVisible({ timeout: 10000 });
  await ShareSelectors.shareButton(page).click({ force: true });
  await expect(ShareSelectors.sharePopover(page)).toBeVisible({ timeout: 5000 });

  await ShareSelectors.sharePopover(page).getByText('Publish', { exact: true }).click({ force: true });
  await expect(ShareSelectors.publishConfirmButton(page)).toBeVisible({ timeout: 10000 });
  await expect(ShareSelectors.publishConfirmButton(page)).toBeEnabled();
  await ShareSelectors.publishConfirmButton(page).click({ force: true });

  await expect(ShareSelectors.publishNamespace(page)).toBeVisible({ timeout: 30000 });

  const origin = new URL(page.url()).origin;
  const namespace = ((await ShareSelectors.publishNamespace(page).textContent()) ?? '').trim();
  const publishName = (await ShareSelectors.publishNameInput(page).inputValue()).trim();

  await page.keyboard.press('Escape');

  return `${origin}/${namespace}/${publishName}`;
}

async function expectPublishedInfo(
  request: APIRequestContext,
  embeddedViewId: string
): Promise<PublishedInfo> {
  let latestBody = '';

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(
      apiUrl(`/api/workspace/v1/published-info/${embeddedViewId}`),
      { failOnStatusCode: false }
    );

    latestBody = await response.text();

    if (response.ok()) {
      const body = JSON.parse(latestBody) as ApiResponse<PublishedInfo>;

      if (body.code === 0 && body.data?.view_id === embeddedViewId) {
        expect(body.data.publish_name).toBeTruthy();
        return body.data;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Embedded database view was not published: ${embeddedViewId}. Last response: ${latestBody}`);
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

  expect(body.code).toBe(0);
  expect(body.data?.kind).toBe('database');
  expect(body.data?.view.viewId).toBe(publishedInfo.view_id);
}

test.describe('Publish Document with Embedded Database', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('publishes embedded database view and renders it on the public document', async ({
    page,
    request,
    browser,
  }) => {
    const email = generateRandomEmail();

    await signInAndWaitForApp(page, request, email);
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });

    const documentText = `Document with published embedded database ${Date.now()}`;
    const token = await getAccessToken(page);
    const workspaceId = await currentWorkspaceId(page);
    const { documentViewId, embeddedViewId } = await setupDocumentWithEmbeddedDatabase(
      request,
      token,
      workspaceId,
      documentText
    );

    await page.goto(`/app/${workspaceId}/${documentViewId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(documentText, { timeout: 30000 });

    const publishedUrl = await publishCurrentPage(page);

    testLog.info(`Published document URL: ${publishedUrl}`);

    const publishedInfo = await expectPublishedInfo(request, embeddedViewId);

    await expectDatabaseSnapshot(request, publishedInfo);

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();

    setupPageErrorHandling(publicPage);
    await publicPage.goto(publishedUrl, { waitUntil: 'load' });

    await expect(publicPage.locator('body')).toContainText(documentText, { timeout: 30000 });
    await expect(publicPage.locator('body')).not.toContainText("This page hasn't been published yet");

    const publicDatabase = publicPage.locator('[class*="appflowy-database"]').last();

    await expect(publicDatabase).toBeVisible({ timeout: 30000 });
    await expect(publicDatabase.locator('[data-testid="database-grid"]')).toBeVisible({ timeout: 30000 });
    await expect(publicDatabase).toContainText('Name', { timeout: 30000 });

    await publicContext.close();
  });
});
