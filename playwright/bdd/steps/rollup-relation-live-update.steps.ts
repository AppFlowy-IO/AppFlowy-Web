import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import {
  closeRelationMenu,
  createNamedGridDatabase,
  createRelationViaCreationDialog,
  createRollupCountFieldViaPropertyMenu,
  getRelationCellRowIdsDirect,
  getRelationPickerRows,
  openGridDatabaseByName,
  openRelationCellMenu,
  selectRelationRowById,
  type DatabaseFixtureInfo,
  type RelationPickerRow,
} from '../../support/relation-test-helpers';
import { PageSelectors } from '../../support/selectors';
import { addSortByFieldName } from '../../support/sort-test-helpers';
import { SPM0622_PASSWORD as DEFAULT_SEEDED_USER_PASSWORD } from '../../support/spm0622-fixture';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { After, Before, Given, Then, When } = createBdd();

const NATHAN_EMAIL = process.env.NATHAN_EMAIL?.trim() || 'nathan@appflowy.io';
const NATHAN_PASSWORD = process.env.NATHAN_PASSWORD || DEFAULT_SEEDED_USER_PASSWORD;
const NATHAN_WORKSPACE_NAME = process.env.NATHAN_WORKSPACE_NAME?.trim() || 'nathan workspace';

interface CreatedDatabase {
  name: string;
  viewId: string;
}

interface RollupReactivityState {
  target?: DatabaseFixtureInfo;
  source?: DatabaseFixtureInfo;
  targetName: string;
  sourceName: string;
  targetRows: RelationPickerRow[];
  protectedIds: string[];
  createdDatabases: CreatedDatabase[];
  workspaceId: string;
  authToken: string;
  relationFieldId: string;
  rollupFieldId: string;
  documentToken: string;
}

const states = new WeakMap<Page, RollupReactivityState>();

function stateFor(page: Page): RollupReactivityState {
  const state = states.get(page);

  if (!state) throw new Error('Rollup reactivity scenario state was never initialised');
  return state;
}

function rollupCell(page: Page, state: RollupReactivityState) {
  const rowId = state.source?.rowIds[0];

  if (!rowId || !state.rollupFieldId) throw new Error('Rollup fixture is incomplete');
  return page.getByTestId(`rollup-cell-${rowId}-${state.rollupFieldId}`).last();
}

Before({ tags: '@rollup-reactivity' }, async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 900 });

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  states.set(page, {
    targetName: '',
    sourceName: `Rollup Live Test ${suffix}`,
    targetRows: [],
    protectedIds: [],
    createdDatabases: [],
    workspaceId: '',
    authToken: '',
    relationFieldId: '',
    rollupFieldId: '',
    documentToken: '',
  });
});

After({ tags: '@rollup-reactivity' }, async ({ page, request }) => {
  const state = states.get(page);

  if (!state) return;

  const cleanupErrors: string[] = [];

  // Delete in reverse creation order so future multi-database setup keeps its
  // dependency ordering without changing teardown semantics.
  for (const database of [...state.createdDatabases].reverse()) {
    await deleteCreatedDatabase(request, state.authToken, state.workspaceId, database, state.protectedIds).catch(
      (error) => {
        cleanupErrors.push(`${database.name}: ${String(error)}`);
      }
    );
  }

  states.delete(page);

  if (cleanupErrors.length > 0) {
    throw new Error(`Rollup reactivity teardown failed:\n${cleanupErrors.join('\n')}`);
  }
});

Given('Nathan is signed in to the Nathan workspace for rollup testing', async ({ page, request }) => {
  await signInWithPasswordViaUi(page, NATHAN_EMAIL, NATHAN_PASSWORD, 2000);
  await expect.poll(() => currentSessionEmail(page), { timeout: 10000 }).toBe(NATHAN_EMAIL);

  const state = stateFor(page);

  state.authToken = await getAuthToken(page);
  if (!state.authToken) throw new Error('Nathan session has no auth token');
  state.workspaceId = await openWorkspaceByExactName(page, request, state.authToken, NATHAN_WORKSPACE_NAME);
  state.protectedIds = await getExistingWorkspaceViewIds(request, state.authToken, state.workspaceId);
});

