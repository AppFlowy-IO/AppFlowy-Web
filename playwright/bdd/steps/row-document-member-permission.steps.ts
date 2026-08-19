import { APIRequestContext, BrowserContext, expect, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { RowMetaKey } from '../../../src/application/database-yjs/database.type';
import { getMetaIdMap } from '../../../src/application/database-yjs/row_meta';
import { initializeDocumentStructure } from '../../../src/application/slate-yjs/utils/yjs';
import { Types, ViewLayout, YDoc, YjsEditorKey } from '../../../src/application/types';
import { AuthTestUtils } from '../../support/auth-utils';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { openRowDetailByRowId } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, RowDetailSelectors, SidebarSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const { Given, When, Then, Before, After } = createBdd();

const PASSWORDLESS_TOKEN_TIMEOUT_MS = 30_000;
const FIXTURE_TIMEOUT_MS = 45_000;
const SPACE_PERMISSION_PUBLIC = 0;
const SPACE_PERMISSION_PRIVATE = 1;
const SPACE_MEMBER_EDIT_ACCESS = 30;

type AuthTokenData = {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string };
  [key: string]: unknown;
};

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenData: AuthTokenData;
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type UserWorkspaceInfo = {
  visiting_workspace: { workspace_id: string };
  workspaces: { workspace_id: string }[];
};

type CreatedPage = {
  view_id: string;
  database_id?: string;
};

type Issue8958State = {
  runId: string;
  ownerEmail: string;
  memberEmail: string;
  ownerSession?: AuthSession;
  memberSession?: AuthSession;
  workspaceId?: string;
  spaceId?: string;
  databasePageId?: string;
  databaseId?: string;
  rowId?: string;
  rowDocumentId?: string;
  rowTitle?: string;
  rowBody?: string;
  memberContext?: BrowserContext;
  memberPage?: Page;
  memberLoadRequests: string[];
};

type BrowserSyncContext = {
  bindViewSync?: (doc: BrowserYDoc) => { flush?: () => Promise<boolean> } | null;
  bindRowSync?: (rowId: string) => void;
  checkIfRowDocumentExists?: (documentId: string) => Promise<boolean>;
  ensureRow?: (rowId: string) => Promise<Y.Doc | undefined> | Y.Doc | undefined;
};

type BrowserYDoc = Y.Doc & {
  object_id?: string;
  view_id?: string;
  _collabType?: Types;
  _syncBound?: boolean;
};

type Issue8958TestWindow = Window & {
  Y?: typeof Y;
  __TEST_DATABASE_CONTEXT__?: BrowserSyncContext;
  __ISSUE_8958_ROW_DOCUMENT__?: BrowserYDoc;
};

const stateByPage = new WeakMap<Page, Issue8958State>();

Before(async ({ page }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const runId = uuidv4();

  stateByPage.set(page, {
    runId,
    ownerEmail: `issue-8958-owner-${runId}@appflowy.io`,
    memberEmail: `issue-8958-member-${runId}@appflowy.io`,
    memberLoadRequests: [],
  });
});

After(async ({ page, request }) => {
  const state = stateByPage.get(page);

  await state?.memberContext?.close().catch(() => undefined);

  if (state?.ownerSession && state.workspaceId && state.spaceId) {
    await apiPost<void>(
      request,
      state.ownerSession.accessToken,
      `/api/workspace/${state.workspaceId}/page-view/${state.spaceId}/move-to-trash`,
      {}
    ).catch(() => undefined);
  }

  stateByPage.delete(page);
});

Given('an invited workspace member has default access to an issue 8958 public database', async ({ page, request }) => {
  await prepareDatabaseFixture(page, request, false);
});

Given('an invited workspace member has edit access to an issue 8958 private database', async ({ page, request }) => {
  await prepareDatabaseFixture(page, request, true);
});

