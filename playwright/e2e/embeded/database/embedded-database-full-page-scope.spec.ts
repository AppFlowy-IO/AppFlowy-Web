import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';

import { signUpAndLoginWithPasswordViaUi } from '../../../support/auth-flow-helpers';
import { insertInlineGridViaSlash } from '../../../support/duplicate-test-helpers';
import { createDocumentPageAndNavigate } from '../../../support/page-utils';
import { DatabaseViewSelectors, PageSelectors } from '../../../support/selectors';
import { generateRandomEmail } from '../../../support/test-config';

type FolderView = {
  view_id: string;
  parent_view_id: string;
  extra: string | { embedded?: boolean; database_id?: string; is_database_container?: boolean };
  children: FolderView[];
};

function extra(view: FolderView) {
  return typeof view.extra === 'string' ? JSON.parse(view.extra) : view.extra;
}

function workspaceId(page: Page): string {
  return new URL(page.url()).pathname.split('/')[2];
}

async function readServerData<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (apiPath) => {
    const token = JSON.parse(localStorage.getItem('token') || '{}').access_token;
    const response = await fetch(apiPath, {
      headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
    });
    const body = await response.json();

    if (!response.ok || body.code !== 0) {
      throw new Error(`Scope verification failed: HTTP ${response.status}, code ${body.code}`);
    }

    return body.data;
  }, path);
}

async function expectPersistedEmbeddedScope(page: Page, viewId: string, documentId: string): Promise<void> {
  const prefix = `/api/workspace/${workspaceId(page)}`;
  const child = await readServerData<FolderView>(page, `${prefix}/view/${viewId}?depth=1`);
  const container = await readServerData<FolderView>(page, `${prefix}/view/${child.parent_view_id}?depth=1`);

  expect(extra(child).embedded).toBe(true);
  expect(extra(container)).toMatchObject({
    embedded: true,
    is_database_container: true,
    database_id: extra(child).database_id,
  });
  expect(container.parent_view_id).toBe(documentId);
  expect(container.children.map((view) => view.view_id)).toContain(viewId);

  const content = await readServerData<{ data: { encoded_collab: number[] } }>(
    page,
    `${prefix}/page-view/${viewId}`
  );
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, new Uint8Array(content.data.encoded_collab));
    const database = doc.getMap('data').get('database') as Y.Map<unknown>;
    const views = database.get('views') as Y.Map<Y.Map<unknown>>;

    for (const sibling of container.children) {
      expect(extra(sibling)).toMatchObject({ embedded: true, database_id: extra(child).database_id });
      expect(views.get(sibling.view_id)?.get('embedded')).toBe(true);
    }
  } finally {
    doc.destroy();
  }
}

test.describe('Embedded database opened as a full page', () => {
  test('publishes a Calendar tab with the saved container scope and retains both tabs after reload', async ({
    page,
    request,
  }) => {
    await signUpAndLoginWithPasswordViaUi(page, request, generateRandomEmail());
    const documentId = await createDocumentPageAndNavigate(page);
    const createdGrid = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/page-view') &&
        response.request().postDataJSON()?.parent_view_id === documentId
    );

    await insertInlineGridViaSlash(page, documentId);
    const gridResponse = await (await createdGrid).json();

    expect(gridResponse.code).toBe(0);
    const gridId = gridResponse.data.view_id as string;

    await page.goto(`/app/${workspaceId(page)}/${gridId}`);
    await expect(DatabaseViewSelectors.viewTab(page, gridId)).toBeVisible();
    await expectPersistedEmbeddedScope(page, gridId, documentId);

    await DatabaseViewSelectors.addViewButton(page).click();
    const calendarRequest = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/database-view')
    );

    await DatabaseViewSelectors.viewTypeOption(page, 'Calendar').click();
    const calendarResponse = await calendarRequest;

    expect(calendarResponse.request().postDataJSON().embedded).toBe(true);
    expect(calendarResponse.ok()).toBe(true);
    const calendarBody = await calendarResponse.json();

    expect(calendarBody.code).toBe(0);
    const calendarId = calendarBody.data.view_id as string;

    await expect(DatabaseViewSelectors.viewTab(page, calendarId)).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page, gridId)).toBeVisible();
    await expectPersistedEmbeddedScope(page, calendarId, documentId);

    await page.reload();
    await expect(DatabaseViewSelectors.viewTab(page, calendarId)).toBeVisible();
    await expect(DatabaseViewSelectors.viewTab(page, gridId)).toBeVisible();
  });

  for (const layout of ['List', 'Gallery', 'Feed']) {
    test(`creates ${layout} from a document's sidebar add menu and preserves embedded scope`, async ({ page, request }) => {
      await signUpAndLoginWithPasswordViaUi(page, request, generateRandomEmail());
      const documentId = await createDocumentPageAndNavigate(page);
      const documentItem = PageSelectors.itemByViewId(page, documentId);

      await documentItem.locator(`:scope > [data-testid="page-${documentId}"]`).getByTestId('inline-add-page').click();
      await page.getByTestId(`add-${layout.toLowerCase()}-button`).click();
      await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(layout, { timeout: 30000 });

      const viewId = (await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid'))!.slice('view-tab-'.length);

      await expectPersistedEmbeddedScope(page, viewId, documentId);
      await page.reload();
      await expect(DatabaseViewSelectors.viewTab(page, viewId)).toBeVisible();
      await expect(DatabaseViewSelectors.activeViewTab(page)).toContainText(layout);
      await expectPersistedEmbeddedScope(page, viewId, documentId);
    });
  }
});
