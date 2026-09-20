import { expect, type Page, type Request, type Response } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import * as Y from 'yjs';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { verifyGithubSyncContent } from '../../support/github-sync-content-verifier';
import { expandSpaceByName } from '../../support/page-utils';
import { AccountSelectors, EditorSelectors, WorkspaceSelectors } from '../../support/selectors';
import { TestConfig } from '../../support/test-config';

import type {
  GitHubRepositoryProbe,
  GitHubSyncBinding,
  GitHubSyncConfiguration,
  GitHubSyncRun,
  GitHubSyncStatus,
} from '../../../src/application/integrations/github-sync';

const { Given, When, Then, After } = createBdd();
const REPOSITORY = 'AppFlowy-IO/AppFlowy-SelfHost-Commercial';
const SYNC_TIMEOUT_MS = 480_000;
const MANUAL_NAME = 'BDD unrelated documentation';
const MANUAL_TEXT = 'This manually authored page must survive the GitHub import unchanged.';

type PageCollab = {
  view: { view_id: string; name: string; parent_view_id: string };
  data: { encoded_collab: number[] };
};

type Verification = Awaited<ReturnType<typeof verifyGithubSyncContent>>;
type State = {
  workspaceId: string;
  spaceId: string;
  configuration: GitHubSyncConfiguration;
  createRequests: Array<Record<string, unknown>>;
  oauthRequests: number;
  popups: number;
  requestListener: (request: Request) => void;
  popupListener: () => void;
  bindingId?: string;
  runId?: string;
  status?: GitHubSyncStatus;
  verified?: Verification;
  openedPath?: string;
  manualPageId?: string;
  manualDocument?: unknown;
};