Given(
  'the issue 8958 database has a row document without a legacy permission registration',
  async ({ page, request }) => {
    const state = requireDatabaseState(page);
    const rowTitle = `Issue 8958 row ${state.runId.slice(0, 8)}`;
    const rowBody = `Issue 8958 protected row body ${state.runId.slice(0, 8)}`;
    const rowId = await apiPost<string>(
      request,
      state.ownerSession.accessToken,
      `/api/workspace/${state.workspaceId}/database/${state.databaseId}/row`,
      {
        cells: { Name: rowTitle },
        document: null,
        parse_link_as_link_preview: false,
      }
    );
    const rowDocumentId = uuidv5(RowMetaKey.DocumentId, rowId);
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    if (!isDocumentEmptyKey) {
      throw new Error(`Could not derive the is-document-empty key for row ${rowId}`);
    }

    state.rowId = rowId;
    state.rowDocumentId = rowDocumentId;
    state.rowTitle = rowTitle;
    state.rowBody = rowBody;

    await expect(DatabaseGridSelectors.rowById(page, rowId)).toContainText(rowTitle, { timeout: FIXTURE_TIMEOUT_MS });

    const rowDocumentUpdate = createRowDocumentUpdate(rowDocumentId, rowBody);
    const seeded = await page.evaluate(
      async ({ collabType, dataSectionKey, documentId, isEmptyKey, metaKey, rowId: targetRowId, update }) => {
        const testWindow = window as Issue8958TestWindow;
        const yjs = testWindow.Y;
        const databaseContext = testWindow.__TEST_DATABASE_CONTEXT__;

        if (!yjs || !databaseContext?.bindViewSync || !databaseContext.ensureRow) {
          return { ok: false, reason: 'database test sync context is unavailable' };
        }

        const rowDoc = await databaseContext.ensureRow(targetRowId);
        const rowMeta = rowDoc?.getMap(dataSectionKey).get(metaKey) as Y.Map<unknown> | undefined;

        if (!rowDoc || !rowMeta) {
          return { ok: false, reason: 'database row metadata is unavailable' };
        }

        databaseContext.bindRowSync?.(targetRowId);
        rowMeta.set(isEmptyKey, false);

        const rowDocument = new yjs.Doc({ guid: documentId }) as BrowserYDoc;

        yjs.applyUpdate(rowDocument, new Uint8Array(update));
        rowDocument.object_id = documentId;
        rowDocument.view_id = documentId;
        rowDocument._collabType = collabType;
        rowDocument._syncBound = false;

        const syncContext = databaseContext.bindViewSync(rowDocument);

        if (!syncContext) {
          return { ok: false, reason: 'row-document sync context was not registered' };
        }

        testWindow.__ISSUE_8958_ROW_DOCUMENT__ = rowDocument;
        return { ok: true, reason: '' };
      },
      {
        collabType: Types.Document,
        dataSectionKey: YjsEditorKey.data_section,
        documentId: rowDocumentId,
        isEmptyKey: isDocumentEmptyKey,
        metaKey: YjsEditorKey.meta,
        rowId,
        update: Array.from(rowDocumentUpdate),
      }
    );

    expect(seeded.ok, seeded.reason).toBe(true);

    await expect
      .poll(
        () =>
          page.evaluate(async (documentId) => {
            const context = (window as Issue8958TestWindow).__TEST_DATABASE_CONTEXT__;

            return (await context?.checkIfRowDocumentExists?.(documentId)) ?? false;
          }, rowDocumentId),
        {
          timeout: FIXTURE_TIMEOUT_MS,
          message: `waiting for row document ${rowDocumentId} to persist through realtime sync`,
        }
      )
      .toBe(true);

    const legacyResult = await getApiEnvelope(
      request,
      state.memberSession.accessToken,
      `/api/workspace/${state.workspaceId}/page-view/${rowDocumentId}`
    );
    const contextualResult = await getApiEnvelope(
      request,
      state.memberSession.accessToken,
      `/api/workspace/v1/${state.workspaceId}/collab/${rowDocumentId}?${new URLSearchParams({
        collab_type: String(Types.Document),
        database_id: state.databaseId,
        row_id: rowId,
        row_document_id: rowDocumentId,
      })}`
    );

    expect(
      legacyResult.code,
      `Fixture must reproduce the missing legacy row permission. Response: ${JSON.stringify(legacyResult)}`
    ).toBe(1012);
    expect(
      contextualResult.code,
      `Fixture member must inherit row-document access from the database. Response: ${JSON.stringify(contextualResult)}`
    ).toBe(0);
    console.log(
      `[issue-8958] fixture ${state.runId.slice(0, 8)}: ` +
        `legacy page-view code=${legacyResult.code}, contextual collab code=${contextualResult.code}`
    );
  }
);

