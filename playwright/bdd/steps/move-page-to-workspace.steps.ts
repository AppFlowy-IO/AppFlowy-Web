import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { expandPageByName, expandSpaceByName } from '../../support/page-utils';
import { PageSelectors, ViewActionSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const VIEW_LAYOUT_DOCUMENT = 0;
const VIEW_LAYOUT_GRID = 1;

type TestWorkspace = {
  id: string;
  name: string;
  spaceName: string;
  spaceId: string;
};

type MovePageToWorkspaceState = {
  token?: string;
  originalWorkspaceId?: string;
  source?: TestWorkspace;
  target?: TestWorkspace;
  pageName?: string;
  pageId?: string;
  gridName?: string;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

const stateByPage = new WeakMap<Page, MovePageToWorkspaceState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {});
});

After(async ({ page, request }) => {
  const state = requireState(page);

  if (!state.token) return;

  if (state.originalWorkspaceId) {
    await apiRequestAllowFailure(request, state.token, 'put', `/api/workspace/${state.originalWorkspaceId}/open`);
  }

  for (const workspaceId of [state.target?.id, state.source?.id]) {
    if (workspaceId) {
      await apiRequestAllowFailure(request, state.token, 'delete', `/api/workspace/${workspaceId}`);
    }
  }
});

Given(
  'I am signed in with a page containing an embedded database in a source workspace and a separate target workspace',
  async ({ page, request }) => {
    const state = requireState(page);
    const runId = Date.now().toString(36);

    await signInAndWaitForApp(page, request, generateRandomEmail(), 1000);
    await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

    const token = await getAuthToken(page);

    if (!token) {
      throw new Error('Cannot prepare move-to-workspace scenario: no auth token in browser storage');
    }

    state.token = token;
    state.originalWorkspaceId = workspaceIdFromUrl(page.url());
    state.pageName = `BDD Moved Page ${runId}`;

    const sourceName = `BDD Move Source ${runId}`;
    const targetName = `BDD Move Target ${runId}`;
    const sourceId = await createWorkspace(request, token, sourceName);
    const targetId = await createWorkspace(request, token, targetName);

    await openWorkspace(request, token, sourceId);
    const sourceSpaceName = `BDD Source Space ${runId}`;
    const sourceSpaceId = await createSpace(request, token, sourceId, sourceSpaceName);

    state.pageId = await createDocumentPage(request, token, sourceId, sourceSpaceId, state.pageName);

    // Embed an inline database in the page: create a grid under the page and
    // reference it from the document content with a grid block.
    state.gridName = `BDD Embedded Grid ${runId}`;
    const grid = await createGridPage(request, token, sourceId, state.pageId, state.gridName);

    await appendGridBlock(request, token, sourceId, state.pageId, grid);
    await waitForDocumentToReference(request, token, sourceId, state.pageId, grid.viewId);

    await openWorkspace(request, token, targetId);
    const targetSpaceName = `BDD Target Space ${runId}`;
    const targetSpaceId = await createSpace(request, token, targetId, targetSpaceName);

    await openWorkspace(request, token, sourceId);

    state.source = { id: sourceId, name: sourceName, spaceName: sourceSpaceName, spaceId: sourceSpaceId };
    state.target = { id: targetId, name: targetName, spaceName: targetSpaceName, spaceId: targetSpaceId };

    await page.goto(`/app/${sourceId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('current-workspace-name')).toHaveText(sourceName, { timeout: 30000 });
    await expandSpaceByName(page, sourceSpaceName);
    await expect(PageSelectors.nameContaining(page, state.pageName).first()).toBeVisible({ timeout: 30000 });
  }
);

When('I move the page to the target workspace space', async ({ page }) => {
  const state = requireState(page);
  const target = requireTarget(state);
  const pageName = requirePageName(state);

  // Open the sidebar more-actions menu for the page.
  await PageSelectors.itemByName(page, pageName).hover();
  await PageSelectors.moreActionsButton(page, pageName).click();
  await expect(ViewActionSelectors.popover(page)).toBeVisible({ timeout: 15000 });

  // Open the "Move to" picker and switch the destination workspace via the
  // selector at the right of the search input.
  await ViewActionSelectors.moveToButton(page).click();
  await ViewActionSelectors.moveWorkspaceSelector(page).click({ timeout: 15000 });
  await page.getByTestId(`move-to-workspace-option-${target.id}`).click({ timeout: 15000 });

  // Then the destination space inside the target workspace.
  await page.getByTestId(`move-to-workspace-target-${target.spaceId}`).click({ timeout: 30000 });
  await ViewActionSelectors.moveConfirmButton(page).click();

  // The move runs as an async server task; the success toast marks completion.
  await expect(page.getByText(`Moved to ${target.name}`)).toBeVisible({ timeout: 90000 });
});

Then('the page is no longer listed in the source workspace sidebar', async ({ page }) => {
  const state = requireState(page);
  const pageName = requirePageName(state);

  await expect(PageSelectors.nameContaining(page, pageName)).toHaveCount(0, { timeout: 30000 });
});

Then('the page is listed under the target workspace space', async ({ page }) => {
  const state = requireState(page);
  const target = requireTarget(state);
  const pageName = requirePageName(state);

  await page.goto(`/app/${target.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('current-workspace-name')).toHaveText(target.name, { timeout: 30000 });
  await expandSpaceByName(page, target.spaceName);
  await expect(PageSelectors.nameContaining(page, pageName).first()).toBeVisible({ timeout: 30000 });
});

Then('the embedded database is listed under the moved page', async ({ page }) => {
  const state = requireState(page);
  const pageName = requirePageName(state);

  if (!state.gridName) {
    throw new Error('Embedded grid name was not initialized');
  }

  // The deep copy re-mints ids, so assert by name: expanding the moved page
  // in the target workspace sidebar must reveal the duplicated grid view.
  await expandPageByName(page, pageName);
  await expect(PageSelectors.nameContaining(page, state.gridName).first()).toBeVisible({ timeout: 30000 });
});

async function createWorkspace(request: APIRequestContext, token: string, name: string): Promise<string> {
  const data = await apiRequest<{ workspace_id: string }>(request, token, 'post', '/api/workspace', {
    workspace_name: name,
  });

  if (!data.workspace_id) {
    throw new Error(`Workspace creation returned no id for "${name}"`);
  }

  return data.workspace_id;
}

async function createSpace(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string
): Promise<string> {
  const data = await apiRequest<{ view_id: string }>(request, token, 'post', `/api/workspace/${workspaceId}/space`, {
    name,
    space_icon: '',
    space_icon_color: '#00BCF0',
    space_permission: 0,
  });

  if (!data.view_id) {
    throw new Error(`Space creation returned no view id for "${name}"`);
  }

  return data.view_id;
}

async function createDocumentPage(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  parentViewId: string,
  name: string
): Promise<string> {
  const data = await apiRequest<{ view_id: string }>(
    request,
    token,
    'post',
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: parentViewId,
      layout: VIEW_LAYOUT_DOCUMENT,
      name,
    }
  );

  if (!data.view_id) {
    throw new Error(`Page creation returned no view id for "${name}"`);
  }

  return data.view_id;
}