const scenarios = new WeakMap<Page, State>();

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name} explicitly for the live GitHub sync scenario.`);
  return value;
}

function stateFor(page: Page): State {
  const state = scenarios.get(page);

  if (!state) throw new Error('The live GitHub sync scenario has not initialized.');
  return state;
}

function workspacePath(workspaceId: string): string {
  return `/api/integrations/github/workspaces/${encodeURIComponent(workspaceId)}`;
}

function matchesResponse(response: Response, path: string, method: string): boolean {
  return new URL(response.url()).pathname === path && response.request().method() === method;
}

async function responseData<T>(response: Response): Promise<T> {
  expect(response.ok(), `GitHub sync HTTP status ${response.status()}`).toBe(true);
  const body = (await response.json()) as { code: number; data: T };

  expect(body.code, 'GitHub sync application response code').toBe(0);
  return body.data;
}

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const direct = localStorage.getItem('af_auth_token');

    if (direct) return direct;
    try {
      return (JSON.parse(localStorage.getItem('token') || '{}') as { access_token?: string }).access_token;
    } catch {
      return undefined;
    }
  });

  if (!token) throw new Error('The signed-in owner has no browser access token.');
  return token;
}

async function readApi<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${TestConfig.apiUrl.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
    timeout: 30_000,
  });

  expect(response.ok(), `Live API HTTP status ${response.status()}`).toBe(true);
  const body = (await response.json()) as { code: number; data: T };

  expect(body.code, 'Live API application response code').toBe(0);
  return body.data;
}

function documentData(collab: PageCollab): unknown {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, new Uint8Array(collab.data.encoded_collab));
    return doc.getMap('data').toJSON();
  } finally {
    doc.destroy();
  }
}

Given('the configured GitHub sync owner opens the unbound destination workspace', async ({ page, $testInfo }) => {
  $testInfo.setTimeout(600_000);
  const workspaceId = requiredEnvironment('GITHUB_SYNC_E2E_WORKSPACE_ID');
  const spaceId = requiredEnvironment('GITHUB_SYNC_E2E_SPACE_ID');

  await signInWithPasswordViaUi(
    page,
    requiredEnvironment('GITHUB_SYNC_E2E_OWNER_EMAIL'),
    requiredEnvironment('GITHUB_SYNC_E2E_OWNER_PASSWORD'),
    0
  );
  await page.goto(`/app/${encodeURIComponent(workspaceId)}`, { waitUntil: 'domcontentloaded' });
  await expect(WorkspaceSelectors.dropdownTrigger(page)).toBeVisible({ timeout: 30_000 });

  const configuration = await readApi<GitHubSyncConfiguration>(page, `${workspacePath(workspaceId)}/configuration`);

  expect(configuration).toMatchObject({
    available: true,
    can_manage: true,
    repository: REPOSITORY,
    branch: 'main',
    space_id: spaceId,
  });
  expect(configuration.root_path.replace(/^\/+|\/+$/g, '')).toBe('docs');
  expect(configuration.space_name).toBeTruthy();
  expect(configuration.existing_page_count, 'Provide a blank destination space for this import.').toBe(0);
  const existing = await readApi<{ bindings: GitHubSyncBinding[] }>(page, `${workspacePath(workspaceId)}/bindings`);

  expect(
    existing.bindings.filter((binding) => binding.space_id === spaceId),
    'Provide a fresh unbound destination; this live test never deletes or reuses an earlier import.'
  ).toHaveLength(0);

  const state: State = {
    workspaceId,
    spaceId,
    configuration,
    createRequests: [],
    oauthRequests: 0,
    popups: 0,
    requestListener: (request) => {
      const path = new URL(request.url()).pathname;

      if (request.method() === 'POST' && path === `${workspacePath(workspaceId)}/bindings`) {
        state.createRequests.push(request.postDataJSON() as Record<string, unknown>);
      }

      if (request.method() !== 'GET' && path.startsWith('/api/integrations/connect')) {
        state.oauthRequests += 1;
      }
    },
    popupListener: () => {
      state.popups += 1;
    },
  };

  scenarios.set(page, state);
  page.on('request', state.requestListener);
  page.on('popup', state.popupListener);

  const manualResponse = await page.request.post(
    `${TestConfig.apiUrl.replace(/\/$/, '')}/api/workspace/${workspaceId}/page-view`,
    {
      headers: { Authorization: `Bearer ${await accessToken(page)}` },
      data: {
        parent_view_id: spaceId,
        layout: 0,
        name: MANUAL_NAME,
        page_data: {
          type: 'page',
          children: [{ type: 'paragraph', data: { delta: [{ insert: MANUAL_TEXT }] } }],
        },
      },
    }
  );

  expect(manualResponse.ok()).toBe(true);
  const manual = (await manualResponse.json()) as { code: number; data: { view_id: string } };

  expect(manual.code).toBe(0);
  state.manualPageId = manual.data.view_id;
  const before = await readApi<PageCollab>(page, `/api/workspace/${workspaceId}/page-view/${state.manualPageId}`);

  state.manualDocument = documentData(before);
  expect(JSON.stringify(state.manualDocument)).toContain(MANUAL_TEXT);
});

When('the owner opens Add connection and selects GitHub', async ({ page }) => {
  const state = stateFor(page);

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await AccountSelectors.settingsButton(page).click();
  await expect(AccountSelectors.settingsDialog(page)).toBeVisible();
  await page.getByTestId('settings-menu-connections').click();
  await expect(page.getByTestId('connections-panel')).toBeVisible();
  await page.getByTestId('add-connection').click();
  const probeResponse = page.waitForResponse((response) =>
    matchesResponse(response, `${workspacePath(state.workspaceId)}/repository`, 'POST')
  );

  await page.getByTestId('add-github-sync').click();
  const response = await probeResponse;
  const probe = await responseData<GitHubRepositoryProbe>(response);

  expect(response.request().postDataJSON()).not.toHaveProperty('connection_id');
  expect(probe).toMatchObject({ status: 'ready', repository: { full_name: REPOSITORY, private: false } });
  await expect(page.getByTestId('github-sync-dialog')).toBeVisible();
});

Then('the configured commercial documentation source needs no GitHub account', async ({ page }) => {
  const state = stateFor(page);
  const dialog = page.getByTestId('github-sync-dialog');

  await expect(dialog.getByText('Public repository · No GitHub sign-in required')).toBeVisible();
  await expect(dialog.getByText(REPOSITORY, { exact: true })).toBeVisible();
  await expect(dialog.getByText('main', { exact: true })).toBeVisible();
  await expect(dialog.getByText('/docs', { exact: true })).toBeVisible();
  await expect(dialog.getByText(state.configuration.space_name!, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Connect GitHub/ })).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  expect(state.oauthRequests).toBe(0);
  expect(state.popups).toBe(0);
});

When('the owner reviews the source and starts GitHub sync', async ({ page }) => {
  const state = stateFor(page);
  const dialog = page.getByTestId('github-sync-dialog');

  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText(/Synced pages will be read-only in AppFlowy/)).toBeVisible();
  const createdResponse = page.waitForResponse((response) =>
    matchesResponse(response, `${workspacePath(state.workspaceId)}/bindings`, 'POST')
  );

  await dialog.getByRole('button', { name: 'Start sync', exact: true }).click();
  const created = await responseData<{ binding: GitHubSyncBinding; run: GitHubSyncRun }>(await createdResponse);

  state.bindingId = created.binding.id;
  state.runId = created.run.id;
  expect(created.binding).toMatchObject({
    workspace_id: state.workspaceId,
    space_id: state.spaceId,
    authentication_mode: 'public',
    connection_id: null,
  });
  expect(state.createRequests).toHaveLength(1);
  expect(state.createRequests[0]).not.toHaveProperty('connection_id');
  expect(state.createRequests[0]).toMatchObject({ space_id: state.spaceId, branch: 'main' });
});

When('the owner closes and reopens the durable GitHub sync', async ({ page }) => {
  const state = stateFor(page);
  const dialog = page.getByTestId('github-sync-dialog');

  await dialog
    .getByRole('button', { name: /^(Close|Done)$/ })
    .last()
    .click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('github-sync-open').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start sync', exact: true })).toHaveCount(0);
  const status = await readApi<GitHubSyncStatus>(
    page,
    `${workspacePath(state.workspaceId)}/bindings/${state.bindingId}`
  );

  expect(status.binding.id).toBe(state.bindingId);
  expect(status.run?.id).toBe(state.runId);
  expect(state.createRequests).toHaveLength(1);
});

Then('GitHub sync completes with actual persisted pages in the configured space', async ({ page }) => {
  const state = stateFor(page);
  const dialog = page.getByTestId('github-sync-dialog');

  await expect(dialog.getByRole('heading', { name: 'Sync completed', exact: true })).toBeVisible({
    timeout: SYNC_TIMEOUT_MS,
  });
  const status = await readApi<GitHubSyncStatus>(
    page,
    `${workspacePath(state.workspaceId)}/bindings/${state.bindingId}`
  );

  expect(status.binding).toMatchObject({
    id: state.bindingId,
    space_id: state.spaceId,
    authentication_mode: 'public',
    connection_id: null,
    status: 'synced',
    enabled: true,
    last_error: null,
  });
  expect(status.run).toMatchObject({ id: state.runId, status: 'completed' });
  expect(status.binding.last_applied_commit).toMatch(/^[a-f0-9]{40}$/);
  expect(status.run?.source_commit_sha).toBe(status.binding.last_applied_commit);
  expect(status.entries.every((entry) => entry.lifecycle === 'active' && entry.last_error === null)).toBe(true);
  const pages = status.entries.filter((entry) => entry.kind === 'file');
  const folders = status.entries.filter((entry) => entry.kind === 'directory');

  expect(pages.length).toBeGreaterThan(0);
  expect(pages.every((entry) => entry.source_commit_sha === status.binding.last_applied_commit)).toBe(true);
  await expect(dialog.locator('dt', { hasText: /^Synced pages$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(
    String(pages.length)
  );
  await expect(dialog.locator('dt', { hasText: /^Folders$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(
    String(folders.length)
  );
  state.status = status;
});

Then('every imported document and image matches its pinned GitHub source', async ({ page, $testInfo }) => {
  const state = stateFor(page);

  if (!state.bindingId || !state.status) throw new Error('The UI did not complete a GitHub sync.');
  state.verified = await verifyGithubSyncContent({
    page,
    workspaceId: state.workspaceId,
    bindingId: state.bindingId,
    spaceId: state.spaceId,
    apiUrl: TestConfig.apiUrl,
    accessToken: await accessToken(page),
  });
  expect(state.verified.commitSha).toBe(state.status.binding.last_applied_commit);
  expect(state.verified.pages).toBe(state.status.entries.filter((entry) => entry.kind === 'file').length);
  await $testInfo.attach('github-source-verification', {
    body: JSON.stringify(state.verified, null, 2),
    contentType: 'application/json',
  });
});

Then('the unrelated manual page remains unchanged and unmanaged', async ({ page }) => {
  const state = stateFor(page);

  expect(state.manualPageId).toBeTruthy();
  const after = await readApi<PageCollab>(page, `/api/workspace/${state.workspaceId}/page-view/${state.manualPageId}`);

  expect(after.view).toMatchObject({
    view_id: state.manualPageId,
    name: MANUAL_NAME,
    parent_view_id: state.spaceId,
  });
  expect(documentData(after)).toEqual(state.manualDocument);
  const source = await readApi<unknown>(page, `${workspacePath(state.workspaceId)}/pages/${state.manualPageId}/source`);

  expect(source).toBeNull();
  expect(state.status?.entries.some((entry) => entry.view_id === state.manualPageId)).toBe(false);
});

When('the owner views the space and opens an imported document', async ({ page }) => {
  const state = stateFor(page);
  const entry = state.verified?.entries.find((item) => item.path === 'docs/AUDIT.md') ?? state.verified?.entries[0];

  if (!entry) throw new Error('No imported document was verified.');
  await page.getByTestId('github-sync-dialog').getByRole('button', { name: 'View space', exact: true }).click();
  await expect(page.getByTestId('github-sync-dialog')).toBeHidden();
  await expect(AccountSelectors.settingsDialog(page)).toBeHidden();
  await expandSpaceByName(page, state.configuration.space_name!);
  const row = page.getByTestId(`page-${entry.viewId}`);

  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/app/${state.workspaceId}/${entry.viewId}(?:[?#]|$)`));
  state.openedPath = entry.path;
});