When('the invited member opens the issue 8958 database row', async ({ page, browser }) => {
  const state = requireRowDocumentState(page);
  const memberContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 1440, height: 900 },
  });
  const memberPage = await memberContext.newPage();

  state.memberContext = memberContext;
  state.memberPage = memberPage;
  setupPageErrorHandling(memberPage);
  memberPage.on('response', (response) => {
    if (response.url().includes(state.rowDocumentId)) {
      state.memberLoadRequests.push(`${response.request().method()} ${response.url()} -> ${response.status()}`);
    }
  });

  await signBrowserInWithSession(memberPage, state.memberSession);
  await memberPage.goto(`/app/${state.workspaceId}/${state.databasePageId}`, { waitUntil: 'domcontentloaded' });
  await waitForGridReady(memberPage);
  await expect(DatabaseGridSelectors.rowById(memberPage, state.rowId)).toContainText(state.rowTitle, {
    timeout: FIXTURE_TIMEOUT_MS,
  });

  const isDocumentEmptyKey = getMetaIdMap(state.rowId).get(RowMetaKey.IsDocumentEmpty);

  if (!isDocumentEmptyKey) {
    throw new Error(`Could not derive the is-document-empty key for row ${state.rowId}`);
  }

  await expect
    .poll(
      () =>
        memberPage.evaluate(
          async ({ dataSectionKey, isEmptyKey, metaKey, rowId }) => {
            const context = (window as Issue8958TestWindow).__TEST_DATABASE_CONTEXT__;
            const rowDoc = await context?.ensureRow?.(rowId);
            const meta = rowDoc?.getMap(dataSectionKey).get(metaKey) as Y.Map<unknown> | undefined;

            return meta?.get(isEmptyKey);
          },
          {
            dataSectionKey: YjsEditorKey.data_section,
            isEmptyKey: isDocumentEmptyKey,
            metaKey: YjsEditorKey.meta,
            rowId: state.rowId,
          }
        ),
      { timeout: FIXTURE_TIMEOUT_MS, message: 'waiting for the invited member to receive non-empty row metadata' }
    )
    .toBe(false);

  await openRowDetailByRowId(memberPage, state.rowId);
});

Then('the invited member can read and edit the issue 8958 row document', async ({ page }) => {
  const state = requireMemberPageState(page);
  const memberPage = state.memberPage;
  const modal = RowDetailSelectors.modal(memberPage);
  const body = modal.getByText(state.rowBody, { exact: true });
  const noAccess = modal.getByTestId('row-document-no-access');
  let outcome: 'loading' | 'ready' | 'forbidden' = 'loading';

  await expect
    .poll(
      async () => {
        if (await body.isVisible().catch(() => false)) outcome = 'ready';
        else if (await noAccess.isVisible().catch(() => false)) outcome = 'forbidden';
        else outcome = 'loading';
        return outcome;
      },
      {
        timeout: FIXTURE_TIMEOUT_MS,
        message: `row document did not open; requests: ${state.memberLoadRequests.join(', ') || 'none'}`,
      }
    )
    .not.toBe('loading');
  expect(outcome, `row document did not open; requests: ${state.memberLoadRequests.join(', ') || 'none'}`).toBe('ready');

  const editor = modal.locator('[data-slate-editor="true"]').first();
  const memberEdit = ` — edited by invited member ${state.runId.slice(0, 8)}`;

  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await body.click();
  await memberPage.keyboard.press('End');
  await memberPage.keyboard.type(memberEdit);
  await expect(editor).toContainText(memberEdit.trim(), { timeout: FIXTURE_TIMEOUT_MS });
});