Given('the existing database {string} is the rollup target', async ({ page }, databaseName: string) => {
  const state = stateFor(page);

  state.targetName = databaseName;
  state.target = await openGridDatabaseByName(page, databaseName);
  state.protectedIds = [
    ...new Set(
      [
        ...state.protectedIds,
        state.target.databaseId,
        state.target.pageId,
        state.target.titlePageId,
        state.target.viewId,
      ].filter((id): id is string => Boolean(id))
    ),
  ];
  expect(state.target.rowIds.length).toBeGreaterThanOrEqual(6);
});

Given('a new rollup database with one row {string}', async ({ page }, rowName: string) => {
  const state = stateFor(page);

  state.source = await createNamedGridDatabase(page, state.sourceName, [rowName], {
    protectedIds: state.protectedIds,
    onCreated: (database) => {
      state.createdDatabases.push({ name: state.sourceName, viewId: database.titlePageId || database.pageId });
    },
  });
});

Given(
  'a relation property {string} and count-all rollup {string} are configured',
  async ({ page }, relationName: string, rollupName: string) => {
    const state = stateFor(page);

    if (!state.target) throw new Error('Rollup target database was never selected');
    state.relationFieldId = await createRelationViaCreationDialog(page, {
      fieldName: relationName,
      relatedDatabaseId: state.target.databaseId,
      relatedDatabaseName: state.targetName,
    });
    state.rollupFieldId = await createRollupCountFieldViaPropertyMenu(page, {
      fieldName: rollupName,
      relationFieldId: state.relationFieldId,
      targetFieldId: state.target.primaryFieldId,
    });
  }
);

Given('the source row initially links one target', async ({ page }) => {
  const state = stateFor(page);

  await openRelationCellMenu(page, state.relationFieldId, 0);
  await expect
    .poll(() => getRelationPickerRows(page).then((rows) => new Set(rows.map(({ id }) => id)).size), {
      timeout: 30000,
      message: `Waiting for at least six rows from the existing ${state.targetName} database`,
    })
    .toBeGreaterThanOrEqual(6);
  state.targetRows = [
    ...new Map((await getRelationPickerRows(page)).map((targetRow) => [targetRow.id, targetRow])).values(),
  ].slice(0, 6);
  expect(state.targetRows).toHaveLength(6);
  await selectRelationRowById(page, state.targetRows[0].id, state.targetRows[0].label);
  await closeRelationMenu(page);
  await expect
    .poll(() => getRelationCellRowIdsDirect(page, state.relationFieldId, state.source?.rowIds[0] || ''))
    .toHaveLength(1);
  await expect(rollupCell(page, state)).toHaveText('1', { timeout: 20_000 });
});

Given('the rollup source grid is sorted by {string}', async ({ page }, fieldName: string) => {
  await addSortByFieldName(page, fieldName);
});

When('the source relation is expanded to all six targets without refreshing', async ({ page }) => {
  const state = stateFor(page);
  const targetRows = state.targetRows.slice(0, 6);

  expect(targetRows).toHaveLength(6);
  state.documentToken = `rollup-live-${Date.now()}`;
  await page.evaluate((token) => {
    (window as typeof window & { __ROLLUP_BDD_DOCUMENT_TOKEN__?: string }).__ROLLUP_BDD_DOCUMENT_TOKEN__ = token;
  }, state.documentToken);

  await openRelationCellMenu(page, state.relationFieldId, 0);
  for (const targetRow of targetRows.slice(1)) {
    const relationMenu = page.locator('[data-radix-popper-content-wrapper]').last();

    if (!(await relationMenu.isVisible().catch(() => false))) {
      await openRelationCellMenu(page, state.relationFieldId, 0);
    }
    await selectRelationRowById(page, targetRow.id, targetRow.label);
  }
  await closeRelationMenu(page);
});

Then('the source relation contains six targets', async ({ page }) => {
  const state = stateFor(page);
  const sourceRowId = state.source?.rowIds[0];

  if (!sourceRowId) throw new Error('Rollup source row is unavailable');
  const expectedRowIds = state.targetRows.map(({ id }) => id).sort();

  await expect
    .poll(async () => [...new Set(await getRelationCellRowIdsDirect(page, state.relationFieldId, sourceRowId))].sort(), {
      timeout: 20_000,
      message: 'Waiting for all relation row IDs to be stored',
    })
    .toEqual(expectedRowIds);
});

