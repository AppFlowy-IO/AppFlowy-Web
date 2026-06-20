import { APIRequestContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4 } from 'uuid';

import { createDatabaseView, waitForGridReady } from '../../support/database-ui-helpers';
import { createDocumentPageAndNavigate, insertLinkedDatabaseViaSlash } from '../../support/page-utils';
import { AuthTestUtils } from '../../support/auth-utils';
import { BlockSelectors, DatabaseGridSelectors, EditorSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';
import { renameCurrentDatabasePage } from '../../support/relation-test-helpers';

const { Given, When, Then, Before } = createBdd();

const OWNER_EMAIL = 'fixture-mention-web-owner@appflowy.io';
const MEMBER_EMAIL = 'fixture-mention-web-member@appflowy.io';
const MEMBER_DISPLAY_NAME = 'Mention Web Fixture Member';
const FEATURE_PASSWORDLESS_TOKEN_TIMEOUT_MS = 30000;
const MENTION_API_POLL_TIMEOUT_MS = 90000;
const MENTION_API_POLL_INTERVAL_MS = 2000;

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenData: AuthTokenData;
};

type AuthTokenData = {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string };
  [key: string]: unknown;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UserWorkspaceInfoPayload = {
  user_profile: { uuid: string };
  visiting_workspace: { workspace_id: string };
  workspaces: { workspace_id: string }[];
};

type MentionSearchItem = {
  kind: string;
  title: string;
  object_id?: string;
  database_row_id?: string;
};

type DatabaseIdentity = {
  databaseId: string;
  databaseViewId: string;
};

type DatabaseRowListItem = {
  id: string;
};

type MentionSearchSection = {
  kind: string;
  items: MentionSearchItem[];
};

type MentionSearchResponse = {
  sections: MentionSearchSection[];
};

type MentionFixtureState = {
  ownerEmail: string;
  memberEmail: string;
  memberName: string;
  runId: string;
  workspaceId?: string;
  ownerToken?: string;
  memberToken?: string;
  memberUuid?: string;
  databaseId?: string;
  databaseViewId?: string;
  databaseName?: string;
  rowId?: string;
  rowKeyword?: string;
  rowSearchRequestBody?: unknown;
};

const stateByPage = new WeakMap<Page, MentionFixtureState>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  stateByPage.set(page, {
    ownerEmail: OWNER_EMAIL,
    memberEmail: MEMBER_EMAIL,
    memberName: MEMBER_DISPLAY_NAME,
    runId: uuidv4().slice(0, 8),
  });
});

Given('the mention search fixture owner is signed in', async ({ page, request }) => {
  const state = getState(page);
  const ownerSession = await signInFixtureAccount(request, state.ownerEmail);

  state.ownerToken = ownerSession.accessToken;
  await signBrowserInWithSession(page, ownerSession);

  const workspaceInfo = await getUserWorkspaceInfo(request, state.ownerToken);

  state.workspaceId = workspaceInfo.visiting_workspace.workspace_id;
});

Given('the mention search fixture member can be mentioned', async ({ page, request }) => {
  const state = getState(page);

  await ensureMemberJoinedOwnerWorkspace(request, state);
  await waitForMentionApiItem(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    {
      query: state.memberName,
      limit: 8,
      include: ['person'],
    },
    (item) => item.object_id === state.memberUuid && item.title === state.memberName
  );
});

Given('a blank mention search document page is open', async ({ page }) => {
  await createDocumentPageAndNavigate(page);
  await focusEditor(page);
});

Given('database-row mention search retries later for {string}', async ({ page }, query: string) => {
  await page.route('**/mentions/search', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      query?: string;
      include?: string[];
    } | null;
    const isDatabaseRowOnlyRequest =
      body?.query === query &&
      Array.isArray(body.include) &&
      body.include.length === 1 &&
      body.include[0] === 'database_row';

    if (!isDatabaseRowOnlyRequest) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: -5,
        message: 'retry later',
      }),
    });
  });
});