async function prepareDatabaseFixture(page: Page, request: APIRequestContext, privateSpace: boolean): Promise<void> {
  const state = getState(page);
  const ownerSession = await signInFixtureAccount(request, state.ownerEmail);
  const memberSession = await signInFixtureAccount(request, state.memberEmail);

  state.ownerSession = ownerSession;
  state.memberSession = memberSession;

  await signBrowserInWithSession(page, ownerSession);

  const ownerWorkspace = await apiGet<UserWorkspaceInfo>(request, ownerSession.accessToken, '/api/user/workspace');
  const workspaceId = ownerWorkspace.visiting_workspace.workspace_id;

  await joinWorkspaceByInviteCode(request, ownerSession.accessToken, memberSession.accessToken, workspaceId);

  const visibilityLabel = privateSpace ? 'private' : 'public';
  const space = await apiPost<{ view_id: string }>(
    request,
    ownerSession.accessToken,
    `/api/workspace/${workspaceId}/space`,
    {
      name: `Issue 8958 ${visibilityLabel} space ${state.runId.slice(0, 8)}`,
      space_icon: privateSpace ? 'lock' : 'earth',
      space_icon_color: '#555555',
      space_permission: privateSpace ? SPACE_PERMISSION_PRIVATE : SPACE_PERMISSION_PUBLIC,
    }
  );
  const databasePage = await apiPost<CreatedPage>(
    request,
    ownerSession.accessToken,
    `/api/workspace/${workspaceId}/page-view`,
    {
      parent_view_id: space.view_id,
      layout: ViewLayout.Grid,
      name: `Issue 8958 ${visibilityLabel} database ${state.runId.slice(0, 8)}`,
    }
  );

  if (!databasePage.database_id) {
    throw new Error(`Database page creation returned no database id: ${JSON.stringify(databasePage)}`);
  }

  if (privateSpace) {
    const memberUid = await findWorkspaceMemberUid(request, ownerSession.accessToken, workspaceId, state.memberEmail);

    await postRawJson(
      request,
      ownerSession.accessToken,
      `/api/workspace/${workspaceId}/spaces/${space.view_id}/members`,
      `{"uid":${memberUid},"role":"member","access_level":${SPACE_MEMBER_EDIT_ACCESS}}`
    );
  }

  state.workspaceId = workspaceId;
  state.spaceId = space.view_id;
  state.databasePageId = databasePage.view_id;
  state.databaseId = databasePage.database_id;

  await page.goto(`/app/${workspaceId}/${databasePage.view_id}`, { waitUntil: 'domcontentloaded' });
  await waitForGridReady(page);
}

function createRowDocumentUpdate(documentId: string, body: string): Uint8Array {
  const doc = new Y.Doc({ guid: documentId }) as YDoc;

  initializeDocumentStructure(doc, true, documentId);

  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const document = sharedRoot.get(YjsEditorKey.document) as Y.Map<unknown>;
  const blocks = document.get(YjsEditorKey.blocks) as Y.Map<Y.Map<unknown>>;
  const meta = document.get(YjsEditorKey.meta) as Y.Map<unknown>;
  const childrenMap = meta.get(YjsEditorKey.children_map) as Y.Map<Y.Array<string>>;
  const textMap = meta.get(YjsEditorKey.text_map) as Y.Map<Y.Text>;
  const pageId = document.get(YjsEditorKey.page_id) as string;
  const paragraphId = childrenMap.get(pageId)?.get(0);
  const paragraph = paragraphId ? blocks.get(paragraphId) : undefined;
  const paragraphTextId = paragraph?.get(YjsEditorKey.block_external_id) as string | undefined;
  const paragraphText = paragraphTextId ? textMap.get(paragraphTextId) : undefined;

  if (!paragraphText) {
    throw new Error(`Could not initialize paragraph text for row document ${documentId}`);
  }

  paragraphText.insert(0, body);
  return Y.encodeStateAsUpdate(doc);
}

