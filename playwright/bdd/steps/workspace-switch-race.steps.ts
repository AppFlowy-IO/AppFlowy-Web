import { APIRequestContext, expect, Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { SpaceSelectors, WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

type TestWorkspace = {
  id: string;
  name: string;
  spaceName: string;
};

type WorkspaceSwitchRaceState = {
  token?: string;
  originalWorkspaceId?: string;
  source?: TestWorkspace;
  target?: TestWorkspace;
  delayArmed: boolean;
  delayedRequestHandled: boolean;
  delayedRequestStarted?: Promise<void>;
  delayedRequestCompleted?: Promise<void>;
  releaseDelayedRequest?: () => void;
  staleSourceSpaceObserved?: boolean;
  observedSidebarStates?: Array<{ header: string | null; spaces: string[] }>;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

const stateByPage = new WeakMap<Page, WorkspaceSwitchRaceState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {
    delayArmed: false,
    delayedRequestHandled: false,
  });
});

After(async ({ page, request }) => {
  const state = requireState(page);

  state.releaseDelayedRequest?.();

  if (state.delayedRequestCompleted) {
    await Promise.race([
      state.delayedRequestCompleted.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  await cleanupWorkspaces(request, state);
});

Given('I am signed in with isolated source and target workspaces', async ({ page, request }) => {
  const state = requireState(page);
  const runId = Date.now().toString(36);

  await signInAndWaitForApp(page, request, generateRandomEmail(), 1000);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  const token = await getAuthToken(page);

  if (!token) {
    throw new Error('Cannot prepare workspace switch race: no auth token in browser storage');
  }

  state.token = token;
  state.originalWorkspaceId = workspaceIdFromUrl(page.url());
  state.source = {
    id: await createWorkspace(request, token, `BDD Slow Source ${runId}`),
    name: `BDD Slow Source ${runId}`,
    spaceName: `BDD Source Space ${runId}`,
  };
  state.target = {
    id: await createWorkspace(request, token, `BDD Target ${runId}`),
    name: `BDD Target ${runId}`,
    spaceName: `BDD Target Space ${runId}`,
  };

  await openWorkspace(request, token, state.source.id);
  await createSpace(request, token, state.source.id, state.source.spaceName);
  await openWorkspace(request, token, state.target.id);
  await createSpace(request, token, state.target.id, state.target.spaceName);
  await openWorkspace(request, token, state.source.id);

  await page.goto(`/app/${state.source.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('current-workspace-name')).toHaveText(state.source.name, { timeout: 30000 });
  await expect(spaceName(page, state.source.spaceName)).toBeVisible({ timeout: 30000 });
});

Given('the next source workspace outline response is delayed', async ({ page }) => {
  const state = requireState(page);
  const started = createDeferred<void>();
  const release = createDeferred<void>();
  const completed = createDeferred<void>();

  state.delayedRequestStarted = started.promise;
  state.delayedRequestCompleted = completed.promise;
  state.releaseDelayedRequest = () => release.resolve();

  await page.route('**/api/workspace/*/view/*', async (route) => {
    if (!state.delayArmed || state.delayedRequestHandled || !isRootOutlineRequest(route, requireSource(state).id)) {
      await route.continue();
      return;
    }

    state.delayedRequestHandled = true;

    try {
      const response = await route.fetch({
        headers: withoutConditionalRequestHeaders(route.request().headers()),
      });

      started.resolve();
      await release.promise;
      await route.fulfill({ response });
      completed.resolve();
    } catch (error) {
      started.reject(error);
      completed.reject(error);
      throw error;
    }
  });
});

When('I reload the source workspace while its outline response is delayed', async ({ page }) => {
  const state = requireState(page);

  if (!state.delayedRequestStarted) {
    throw new Error('The delayed source outline route was not configured');
  }

  state.delayArmed = true;
  await Promise.all([page.reload({ waitUntil: 'domcontentloaded' }), state.delayedRequestStarted]);

  await expect(page.getByTestId('current-workspace-name')).toHaveText(requireSource(state).name, {
    timeout: 30000,
  });
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30000 });
});

When('I switch to the target workspace', async ({ page }) => {
  const state = requireState(page);
  const target = requireTarget(state);

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  await workspaceItemByName(page, target.name).click();

  await expect(page).toHaveURL(new RegExp(`/app/${target.id}(?:/|$)`), { timeout: 30000 });
  await expect(page.getByTestId('current-workspace-name')).toHaveText(target.name, { timeout: 30000 });
});

Then('the target workspace outline is visible', async ({ page }) => {
  const state = requireState(page);

  await expect(spaceName(page, requireTarget(state).spaceName)).toBeVisible({ timeout: 30000 });
  await expect(spaceName(page, requireSource(state).spaceName)).toHaveCount(0);
});

When('the delayed source workspace outline response completes', async ({ page }) => {
  const state = requireState(page);
  const source = requireSource(state);
  const target = requireTarget(state);

  if (!state.releaseDelayedRequest || !state.delayedRequestCompleted) {
    throw new Error('The delayed source outline response was not configured');
  }

  await installSidebarMismatchObserver(page, target.name, source.spaceName);
  state.releaseDelayedRequest();
  await state.delayedRequestCompleted;
  await page.waitForTimeout(1500);

  const observation = await readSidebarMismatchObserver(page);

  state.staleSourceSpaceObserved = observation.observed;
  state.observedSidebarStates = observation.states;
});

Then('the target workspace never renders the source workspace space', async ({ page }) => {
  const state = requireState(page);

  expect(
    state.staleSourceSpaceObserved,
    `The previous workspace outline rendered after the switch. Observed sidebar states: ${JSON.stringify(
      state.observedSidebarStates
    )}`
  ).toBe(false);

  await expect(page.getByTestId('current-workspace-name')).toHaveText(requireTarget(state).name);
  await expect(spaceName(page, requireTarget(state).spaceName)).toBeVisible();
  await expect(spaceName(page, requireSource(state).spaceName)).toHaveCount(0);
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

async function createSpace(request: APIRequestContext, token: string, workspaceId: string, name: string): Promise<void> {
  await apiRequest<{ view_id: string }>(request, token, 'post', `/api/workspace/${workspaceId}/space`, {
    name,
    space_icon: '',
    space_icon_color: '#00BCF0',
    space_permission: 0,
  });
}

async function openWorkspace(request: APIRequestContext, token: string, workspaceId: string): Promise<void> {
  await apiRequest<unknown>(request, token, 'put', `/api/workspace/${workspaceId}/open`);
}

async function cleanupWorkspaces(request: APIRequestContext, state: WorkspaceSwitchRaceState): Promise<void> {
  if (!state.token) return;

  if (state.originalWorkspaceId) {
    await apiRequestAllowFailure(request, state.token, 'put', `/api/workspace/${state.originalWorkspaceId}/open`);
  }

  for (const workspaceId of [state.target?.id, state.source?.id]) {
    if (workspaceId) {
      await apiRequestAllowFailure(request, state.token, 'delete', `/api/workspace/${workspaceId}`);
    }
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

function isRootOutlineRequest(route: Route, workspaceId: string): boolean {
  const request = route.request();
  const url = new URL(request.url());

  return (
    request.method() === 'GET' &&
    url.pathname === `/api/workspace/${workspaceId}/view/${workspaceId}` &&
    url.searchParams.get('depth') === '6'
  );
}

function withoutConditionalRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };

  delete next['if-modified-since'];
  delete next['if-none-match'];

  return next;
}

async function installSidebarMismatchObserver(
  page: Page,
  targetWorkspaceName: string,
  sourceSpaceName: string
): Promise<void> {
  await page.evaluate(
    ({ targetWorkspaceName, sourceSpaceName }) => {
      type Observation = {
        observed: boolean;
        states: Array<{ header: string | null; spaces: string[] }>;
      };
      type ObservationWindow = Window & {
        __bddWorkspaceSwitchRace?: Observation & { observer?: MutationObserver };
      };
      const observation: Observation & { observer?: MutationObserver } = {
        observed: false,
        states: [],
      };
      const sample = () => {
        const header = document.querySelector('[data-testid="current-workspace-name"]')?.textContent?.trim() ?? null;
        const spaces = Array.from(document.querySelectorAll('[data-testid="space-name"]')).map(
          (element) => element.textContent?.trim() ?? ''
        );
        const previous = observation.states.at(-1);

        if (!previous || previous.header !== header || JSON.stringify(previous.spaces) !== JSON.stringify(spaces)) {
          observation.states.push({ header, spaces });
        }

        if (header === targetWorkspaceName && spaces.includes(sourceSpaceName)) {
          observation.observed = true;
        }
      };

      observation.observer = new MutationObserver(sample);
      observation.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      (window as ObservationWindow).__bddWorkspaceSwitchRace = observation;
      sample();
    },
    { targetWorkspaceName, sourceSpaceName }
  );
}

async function readSidebarMismatchObserver(
  page: Page
): Promise<{ observed: boolean; states: Array<{ header: string | null; spaces: string[] }> }> {
  return page.evaluate(() => {
    type ObservationWindow = Window & {
      __bddWorkspaceSwitchRace?: {
        observed: boolean;
        states: Array<{ header: string | null; spaces: string[] }>;
        observer?: MutationObserver;
      };
    };
    const observation = (window as ObservationWindow).__bddWorkspaceSwitchRace;

    observation?.observer?.disconnect();

    return {
      observed: observation?.observed ?? false,
      states: observation?.states ?? [],
    };
  });
}

function workspaceItemByName(page: Page, name: string) {
  return WorkspaceSelectors.item(page).filter({ hasText: name }).first();
}

function spaceName(page: Page, name: string) {
  return SpaceSelectors.names(page).filter({ hasText: name });
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

function requireState(page: Page): WorkspaceSwitchRaceState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Workspace switch race scenario state was not initialized');
  }

  return state;
}

function requireSource(state: WorkspaceSwitchRaceState): TestWorkspace {
  if (!state.source) {
    throw new Error('Source workspace was not initialized');
  }

  return state.source;
}

function requireTarget(state: WorkspaceSwitchRaceState): TestWorkspace {
  if (!state.target) {
    throw new Error('Target workspace was not initialized');
  }

  return state.target;
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