Given('a mention search document contains an indexed fixture database row', async ({ page, request }) => {
  const state = getState(page);
  const rowKeyword = `Mention Row ${state.runId}`;
  const databaseName = `Mention Search DB ${state.runId}`;

  state.rowKeyword = rowKeyword;
  state.databaseName = databaseName;

  await createDatabaseView(page, 'Grid', 8000);
  await waitForGridReady(page);
  await renameCurrentDatabasePage(page, databaseName);
  const identity = await getCurrentDatabaseIdentity(page);
  const rowId = await createDatabaseRowViaApi(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    identity.databaseId,
    rowKeyword
  );

  state.databaseId = identity.databaseId;
  state.databaseViewId = identity.databaseViewId;
  state.rowId = rowId;

  await waitForDatabaseRowInApi(
    request,
    requireOwnerToken(state),
    requireWorkspaceId(state),
    identity.databaseId,
    rowId
  );
  await mockDatabaseRowMentionSearch(page, state);
  const docViewId = await createDocumentPageAndNavigate(page);

  await insertLinkedDatabaseViaSlash(page, docViewId, databaseName);
  await waitForGridReady(page);
  await expect(DatabaseGridSelectors.rowById(page, rowId)).toContainText(rowKeyword, { timeout: 30000 });
  await focusParagraphBelowLinkedDatabase(page);
});

When('I open the mention panel with an empty query', async ({ page }) => {
  await openMentionPanel(page);
});

When('I search mentions for the fixture member', async ({ page }) => {
  await searchMentionsInEditor(page, getState(page).memberName);
});

When('I search mentions for {string}', async ({ page }, query: string) => {
  await searchMentionsInEditor(page, query);
});

When('I search mentions for the fixture database row', async ({ page }) => {
  const state = getState(page);
  const rowKeyword = requireRowKeyword(state);
  const rowRequestPromise = page.waitForRequest(
    (request) => {
      if (!request.url().includes('/mentions/search')) return false;

      const body = request.postDataJSON() as {
        query?: string;
        include?: string[];
        filter?: {
          database_ids?: string[];
        };
      } | null;
      const isRowRequest =
        body?.query === rowKeyword &&
        Array.isArray(body.include) &&
        body.include.length === 1 &&
        body.include[0] === 'database_row';

      if (isRowRequest) {
        state.rowSearchRequestBody = body;
      }

      return isRowRequest;
    },
    { timeout: 30000 }
  );

  await searchMentionsAtCurrentSelection(page, rowKeyword);
  await rowRequestPromise;
});