async function joinWorkspaceByInviteCode(
  request: APIRequestContext,
  ownerToken: string,
  memberToken: string,
  workspaceId: string
): Promise<void> {
  const memberWorkspace = await apiGet<UserWorkspaceInfo>(request, memberToken, '/api/user/workspace');

  if (memberWorkspace.workspaces.some((workspace) => workspace.workspace_id === workspaceId)) return;

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
    throw new Error(`Workspace ${workspaceId} did not return an invite code`);
  }

  await apiPost<{ workspace_id: string }>(request, memberToken, '/api/workspace/join-by-invite-code', {
    code: inviteCode,
  });
}

async function findWorkspaceMemberUid(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  email: string
): Promise<string> {
  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/member?include_pending=true`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const responseText = await response.text();

  if (!response.ok()) {
    throw new Error(`Workspace member lookup failed: HTTP ${response.status()} ${responseText}`);
  }

  const normalized = responseText.replace(/"uid"\s*:\s*(\d{16,})/g, '"uid":"$1"');
  const body = JSON.parse(normalized) as ApiResponse<Array<{ uid?: string | number; email: string }>>;
  const member = body.data?.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());

  if (member?.uid === undefined || member.uid === null) {
    throw new Error(`Workspace member uid was not found for ${email}: ${responseText}`);
  }

  return String(member.uid);
}

async function postRawJson(request: APIRequestContext, token: string, path: string, rawBody: string): Promise<void> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data: rawBody,
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const body = parseJson<ApiResponse<unknown>>(responseText);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST failed for ${path}: HTTP ${response.status()} ${responseText}`);
  }
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
    timeout: PASSWORDLESS_TOKEN_TIMEOUT_MS,
  });

  if (!verifyResponse.ok()) {
    throw new Error(`Failed to verify fixture account ${email}: HTTP ${verifyResponse.status()}`);
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
    if (storedToken.user?.id) localStorage.setItem('af_user_id', storedToken.user.id);
    localStorage.setItem('token', JSON.stringify(storedToken));
  }, session);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/app/, { timeout: FIXTURE_TIMEOUT_MS });
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible({ timeout: FIXTURE_TIMEOUT_MS });
}

async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const body = await getApiEnvelope<T>(request, token, path);

  if (body.code !== 0 || body.data === undefined) {
    throw new Error(`API GET failed for ${path}: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    data,
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const body = parseJson<ApiResponse<T>>(responseText);

  if (!response.ok() || body?.code !== 0) {
    throw new Error(`API POST failed for ${path}: HTTP ${response.status()} ${responseText}`);
  }

  return body.data as T;
}

async function getApiEnvelope<T = unknown>(
  request: APIRequestContext,
  token: string,
  path: string
): Promise<ApiResponse<T>> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: apiHeaders(token),
    failOnStatusCode: false,
  });
  const responseText = await response.text();
  const body = parseJson<ApiResponse<T>>(responseText);

  if (!body) {
    throw new Error(`API GET returned non-JSON for ${path}: HTTP ${response.status()} ${responseText}`);
  }

  return body;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getState(page: Page): Issue8958State {
  const state = stateByPage.get(page);

  if (!state) throw new Error('Issue 8958 scenario state has not been initialized');
  return state;
}

function requireDatabaseState(page: Page) {
  const state = getState(page);

  if (!state.ownerSession || !state.memberSession || !state.workspaceId || !state.databaseId || !state.databasePageId) {
    throw new Error('Issue 8958 database fixture has not been prepared');
  }

  return state as Issue8958State &
    Required<Pick<Issue8958State, 'ownerSession' | 'memberSession' | 'workspaceId' | 'databaseId' | 'databasePageId'>>;
}

function requireRowDocumentState(page: Page) {
  const state = requireDatabaseState(page);

  if (!state.rowId || !state.rowDocumentId || !state.rowTitle || !state.rowBody) {
    throw new Error('Issue 8958 row-document fixture has not been prepared');
  }

  return state as typeof state & Required<Pick<Issue8958State, 'rowId' | 'rowDocumentId' | 'rowTitle' | 'rowBody'>>;
}

function requireMemberPageState(page: Page) {
  const state = requireRowDocumentState(page);

  if (!state.memberPage) {
    throw new Error('The invited member has not opened the issue 8958 database row');
  }

  return state as typeof state & Required<Pick<Issue8958State, 'memberPage'>>;
}
