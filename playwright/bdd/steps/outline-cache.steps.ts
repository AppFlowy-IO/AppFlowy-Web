import { APIRequestContext, expect, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

const CACHED_CHILD_ID = 'bdd-disk-cached-child-id';
const CACHED_CHILD_NAME = 'Disk cached child';
const REFRESHED_CHILD_ID = 'bdd-refreshed-child-id';
const REFRESHED_CHILD_NAME = 'Server refreshed child';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type OutlineCacheState = {
  workspaceId?: string;
  ownerToken?: string;
  ownerUserId?: string;
  targetSpaceId?: string;
  targetSpaceName?: string;
  refreshStarted?: boolean;
  refreshRelease?: Deferred<void>;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UserWorkspaceInfoPayload = {
  visiting_workspace: {
    workspace_id: string;
  };
};

type CreateViewPayload = {
  view_id: string;
};

type CachedViewPayload = {
  view_id: string;
  name: string;
  icon: null;
  layout: number;
  extra: Record<string, unknown> | null;
  children: CachedViewPayload[];
  has_children?: boolean;
  is_published: boolean;
  is_private: boolean;
  parent_view_id?: string;
};

const stateByPage = new WeakMap<Page, OutlineCacheState>();

Before(async ({ page }) => {
  stateByPage.delete(page);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

Given('I am signed in for sidebar outline cache testing', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });
  await waitForSidebarReady(page);
  const ownerToken = await getAuthToken(page);

  stateByPage.set(page, {
    workspaceId: await getCurrentWorkspaceId(request, ownerToken),
    ownerToken,
    ownerUserId: await getAuthUserId(page),
  });
});

Given('a temporary sidebar space has disk cached children', async ({ page, request }) => {
  const state = getState(page);
  const targetSpaceName = `BDD cached space ${Date.now()}`;
  const createdSpace = await postApi<CreateViewPayload>(
    request,
    requireOwnerToken(state),
    `/api/workspace/${requireWorkspaceId(state)}/space`,
    {
      name: targetSpaceName,
      space_icon: '',
      space_icon_color: '#00BCF0',
      space_permission: 0,
    }
  );
  const targetSpaceId = createdSpace.view_id;

  state.targetSpaceId = targetSpaceId;
  state.targetSpaceName = targetSpaceName;

  await seedDiskCachedSubtree(page, requireOwnerUserId(state), requireWorkspaceId(state), targetSpaceId, targetSpaceName);
  await clearSidebarExpansionState(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForSidebarSpace(page, targetSpaceId);
  await expect(page.getByTestId(`space-${targetSpaceId}`)).toHaveAttribute('data-expanded', 'false', { timeout: 15000 });
});

Given('the temporary sidebar space subtree refresh is delayed', async ({ page }) => {
  const state = getState(page);
  const release = createDeferred<void>();

  state.refreshRelease = release;
  state.refreshStarted = false;

  await page.route('**/api/workspace/*/view/*', async (route) => {
    if (!isTargetSubtreeRequest(route, requireWorkspaceId(state), requireTargetSpaceId(state))) {
      await route.continue();
      return;
    }

    state.refreshStarted = true;
    await release.promise;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: createSpacePayload(requireTargetSpaceId(state), requireTargetSpaceName(state), [
          createChildPayload(REFRESHED_CHILD_ID, REFRESHED_CHILD_NAME, requireTargetSpaceId(state)),
        ]),
      }),
    });
  });
});

When('I expand the cached sidebar space', async ({ page }) => {
  const targetSpaceId = requireTargetSpaceId(getState(page));

  await page.getByTestId(`space-${targetSpaceId}`).click({ force: true });
});

Then('the sidebar shows the disk cached child before the server refresh completes', async ({ page }) => {
  await expect
    .poll(() => Boolean(getState(page).refreshStarted), {
      timeout: 15000,
      message: 'expected the server subtree refresh request to start',
    })
    .toBe(true);

  await expect(page.getByTestId(`page-${CACHED_CHILD_ID}`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`page-${REFRESHED_CHILD_ID}`)).toHaveCount(0);
});

When('the delayed sidebar refresh completes', async ({ page }) => {
  const release = getState(page).refreshRelease;

  if (!release) {
    throw new Error('Sidebar refresh release was not initialized');
  }

  release.resolve();
});

Then('the sidebar shows the refreshed child from the server', async ({ page }) => {
  await expect(page.getByTestId(`page-${REFRESHED_CHILD_ID}`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId(`page-${CACHED_CHILD_ID}`)).toHaveCount(0);
});

async function waitForSidebarReady(page: Page) {
  await expect(page.locator('[data-testid="space-item"]').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-testid="page-item"]').first()).toBeVisible({ timeout: 60000 });
}

async function waitForSidebarSpace(page: Page, targetSpaceId: string) {
  await expect(page.locator('[data-testid="space-item"]').first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId(`space-${targetSpaceId}`)).toBeVisible({ timeout: 60000 });
}

async function clearSidebarExpansionState(page: Page) {
  await page.evaluate(() => {
    window.localStorage.setItem('outline_expanded', JSON.stringify({}));
  });
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const tokenData = JSON.parse(localStorage.getItem('token') || '{}') as { access_token?: string };
    return tokenData.access_token || localStorage.getItem('af_auth_token');
  });

  if (!token) {
    throw new Error('No auth token found in browser localStorage');
  }

  return token;
}