Then('the mention panel shows date quick picks', async ({ page }) => {
  const panel = mentionPanel(page);

  await expect(panel.getByText('Today', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText('Tomorrow', { exact: true })).toBeVisible({ timeout: 15000 });
});

Then('the mention panel does not show a links section', async ({ page }) => {
  await expect(mentionPanel(page).getByText('Links', { exact: true })).toHaveCount(0);
});

Then('the mention panel does not show database rows', async ({ page }) => {
  await expect(mentionPanel(page).getByText('Database rows', { exact: true })).toHaveCount(0);
});

Then('the mention panel shows the fixture member', async ({ page }) => {
  await expect(mentionPanel(page).getByText(getState(page).memberName, { exact: true })).toBeVisible({
    timeout: 30000,
  });
});

Then('the mention panel shows an external link for {string}', async ({ page }, hostname: string) => {
  const linksSection = mentionPanel(page).locator('[data-section-kind="links"]');
  const hostnamePattern = new RegExp(escapeRegExp(hostname));

  await expect(linksSection.getByText('Links', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(linksSection.getByRole('button', { name: hostnamePattern })).toBeVisible({ timeout: 15000 });
});

Then('the browser sent a database-row mention search request', async ({ page }) => {
  const body = getState(page).rowSearchRequestBody as {
    query?: string;
    include?: string[];
    filter?: { database_ids?: string[] };
  };

  expect(body).toMatchObject({
    query: requireRowKeyword(getState(page)),
    include: ['database_row'],
  });

  if (body.filter?.database_ids) {
    expect(body.filter.database_ids).toContain(requireDatabaseId(getState(page)));
  }
});

Then('the mention panel shows the fixture database row', async ({ page }) => {
  const resultSection = mentionPanel(page).locator('[data-option-category="result"]');

  await expect(resultSection.getByText('Database rows', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(resultSection.getByRole('button', { name: new RegExp(requireRowKeyword(getState(page))) })).toBeVisible();
});

async function ensureMemberJoinedOwnerWorkspace(request: APIRequestContext, state: MentionFixtureState): Promise<void> {
  const workspaceId = requireWorkspaceId(state);
  const ownerToken = requireOwnerToken(state);
  const memberSession = await signInFixtureAccount(request, state.memberEmail);

  state.memberToken = memberSession.accessToken;

  let memberWorkspaceInfo = await getUserWorkspaceInfo(request, memberSession.accessToken);
  const alreadyJoined = memberWorkspaceInfo.workspaces.some((workspace) => workspace.workspace_id === workspaceId);

  if (!alreadyJoined) {
    const createdInvite = await apiPost<{ code: string | null }>(
      request,
      ownerToken,
      `/api/workspace/${workspaceId}/invite-code`,
      { validity_period_hours: 24 }
    );
    const inviteCode =
      createdInvite.code ??
      (await apiGet<{ code: string | null }>(request, ownerToken, `/api/workspace/${workspaceId}/invite-code`)).code;

    if (!inviteCode) {
      throw new Error('Mention fixture workspace invite code was not created');
    }

    await apiPost<{ workspace_id: string }>(request, memberSession.accessToken, '/api/workspace/join-by-invite-code', {
      code: inviteCode,
    });
    memberWorkspaceInfo = await getUserWorkspaceInfo(request, memberSession.accessToken);
  }

  state.memberUuid = memberWorkspaceInfo.user_profile.uuid;
  await apiPut<void>(request, memberSession.accessToken, `/api/workspace/${workspaceId}/update-member-profile`, {
    name: state.memberName,
  });
}

async function signInFixtureAccount(request: APIRequestContext, email: string): Promise<AuthSession> {
  const authUtils = new AuthTestUtils();
  const callbackLink = await authUtils.generateSignInUrl(request, email);
  const hashIndex = callbackLink.indexOf('#');

  if (hashIndex === -1) {
    throw new Error(`Fixture auth callback for ${email} did not contain a token hash`);
  }

  const params = new URLSearchParams(callbackLink.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    throw new Error(`Fixture auth callback for ${email} did not include access and refresh tokens`);
  }

  const verifyResponse = await request.get(`${TestConfig.apiUrl}/api/user/verify/${accessToken}`, {
    failOnStatusCode: false,
    timeout: FEATURE_PASSWORDLESS_TOKEN_TIMEOUT_MS,
  });

  if (!verifyResponse.ok()) {
    throw new Error(
      `Failed to verify fixture account ${email}: HTTP ${verifyResponse.status()} ${await verifyResponse.text()}`
    );
  }

  const tokenResponse = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=refresh_token`, {
    data: { refresh_token: refreshToken },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  if (!tokenResponse.ok()) {
    throw new Error(`Failed to refresh fixture token for ${email}: HTTP ${tokenResponse.status()}`);
  }

  const tokenData = (await tokenResponse.json()) as AuthTokenData;
  const refreshedAccessToken = tokenData.access_token || accessToken;
  const refreshedRefreshToken = tokenData.refresh_token || refreshToken;

  return {
    accessToken: refreshedAccessToken,
    refreshToken: refreshedRefreshToken,
    tokenData: {
      ...tokenData,
      access_token: refreshedAccessToken,
      refresh_token: refreshedRefreshToken,
    },
  };
}

async function signBrowserInWithSession(page: Page, session: AuthSession): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & { Cypress?: boolean }).Cypress = true;
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ accessToken, refreshToken, tokenData }) => {
    const storedToken = {
      ...tokenData,
      access_token: tokenData.access_token || accessToken,
      refresh_token: tokenData.refresh_token || refreshToken,
    };

    localStorage.setItem('af_auth_token', storedToken.access_token);
    localStorage.setItem('af_refresh_token', storedToken.refresh_token);

    if (storedToken.user?.id) {
      localStorage.setItem('af_user_id', storedToken.user.id);
    }

    localStorage.setItem('token', JSON.stringify(storedToken));
  }, session);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: 30000 });
}

async function getUserWorkspaceInfo(request: APIRequestContext, token: string): Promise<UserWorkspaceInfoPayload> {
  return apiGet<UserWorkspaceInfoPayload>(request, token, '/api/user/workspace');
}

async function createDatabaseRowViaApi(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  rowKeyword: string
): Promise<string> {
  return apiPost<string>(request, token, `/api/workspace/${workspaceId}/database/${databaseId}/row`, {
    cells: {
      Name: rowKeyword,
    },
    document: null,
    parse_link_as_link_preview: false,
  });
}

async function waitForDatabaseRowInApi(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  databaseId: string,
  rowId: string
): Promise<void> {
  const startedAt = Date.now();
  let lastRows: DatabaseRowListItem[] = [];

  while (Date.now() - startedAt < MENTION_API_POLL_TIMEOUT_MS) {
    lastRows = await apiGet<DatabaseRowListItem[]>(
      request,
      token,
      `/api/workspace/${workspaceId}/database/${databaseId}/row`
    );

    if (lastRows.some((row) => row.id === rowId)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, MENTION_API_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for database row ${rowId}. Last rows: ${JSON.stringify(lastRows)}`);
}

async function getCurrentDatabaseIdentity(page: Page): Promise<DatabaseIdentity> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const identity = await page.evaluate(() => {
      const testWindow = window as Window & {
        __TEST_DATABASE_CONTEXT__?: {
          activeViewId?: string;
          databaseDoc?: {
            guid?: string;
            getMap?: (key: string) => {
              get?: (key: string) => { get?: (key: string) => string | undefined } | undefined;
            };
          };
        };
      };
      const context = testWindow.__TEST_DATABASE_CONTEXT__;
      const dataSection = context?.databaseDoc?.getMap?.('data');
      const database = dataSection?.get?.('database');
      const databaseId = database?.get?.('id') ?? context?.databaseDoc?.guid;
      const databaseViewId = context?.activeViewId;

      if (!databaseId || !databaseViewId) {
        return null;
      }

      return { databaseId, databaseViewId };
    });

    if (identity) {
      return identity;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('Timed out waiting for the active database identity from the UI');
}

async function mockDatabaseRowMentionSearch(page: Page, state: MentionFixtureState): Promise<void> {
  await page.route('**/mentions/search', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      query?: string;
      include?: string[];
      filter?: {
        database_ids?: string[];
      };
    } | null;
    const databaseId = requireDatabaseId(state);
    const rowKeyword = requireRowKeyword(state);

    if (body?.query !== rowKeyword) {
      await route.continue();
      return;
    }

    if (
      !Array.isArray(body.include) ||
      body.include.length !== 1 ||
      body.include[0] !== 'database_row'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            sections: [],
            partial: false,
          },
        }),
      });
      return;
    }

    const databaseViewId = state.databaseViewId;
    const rowId = requireRowId(state);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          sections: [
            {
              kind: 'database_rows',
              title: 'Database rows',
              has_more: false,
              status: 'ready',
              items: [
                {
                  kind: 'database_row',
                  object_id: rowId,
                  title: rowKeyword,
                  subtitle: 'Database row',
                  database_id: databaseId,
                  database_view_id: databaseViewId,
                  database_row_id: rowId,
                  row_document_id: null,
                  can_access_context: true,
                  mention: {
                    type: 'database_row',
                    database_id: databaseId,
                    database_view_id: databaseViewId,
                    row_id: rowId,
                    row_document_id: null,
                  },
                },
              ],
            },
          ],
          partial: false,
        },
      }),
    });
  });
}