Then('the mounted rollup shows {string} without refreshing', async ({ page }, expected: string) => {
  const state = stateFor(page);

  await expect(rollupCell(page, state)).toHaveText(expected, { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __ROLLUP_BDD_DOCUMENT_TOKEN__?: string }).__ROLLUP_BDD_DOCUMENT_TOKEN__
      )
    )
    .toBe(state.documentToken);
});

interface WorkspaceSummary {
  workspace_id?: string;
  workspace_name?: string;
}

interface WorkspaceResponse {
  code?: number;
  message?: string;
  data?: {
    visiting_workspace?: WorkspaceSummary;
    workspaces?: WorkspaceSummary[];
  };
}

interface ApiResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

interface WorkspaceView {
  view_id?: string;
  children?: WorkspaceView[];
}

async function openWorkspaceByExactName(
  page: Page,
  request: APIRequestContext,
  token: string,
  workspaceName: string
): Promise<string> {
  const response = await request.get(`${TestConfig.apiUrl}/api/user/workspace`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as WorkspaceResponse | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`Nathan workspace lookup failed: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  const candidates = [
    ...(body.data?.workspaces ?? []),
    ...(body.data?.visiting_workspace ? [body.data.visiting_workspace] : []),
  ].filter(({ workspace_name }) => workspace_name?.trim().toLowerCase() === workspaceName.toLowerCase());
  const matches = [...new Map(candidates.map((workspace) => [workspace.workspace_id, workspace])).values()];

  if (matches.length !== 1 || !matches[0]?.workspace_id) {
    throw new Error(`Expected exactly one workspace named "${workspaceName}", found ${matches.length}`);
  }

  await page.goto(`/app/${matches[0].workspace_id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('current-workspace-name')).toHaveText(workspaceName, { timeout: 30000 });
  await expect(PageSelectors.newPageButton(page)).toBeVisible({ timeout: 30000 });
  return matches[0].workspace_id;
}

async function getExistingWorkspaceViewIds(
  request: APIRequestContext,
  token: string,
  workspaceId: string
): Promise<string[]> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/folder?depth=100`, {
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse | null;

  if (!response.ok() || body?.code !== 0 || !body.data) {
    throw new Error(`Workspace view snapshot failed: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  const ids = new Set<string>();
  const collect = (view: WorkspaceView) => {
    if (view.view_id) ids.add(view.view_id);
    view.children?.forEach(collect);
  };

  collect(body.data as WorkspaceView);
  if (ids.size === 0) throw new Error('Workspace view snapshot was empty; refusing destructive test setup');
  return [...ids];
}

async function deleteCreatedDatabase(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  database: CreatedDatabase,
  protectedIds: string[]
): Promise<void> {
  if (!token || !workspaceId) {
    throw new Error(`Missing Nathan cleanup credentials for ${database.name}`);
  }
  if (!database.name.startsWith('Rollup Live Test ') || protectedIds.includes(database.viewId)) {
    throw new Error(`Refusing to delete an unverified database target: ${database.name} (${database.viewId})`);
  }

  await expectApiSuccess(
    request.post(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/page-view/${database.viewId}/move-to-trash`, {
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    }),
    `Move ${database.name} to trash`
  );
  await expect
    .poll(
      async () => {
        const response = await request.delete(
          `${TestConfig.apiUrl}/api/workspace/${workspaceId}/trash/${database.viewId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            failOnStatusCode: false,
          }
        );

        if (response.status() === 404) return false;
        await expectApiSuccess(Promise.resolve(response), `Purge ${database.name}`);
        return true;
      },
      { timeout: 10000, message: `Waiting for ${database.name} to become purgeable` }
    )
    .toBe(true);
}

async function expectApiSuccess(
  responsePromise: ReturnType<APIRequestContext['get']>,
  operation: string
): Promise<void> {
  const response = await responsePromise;

  const body = (await response.json().catch(() => null)) as ApiResponse | null;

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`${operation} failed: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }
}

async function currentSessionEmail(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rawToken = localStorage.getItem('token');

    if (!rawToken) return '';
    try {
      return (JSON.parse(rawToken) as { user?: { email?: string } }).user?.email || '';
    } catch {
      return '';
    }
  });
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
