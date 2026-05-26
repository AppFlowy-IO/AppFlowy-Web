import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before } = createBdd();

type ReorderState = {
  trackedWorkspaces: Array<{ name: string; id: string }>;
  lastDragAutoScrolled?: boolean;
  reorderRequestWorkspaceIds?: string[][];
  completedReorderSaveCount?: number;
  firstReorderSaveStarted?: Promise<void>;
  firstReorderSaveCompleted?: Promise<void>;
  releaseFirstReorderSave?: () => void;
};

const stateByPage = new WeakMap<Page, ReorderState>();

Before(async ({ page }) => {
  stateByPage.delete(page);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

Given(
  'I am signed in with three new workspaces named {string}, {string}, {string}',
  async ({ page, request }, name1: string, name2: string, name3: string) => {
    await signInWithNewWorkspaces(page, request, [name1, name2, name3]);
  }
);

Given('I am signed in with {int} new workspaces named {string}', async ({ page, request }, count: number, prefix: string) => {
  const names = Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')}`);

  await signInWithNewWorkspaces(page, request, names);
});

Given('workspace reorder saves are delayed', async ({ page }) => {
  const state = requireState(page);
  const firstStarted = createDeferred<void>();
  const firstCompleted = createDeferred<void>();
  const releaseFirst = createDeferred<void>();

  state.reorderRequestWorkspaceIds = [];
  state.completedReorderSaveCount = 0;
  state.firstReorderSaveStarted = firstStarted.promise;
  state.firstReorderSaveCompleted = firstCompleted.promise;
  state.releaseFirstReorderSave = () => releaseFirst.resolve();

  await page.route(/\/api\/workspace\/reorder(?:\?|$)/, async (route) => {
    const requestIndex = (state.reorderRequestWorkspaceIds?.length ?? 0) + 1;

    state.reorderRequestWorkspaceIds?.push(getReorderRequestWorkspaceIds(route.request().postData()));

    if (requestIndex === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }

    const response = await route.fetch();

    await route.fulfill({ response });
    state.completedReorderSaveCount = (state.completedReorderSaveCount ?? 0) + 1;

    if (requestIndex === 1) {
      firstCompleted.resolve();
    }
  });
});

When('the first workspace reorder save has started', async ({ page }) => {
  const state = requireState(page);

  if (!state.firstReorderSaveStarted) {
    throw new Error('Workspace reorder saves were not configured to be delayed');
  }

  await state.firstReorderSaveStarted;
});

When('I open the workspace dropdown', async ({ page }) => {
  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  // Wait for the WorkspaceList's internal refetch to settle so the rendered
  // order reflects server state, not a stale snapshot.
  await page.waitForTimeout(800);
});

When('I close the workspace dropdown', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(WorkspaceSelectors.dropdownContent(page)).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(300);
});

When(
  'I drag workspace {string} above workspace {string}',
  async ({ page }, sourceName: string, targetName: string) => {
    await dragWorkspaceItem(page, sourceName, targetName, 'top');
  }
);

When(
  'I drag workspace {string} to the bottom edge of the workspace list until it reaches the end',
  async ({ page }, sourceName: string) => {
    const state = requireState(page);

    state.lastDragAutoScrolled = await dragWorkspaceItemToListEndWithAutoScroll(page, sourceName);
  }
);

When('the delayed workspace reorder save completes', async ({ page }) => {
  const state = requireState(page);

  if (!state.releaseFirstReorderSave || !state.firstReorderSaveCompleted) {
    throw new Error('Workspace reorder saves were not configured to be delayed');
  }

  state.releaseFirstReorderSave();
  await state.firstReorderSaveCompleted;
});

Then('the workspace dropdown list is scrollable', async ({ page }) => {
  await expect
    .poll(
      () =>
        WorkspaceSelectors.list(page).evaluate((element) => {
          return element.scrollHeight > element.clientHeight;
        }),
      {
        message: 'expected workspace dropdown list to overflow vertically',
        timeout: 5000,
      }
    )
    .toBe(true);
});

Then('the workspace dropdown list scrolled during the drag', async ({ page }) => {
  expect(requireState(page).lastDragAutoScrolled).toBe(true);
});

Then('only one workspace reorder save has started while the first save is pending', async ({ page }) => {
  const state = requireState(page);

  await page.waitForTimeout(500);
  expect(state.reorderRequestWorkspaceIds ?? []).toHaveLength(1);
});

Then(
  'the latest workspace reorder save contains tracked workspaces in order {string}',
  async ({ page }, expectedCsv: string) => {
    const state = requireState(page);
    const expected = parseOrderedNames(expectedCsv);

    await expect
      .poll(
        () => ({
          completed: state.completedReorderSaveCount ?? 0,
          started: state.reorderRequestWorkspaceIds?.length ?? 0,
        }),
        {
          message: 'expected both serialized workspace reorder saves to complete',
          timeout: 10000,
        }
      )
      .toEqual({ completed: 2, started: 2 });

    const reorderRequests = state.reorderRequestWorkspaceIds ?? [];
    const latestIds = reorderRequests[reorderRequests.length - 1] ?? [];

    expect(mapTrackedIdsToNames(state, latestIds)).toEqual(expected);
  }
);

Then(
  'the tracked workspaces appear in order {string}',
  async ({ page }, expectedCsv: string) => {
    const state = requireState(page);
    const expected = parseOrderedNames(expectedCsv);
    const tracked = new Set(state.trackedWorkspaces.map((workspace) => workspace.name));

    await expect
      .poll(
        async () => {
          const all = await WorkspaceSelectors.itemName(page).allInnerTexts();
          return all.map((text) => text.trim()).filter((name) => tracked.has(name));
        },
        {
          message: `expected tracked workspaces in order ${JSON.stringify(expected)}`,
          timeout: 10000,
        }
      )
      .toEqual(expected);
  }
);

async function signInWithNewWorkspaces(page: Page, request: APIRequestContext, names: string[]): Promise<void> {
  await signInAndWaitForApp(page, request, generateRandomEmail());
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  const token = await getAuthToken(page);

  if (!token) {
    throw new Error('Cannot create workspaces: no auth token in browser storage');
  }

  const trackedWorkspaces: ReorderState['trackedWorkspaces'] = [];

  for (const name of names) {
    trackedWorkspaces.push({
      id: await createWorkspaceViaApi(request, token, name),
      name,
    });
  }

  stateByPage.set(page, { trackedWorkspaces });

  // Reload so the newly-created workspaces are picked up by the in-memory
  // userWorkspaceInfo context that hydrates the dropdown.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

async function dragWorkspaceItem(
  page: Page,
  sourceName: string,
  targetName: string,
  edge: 'top' | 'bottom'
): Promise<void> {
  const sourceItem = workspaceItemByName(page, sourceName);
  const targetItem = workspaceItemByName(page, targetName);

  await expect(sourceItem).toBeVisible({ timeout: 10000 });
  await expect(targetItem).toBeVisible({ timeout: 10000 });

  const sourceBox = await sourceItem.boundingBox();
  const targetBox = await targetItem.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not measure workspace item bounding boxes');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY =
    edge === 'top'
      ? targetBox.y + targetBox.height * 0.15
      : targetBox.y + targetBox.height * 0.85;

  // Mirrors the editor block drag pattern (playwright/e2e/editor/editor-basic.spec.ts):
  // pragmatic-drag-and-drop responds to native HTML5 drag events triggered by
  // Chromium when mouse movement crosses the drag threshold on a draggable element.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  // Wait for the optimistic update + server PUT /api/workspace/reorder + refetch.
  await page.waitForTimeout(1500);
}

async function dragWorkspaceItemToListEndWithAutoScroll(page: Page, sourceName: string): Promise<boolean> {
  const sourceItem = workspaceItemByName(page, sourceName);
  const scrollContainer = WorkspaceSelectors.list(page);

  await expect(sourceItem).toBeVisible({ timeout: 10000 });
  await expect(scrollContainer).toBeVisible({ timeout: 10000 });
  await scrollContainer.evaluate((element) => {
    element.scrollTop = 0;
  });

  const sourceBox = await sourceItem.boundingBox();
  const containerBox = await scrollContainer.boundingBox();

  if (!sourceBox || !containerBox) {
    throw new Error('Could not measure workspace item or list bounding boxes');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const edgeX = containerBox.x + containerBox.width / 2;
  const edgeY = containerBox.y + containerBox.height - 8;
  let mouseDown = false;
  let didScroll = false;

  try {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    mouseDown = true;
    await page.waitForTimeout(150);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await page.mouse.move(edgeX, edgeY, { steps: 5 });
      await page.waitForTimeout(100);

      const scrollState = await scrollContainer.evaluate((element) => ({
        maxScrollTop: element.scrollHeight - element.clientHeight,
        scrollTop: element.scrollTop,
      }));

      didScroll = didScroll || scrollState.scrollTop > 0;

      if (didScroll && scrollState.scrollTop >= scrollState.maxScrollTop - 2) {
        break;
      }
    }

    if (!didScroll) {
      throw new Error('Workspace list did not auto-scroll while dragging near its bottom edge');
    }

    await page.mouse.move(edgeX, edgeY, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    mouseDown = false;
    await page.waitForTimeout(1500);

    return didScroll;
  } catch (error) {
    if (mouseDown) {
      await page.mouse.up();
    }

    throw error;
  }
}

function workspaceItemByName(page: Page, name: string) {
  return WorkspaceSelectors.item(page).filter({ hasText: name }).first();
}

function parseOrderedNames(csv: string): string[] {
  return csv
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function requireState(page: Page): ReorderState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Reorder scenario state was not initialized');
  }

  return state;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function getReorderRequestWorkspaceIds(postData: string | null): string[] {
  if (!postData) return [];

  try {
    const body = JSON.parse(postData) as { workspace_ids?: unknown };

    if (!Array.isArray(body.workspace_ids)) return [];

    return body.workspace_ids.map(String);
  } catch {
    return [];
  }
}

function mapTrackedIdsToNames(state: ReorderState, workspaceIds: string[]): string[] {
  const nameById = new Map(state.trackedWorkspaces.map((workspace) => [workspace.id, workspace.name]));

  return workspaceIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => Boolean(name));
}

async function createWorkspaceViaApi(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<string> {
  const response = await request.post(`${TestConfig.apiUrl}/api/workspace`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { workspace_name: name },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: { workspace_id?: string };
  } | null;

  if (!response.ok() || body?.code !== 0 || !body.data?.workspace_id) {
    throw new Error(
      `Failed to create workspace "${name}": HTTP ${response.status()} ${JSON.stringify(body)}`
    );
  }

  return body.data.workspace_id;
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