async function getAuthUserId(page: Page): Promise<string> {
  const userId = await page.evaluate(() => {
    const tokenData = JSON.parse(localStorage.getItem('token') || '{}') as { user?: { id?: string } };

    return tokenData.user?.id;
  });

  if (!userId) {
    throw new Error('No auth user id found in browser localStorage');
  }

  return userId;
}

async function getCurrentWorkspaceId(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.get(`${TestConfig.apiUrl}/api/user/workspace`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    failOnStatusCode: false,
  });
  const payload = unwrapApiResponse<UserWorkspaceInfoPayload>(response.status(), await response.text());
  const workspaceId = payload.visiting_workspace?.workspace_id;

  if (!workspaceId) {
    throw new Error(`No visiting workspace id in /api/user/workspace response: ${JSON.stringify(payload)}`);
  }

  return workspaceId;
}

async function postApi<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data,
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

async function seedDiskCachedSubtree(
  page: Page,
  userId: string,
  workspaceId: string,
  targetSpaceId: string,
  targetSpaceName: string
) {
  const cachedSpace = createSpacePayload(targetSpaceId, targetSpaceName, [
    createChildPayload(CACHED_CHILD_ID, CACHED_CHILD_NAME, targetSpaceId),
  ]);

  await page.evaluate(
    ({ userId: activeUserId, workspaceId: activeWorkspaceId, viewId, data }) =>
      new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open('af_database_cache');

        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;

          if (!db.objectStoreNames.contains('app_view_cache')) {
            db.close();
            reject(new Error('IndexedDB store app_view_cache does not exist'));
            return;
          }

          const transaction = db.transaction('app_view_cache', 'readwrite');
          const store = transaction.objectStore('app_view_cache');

          store.put({
            user_id: activeUserId,
            workspace_id: activeWorkspaceId,
            view_id: viewId,
            data,
            updated_at: Date.now(),
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            const error = transaction.error;
            db.close();
            reject(error);
          };
        };
      }),
    {
      userId,
      workspaceId,
      viewId: targetSpaceId,
      data: cachedSpace,
    }
  );
}

function isTargetSubtreeRequest(route: Route, workspaceId: string, targetSpaceId: string): boolean {
  const request = route.request();

  if (request.method() !== 'GET') return false;

  const url = new URL(request.url());
  const match = url.pathname.match(/\/api\/workspace\/([^/]+)\/view\/([^/]+)$/);

  if (!match) return false;

  return match[1] === workspaceId && match[2] === targetSpaceId && url.searchParams.get('depth') === '1';
}

function createSpacePayload(viewId: string, name: string, children: CachedViewPayload[]): CachedViewPayload {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: 0,
    extra: { is_space: true },
    children,
    has_children: true,
    is_published: false,
    is_private: false,
  };
}

function createChildPayload(viewId: string, name: string, parentViewId: string): CachedViewPayload {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: 0,
    extra: null,
    children: [],
    has_children: false,
    is_published: false,
    is_private: false,
    parent_view_id: parentViewId,
  };
}

function getState(page: Page): OutlineCacheState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Outline cache test state was not initialized for this page');
  }

  return state;
}

function requireWorkspaceId(state: OutlineCacheState): string {
  if (!state.workspaceId) {
    throw new Error('Workspace id was not initialized');
  }

  return state.workspaceId;
}

function requireOwnerToken(state: OutlineCacheState): string {
  if (!state.ownerToken) {
    throw new Error('Owner auth token was not initialized');
  }

  return state.ownerToken;
}

function requireOwnerUserId(state: OutlineCacheState): string {
  if (!state.ownerUserId) {
    throw new Error('Owner user id was not initialized');
  }

  return state.ownerUserId;
}

function requireTargetSpaceId(state: OutlineCacheState): string {
  if (!state.targetSpaceId) {
    throw new Error('Target sidebar space id was not initialized');
  }

  return state.targetSpaceId;
}

function requireTargetSpaceName(state: OutlineCacheState): string {
  if (!state.targetSpaceName) {
    throw new Error('Target sidebar space name was not initialized');
  }

  return state.targetSpaceName;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function unwrapApiResponse<T>(status: number, rawBody: string): T {
  let body: ApiResponse<T> | undefined;

  try {
    body = rawBody ? (JSON.parse(rawBody) as ApiResponse<T>) : undefined;
  } catch {
    throw new Error(`API returned non-JSON response with status ${status}: ${rawBody}`);
  }

  if (status < 200 || status >= 300 || body?.code !== 0) {
    throw new Error(`API request failed with status ${status}: ${rawBody}`);
  }

  return body.data as T;
}