Then('the imported document shows its GitHub source and is read-only', async ({ page }) => {
  const state = stateFor(page);
  const badge = page.getByTestId('github-source-badge').first();

  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveAttribute('aria-label', /GitHub.*Synced.*read-only in AppFlowy/);
  await expect(badge).toHaveAttribute('title', new RegExp(state.openedPath!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const link = badge.getByRole('link', { name: 'Open in GitHub', exact: true });
  const href = await link.getAttribute('href');

  expect(href).toBeTruthy();
  const sourceUrl = new URL(href!);

  expect(sourceUrl.origin).toBe('https://github.com');
  expect(sourceUrl.pathname).toContain(`/${REPOSITORY}/blob/`);
  expect(decodeURIComponent(sourceUrl.pathname)).toContain(`/${state.openedPath}`);
  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate((element: HTMLElement) => element.isContentEditable)).toBe(false);
  await expect(editor).not.toBeEmpty();
  await expect(editor.locator('[contenteditable="true"]')).toHaveCount(0);
});

Then('no GitHub authorization or duplicate binding creation occurred', async ({ page }) => {
  const state = stateFor(page);

  expect(state.oauthRequests).toBe(0);
  expect(state.popups).toBe(0);
  expect(state.createRequests).toHaveLength(1);
  const persisted = await readApi<{ bindings: GitHubSyncBinding[] }>(
    page,
    `${workspacePath(state.workspaceId)}/bindings`
  );

  expect(
    persisted.bindings.filter((binding) => binding.space_id === state.spaceId).map((binding) => binding.id)
  ).toEqual([state.bindingId]);
});

After({ tags: '@github-sync-live' }, async ({ page }) => {
  const state = scenarios.get(page);

  if (!state) return;
  page.off('request', state.requestListener);
  page.off('popup', state.popupListener);
  try {
    // Only this scenario's confirmed creation is eligible. Pause periodic polling to preserve
    // anonymous GitHub quota, including when a later UI/content assertion fails.
    if (state.bindingId) {
      const path = `${workspacePath(state.workspaceId)}/bindings/${state.bindingId}`;
      const latest = await readApi<GitHubSyncStatus>(page, path);

      if (latest.binding.enabled) {
        const response = await page.request.patch(`${TestConfig.apiUrl.replace(/\/$/, '')}${path}`, {
          headers: { Authorization: `Bearer ${await accessToken(page)}` },
          data: { expected_generation: latest.binding.generation, enabled: false },
        });

        expect(response.ok(), 'Pause the scenario-created binding after the live test.').toBe(true);
        const paused = (await response.json()) as { code: number; data: { binding: GitHubSyncBinding } };

        expect(paused.code).toBe(0);
        expect(paused.data.binding.enabled).toBe(false);
      }
    }
  } finally {
    // The runner owns fixture disposal. Keep both imported and manual pages for inspection.
    scenarios.delete(page);
  }
});