async function waitForMentionApiItem(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  payload: Record<string, unknown>,
  predicate: (item: MentionSearchItem) => boolean
): Promise<MentionSearchItem> {
  const startedAt = Date.now();
  let lastResponse: MentionSearchResponse | undefined;

  while (Date.now() - startedAt < MENTION_API_POLL_TIMEOUT_MS) {
    lastResponse = await apiPost<MentionSearchResponse>(
      request,
      token,
      `/api/workspace/${workspaceId}/mentions/search`,
      payload
    );

    const item = lastResponse.sections.flatMap((section) => section.items).find(predicate);

    if (item) {
      return item;
    }

    await new Promise((resolve) => setTimeout(resolve, MENTION_API_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for mention API item. Last response: ${JSON.stringify(lastResponse)}`);
}

async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    data,
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

async function apiPut<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.put(`${TestConfig.apiUrl}${path}`, {
    headers: authHeaders(token),
    data,
    failOnStatusCode: false,
  });

  return unwrapApiResponse<T>(response.status(), await response.text());
}

function unwrapApiResponse<T>(status: number, rawBody: string): T {
  let body: ApiResponse<T> | undefined;

  try {
    body = rawBody ? (JSON.parse(rawBody) as ApiResponse<T>) : undefined;
  } catch {
    throw new Error(`API returned non-JSON response with status ${status}: ${rawBody}`);
  }

  if (status < 200 || status >= 300 || body?.code !== 0) {
    throw new Error(`API request failed: HTTP ${status} ${rawBody}`);
  }

  return body.data as T;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function openMentionPanel(page: Page): Promise<void> {
  await focusEditor(page);
  await page.keyboard.type('@', { delay: 20 });
  await expect(mentionPanel(page)).toBeVisible({ timeout: 15000 });
}

async function searchMentionsInEditor(page: Page, query: string): Promise<void> {
  await openMentionPanel(page);
  await page.keyboard.type(query, { delay: 30 });
}

async function searchMentionsAtCurrentSelection(page: Page, query: string): Promise<void> {
  await page.keyboard.type('@', { delay: 20 });
  await expect(mentionPanel(page)).toBeVisible({ timeout: 15000 });
  await page.keyboard.type(query, { delay: 30 });
}

async function focusParagraphBelowLinkedDatabase(page: Page): Promise<void> {
  const blockId = await page.evaluate(() => {
    const testWindow = window as Window & {
      __TEST_EDITOR__?: {
        children?: Array<{ type?: string; blockId?: string; children?: unknown[] }>;
      };
      __TEST_CUSTOM_EDITOR__?: {
        addBelowBlock?: (editor: unknown, blockId: string, type: string, data: Record<string, never>) => string | void;
      };
    };
    const editor = testWindow.__TEST_EDITOR__;
    const customEditor = testWindow.__TEST_CUSTOM_EDITOR__;
    const linkedDatabaseBlock = editor?.children?.find((node) => node.type === 'grid');

    if (!editor || !customEditor?.addBelowBlock || !linkedDatabaseBlock?.blockId) {
      return null;
    }

    return customEditor.addBelowBlock(editor, linkedDatabaseBlock.blockId, 'paragraph', {}) ?? null;
  });

  if (!blockId) {
    throw new Error('Unable to create a paragraph below the linked database for mention search');
  }

  const paragraph = BlockSelectors.blockByType(page, 'paragraph').last();

  await expect(paragraph).toBeVisible({ timeout: 15000 });
  await paragraph.click({ force: true });
  await page.waitForTimeout(200);
}

async function focusEditor(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').last();

  if ((await dialog.count()) > 0) {
    const scrollContainer = page.locator('.MuiDialog-paper .appflowy-scroll-container').last();

    if ((await scrollContainer.count()) > 0) {
      await scrollContainer.evaluate((el) => el.scrollTo(0, 9999));
      await page.waitForTimeout(500);
    }

    const editor = dialog.locator('[data-slate-editor="true"]').first();
    const placeholder = dialog.getByText('Enter a / to insert a block, or start typing').last();

    await expect(editor).toBeVisible({ timeout: 15000 });

    if ((await placeholder.count()) > 0 && (await placeholder.isVisible().catch(() => false))) {
      await placeholder.click({ force: true });
    } else {
      await editor.click({ force: true });
    }

    await page.waitForTimeout(200);
    return;
  }

  const editor = EditorSelectors.firstEditor(page);

  await expect(editor).toBeVisible({ timeout: 15000 });
  await editor.click({ force: true });
  await page.waitForTimeout(200);
}

function mentionPanel(page: Page) {
  return page.getByTestId('mention-panel');
}

function getState(page: Page): MentionFixtureState {
  const state = stateByPage.get(page);

  if (!state) {
    throw new Error('Mention fixture state is not initialized for this page');
  }

  return state;
}

function requireWorkspaceId(state: MentionFixtureState): string {
  if (!state.workspaceId) {
    throw new Error('Mention fixture workspace ID is not initialized');
  }

  return state.workspaceId;
}

function requireOwnerToken(state: MentionFixtureState): string {
  if (!state.ownerToken) {
    throw new Error('Mention fixture owner token is not initialized');
  }

  return state.ownerToken;
}

function requireRowKeyword(state: MentionFixtureState): string {
  if (!state.rowKeyword) {
    throw new Error('Mention fixture row keyword is not initialized');
  }

  return state.rowKeyword;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireDatabaseId(state: MentionFixtureState): string {
  if (!state.databaseId) {
    throw new Error('Mention fixture database ID is not initialized');
  }

  return state.databaseId;
}

function requireRowId(state: MentionFixtureState): string {
  if (!state.rowId) {
    throw new Error('Mention fixture row ID is not initialized');
  }

  return state.rowId;
}