async function openWorkspace(request: APIRequestContext, token: string, workspaceId: string): Promise<void> {
  await apiRequest<unknown>(request, token, 'put', `/api/workspace/${workspaceId}/open`);
}

type EmbeddedGrid = {
  viewId: string;
  databaseId: string;
};

async function createGridPage(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  parentViewId: string,
  name: string
): Promise<EmbeddedGrid> {
  const data = await apiRequest<{ view_id: string; database_id?: string }>(
    request,
    token,
    'post',
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: parentViewId,
      layout: VIEW_LAYOUT_GRID,
      name,
    }
  );

  if (!data.view_id || !data.database_id) {
    throw new Error(`Grid creation returned no view/database id for "${name}"`);
  }

  return { viewId: data.view_id, databaseId: data.database_id };
}

async function appendGridBlock(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  pageViewId: string,
  grid: EmbeddedGrid
): Promise<void> {
  await apiRequest<unknown>(request, token, 'post', `/api/workspace/${workspaceId}/page-view/${pageViewId}/append-block`, {
    blocks: [
      {
        type: 'grid',
        data: {
          view_id: grid.viewId,
          view_ids: [grid.viewId],
          database_id: grid.databaseId,
          parent_id: pageViewId,
        },
      },
    ],
  });
}

/**
 * Waits until the page's document collab references the embedded grid, so a
 * move started right after the setup sees the complete closure. Reads the
 * full collab (the same source the duplicate worker uses); the page-view
 * projection can lag behind appended blocks.
 */
async function waitForDocumentToReference(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  pageViewId: string,
  referencedViewId: string
): Promise<void> {
  const deadline = Date.now() + 30000;
  const collabTypeDocument = 0;

  for (;;) {
    const response = await request.get(
      `${TestConfig.apiUrl}/api/workspace/v1/${workspaceId}/collab/${pageViewId}?collab_type=${collabTypeDocument}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        failOnStatusCode: false,
      }
    );

    if (response.ok()) {
      const body = (await response.json()) as ApiResponse<{ doc_state?: number[] }>;
      const docState = body.data?.doc_state;

      // Yrs stores block attributes as UTF-8 runs, so the referenced view id
      // appears as a contiguous ASCII substring once the append landed.
      if (
        body.code === 0 &&
        docState &&
        Buffer.from(docState).toString('latin1').includes(referencedViewId)
      ) {
        return;
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(`Page ${pageViewId} never referenced embedded grid ${referencedViewId}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function apiRequest<T>(
  request: APIRequestContext,
  token: string,
  method: 'post' | 'put' | 'delete',
  path: string,
  data?: unknown
): Promise<T> {
  const response = await request[method](`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = (text ? JSON.parse(text) : null) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`${method.toUpperCase()} ${path} failed: HTTP ${response.status()} ${text}`);
  }

  return body.data as T;
}

async function apiRequestAllowFailure(
  request: APIRequestContext,
  token: string,
  method: 'put' | 'delete',
  path: string
): Promise<void> {
  await request[method](`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  }).catch(() => undefined);
}

function workspaceIdFromUrl(urlValue: string): string {
  const workspaceId = new URL(urlValue).pathname.split('/')[2];

  if (!workspaceId) {
    throw new Error(`Could not read workspace id from URL: ${urlValue}`);
  }

  return workspaceId;
}

async function getAuthToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const directToken = localStorage.getItem('af_auth_token');

    if (directToken) return directToken;

    const rawToken = localStorage.getItem('token');

    if (!rawToken) return '';

    try {
      return (JSON.parse(rawToken) as { access_token?: string }).access_token || '';
    } catch {
      return '';
    }
  });
}

function requireState(page: Page): MovePageToWorkspaceState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Move-to-workspace scenario state was not initialized');
  }

  return state;
}

function requireTarget(state: MovePageToWorkspaceState): TestWorkspace {
  if (!state.target) {
    throw new Error('Target workspace was not initialized');
  }

  return state.target;
}

function requirePageName(state: MovePageToWorkspaceState): string {
  if (!state.pageName) {
    throw new Error('Moved page name was not initialized');
  }

  return state.pageName;
}
