/**
 * Regenerates the nine screenshots in this directory (README.md lists them). It is evidence, not a
 * test: no CI job or e2e suite runs it (see `capture.config.ts`). From the repository root:
 *
 *   BASE_URL=<web origin> APPFLOWY_BASE_URL=<cloud origin> APPFLOWY_GOTRUE_BASE_URL=<gotrue url> \
 *   APPFLOWY_WS_BASE_URL=<ws url> APPFLOWY_MCP_BASE_URL=<mcp origin> \
 *   GOTRUE_ADMIN_EMAIL=… GOTRUE_ADMIN_PASSWORD=… [APPFLOWY_TEST_POSTGRES_CONTAINER=<postgres container>] \
 *   pnpm exec playwright test -c playwright/bdd/evidence/mcp-connect-flow/capture.config.ts
 *
 * Run it only against a disposable stack: it switches AI apps off and on for the whole server.
 * It signs up a fresh owner (who gets a new workspace) and a fresh member of that workspace,
 * connects two local MCP clients through the OAuth flow (`mcp-oauth-helpers`), creates a document
 * and a grid through `create-pages`, and changes the workspace's approval policy through
 * Settings → MCP as the owner.
 *
 * AI apps are switched through `PUT /api/admin/mcp/policy` (with `expected_revision`) as the GoTrue
 * administrator. A deployment whose plan has no MCP tab (managed Cloud builds) answers that API with
 * 403 `mcp_not_entitled`; there, with APPFLOWY_TEST_POSTGRES_CONTAINER set, the script writes the same
 * `af_system_config` row (`mcp_enabled`) through `docker exec … psql`, whose trigger bumps the policy
 * revision and notifies Cloud and MCP. Either way the starting value is put back at the end, also
 * when a step fails.
 *
 * Hosted builds also hold a Free workspace to one member; with APPFLOWY_TEST_POSTGRES_CONTAINER set,
 * the owner's new workspace gets the Pro fixture subscription (`grantWorkspaceProSubscription`)
 * before the member joins.
 *
 * MCP_CAPTURE_FRAMES=03,07 rewrites only the files starting with those prefixes; the journey still
 * runs whole, since every frame depends on the steps before it.
 */
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { signInAndWaitForApp } from '../../../support/auth-flow-helpers';
import {
  exchangeAuthorizationCode,
  getJson,
  pkcePair,
  startCallbackServer,
  type CallbackServer,
  type McpTokenResponse,
} from '../../../support/mcp-oauth-helpers';
import { DatabaseGridSelectors, PageSelectors } from '../../../support/selectors';
import { grantWorkspaceProSubscription } from '../../../support/subscription-test-helpers';
import { TestConfig, setupPageErrorHandling } from '../../../support/test-config';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`Set ${name} (see the header of capture.spec.ts)`);
  return value;
}

const MCP_BASE_URL = requiredEnv('APPFLOWY_MCP_BASE_URL').replace(/\/+$/, '');
const API_URL = requiredEnv('APPFLOWY_BASE_URL').replace(/\/+$/, '');
const GOTRUE_URL = requiredEnv('APPFLOWY_GOTRUE_BASE_URL').replace(/\/+$/, '');
const ADMIN_EMAIL = requiredEnv('GOTRUE_ADMIN_EMAIL');
const ADMIN_PASSWORD = requiredEnv('GOTRUE_ADMIN_PASSWORD');

// The sign-in helpers inject the runtime config from these and use TestConfig's URLs.
requiredEnv('APPFLOWY_WS_BASE_URL');
if (TestConfig.apiUrl.replace(/\/+$/, '') !== API_URL || TestConfig.gotrueUrl.replace(/\/+$/, '') !== GOTRUE_URL) {
  throw new Error('TestConfig does not point at APPFLOWY_BASE_URL / APPFLOWY_GOTRUE_BASE_URL');
}

const CLAUDE_CODE = 'Claude Code (e2e)';
const GEMINI_CLI = 'Gemini CLI (e2e)';
const DOCUMENT_NAME = 'Launch plan (from an AI app)';
const GRID_NAME = 'Customer interviews (from an AI app)';
const PROTOCOL_VERSION = '2025-06-18';
/** Settings → MCP: "changes can take up to 30 seconds to reach AI apps" (the decision cache). */
const APPROVAL_POLICY_PROPAGATION_MS = 31_000;
/** The frames to write (file-name prefixes); every frame when unset. */
const FRAMES = process.env.MCP_CAPTURE_FRAMES?.split(',')
  .map((prefix) => prefix.trim())
  .filter(Boolean);

/** Every browser context of the run: the config's frame (1360×900, scale 1) and clipboard access. */
function contextOptions(): Parameters<Browser['newContext']>[0] {
  const { viewport, deviceScaleFactor, userAgent, baseURL, permissions } = test.info().project.use;

  return { viewport, deviceScaleFactor, userAgent, baseURL, permissions };
}

/** Writes `file` next to this script. */
async function shot(page: Page, file: string, options: { fitContent?: boolean } = {}): Promise<void> {
  if (FRAMES && !FRAMES.some((prefix) => file.startsWith(prefix))) {
    console.log(`skipped ${file} (MCP_CAPTURE_FRAMES)`);
    return;
  }

  const viewport = page.viewportSize();
  // The consent page scrolls inside a viewport-high container, which a full-page screenshot
  // clips; the frame grows the viewport to that content instead.
  const height = options.fitContent
    ? await page.evaluate(() =>
        Math.max(...Array.from(document.querySelectorAll('body *'), (node) => node.scrollHeight))
      )
    : 0;

  if (viewport && height > viewport.height) await page.setViewportSize({ width: viewport.width, height });
  // Dialogs, toasts and the settings modal fade in.
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL(file, import.meta.url)) });
  if (viewport && height > viewport.height) await page.setViewportSize(viewport);
  console.log(`captured ${file}`);
}

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('token');

    return raw ? (JSON.parse(raw) as { access_token?: string }).access_token ?? null : null;
  });

  if (!token) throw new Error('This page has no AppFlowy session');
  return token;
}

async function workspaceIdOf(page: Page): Promise<string> {
  let id: string | undefined;

  await expect
    .poll(
      () => {
        id = /\/app\/([0-9a-f-]{36})/.exec(page.url())?.[1];
        return id;
      },
      { timeout: 30000, message: 'the app URL names no workspace' }
    )
    .toBeTruthy();
  return id as string;
}

/** A Cloud API call in the `{code, data}` envelope. */
async function cloud<T>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown
): Promise<T> {
  const response = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    data,
    failOnStatusCode: false,
  });
  const text = await response.text();

  expect(response.ok(), `${method} ${path}: ${response.status()} ${text}`).toBe(true);
  const body = JSON.parse(text) as { code: number; data: T };

  expect(body.code, `${method} ${path}: ${text}`).toBe(0);
  return body.data;
}

async function gotrueAdminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${GOTRUE_URL}/token?grant_type=password`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    failOnStatusCode: false,
  });

  expect(response.status(), 'GoTrue administrator sign-in').toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

// ---------------------------------------------------------------------------
// AI apps on/off for the whole server
// ---------------------------------------------------------------------------

/** The `mcp_enabled` row as it was before the run; null when nothing was stored. */
interface StoredRow {
  value: string;
  section: string;
  source: string;
  description: string | null;
  updated_by: string | null;
}

interface PolicyPage {
  revision: number;
  enabled: { value: boolean; stored: boolean | null };
}

type SwitchMode =
  | { kind: 'api'; revision: number; start: PolicyPage['enabled'] }
  | { kind: 'sql'; container: string; start: StoredRow | null };

const PG_USER = process.env.APPFLOWY_TEST_POSTGRES_USER || 'postgres';
const PG_DB = process.env.APPFLOWY_TEST_POSTGRES_DATABASE || 'postgres';

/** Runs `sql` from stdin, so `:'name'` interpolates `vars` with psql's own quoting. */
function psql(container: string, sql: string, vars: Record<string, string> = {}): string {
  const args = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', PG_USER, '-d', PG_DB];

  Object.entries(vars).forEach(([name, value]) => args.push('-v', `${name}=${value}`));
  return execFileSync('docker', args, { input: sql, encoding: 'utf8' }).trim();
}

class AiAppsSwitch {
  private constructor(private readonly request: APIRequestContext, private mode: SwitchMode) {}

  static async open(request: APIRequestContext): Promise<AiAppsSwitch> {
    const response = await request.get(`${API_URL}/api/admin/mcp/policy`, {
      headers: { authorization: `Bearer ${await gotrueAdminToken(request)}` },
      failOnStatusCode: false,
    });
    const text = await response.text();

    if (response.ok()) {
      const page = (JSON.parse(text) as { data: PolicyPage }).data;

      console.log(`AI apps at start (policy API): value ${page.enabled.value}, stored ${page.enabled.stored}`);
      return new AiAppsSwitch(request, { kind: 'api', revision: page.revision, start: page.enabled });
    }

    const container = process.env.APPFLOWY_TEST_POSTGRES_CONTAINER;

    if (response.status() === 403 && text.includes('mcp_not_entitled') && container) {
      const raw = psql(
        container,
        `SELECT row_to_json(c) FROM (SELECT value, section, source, description, updated_by::text AS updated_by
           FROM af_system_config WHERE key = 'mcp_enabled') c;`
      );
      const start = raw ? (JSON.parse(raw) as StoredRow) : null;

      console.log(`AI apps at start (af_system_config): ${start ? `mcp_enabled = '${start.value}'` : 'no row'}`);
      return new AiAppsSwitch(request, { kind: 'sql', container, start });
    }

    throw new Error(
      `GET /api/admin/mcp/policy: ${response.status()} ${text}` +
        (response.status() === 403 ? ' (set APPFLOWY_TEST_POSTGRES_CONTAINER to write af_system_config instead)' : '')
    );
  }

  async set(enabled: boolean): Promise<void> {
    if (this.mode.kind === 'sql') {
      psql(
        this.mode.container,
        `INSERT INTO af_system_config (key, value, section, source) VALUES ('mcp_enabled', :'value', 'mcp', 'override')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, section = EXCLUDED.section, source = EXCLUDED.source
         WHERE af_system_config.value IS DISTINCT FROM EXCLUDED.value;`,
        { value: String(enabled) }
      );
      return;
    }

    await this.put(enabled);
  }

  /** Puts back the value the run started with. */
  async restore(): Promise<void> {
    if (this.mode.kind === 'sql') {
      const { container, start } = this.mode;

      if (start) {
        psql(
          container,
          `INSERT INTO af_system_config (key, value, section, source, description, updated_by)
           SELECT 'mcp_enabled', r.value, r.section, r.source, r.description, r.updated_by::bigint
             FROM json_to_record(:'row'::json)
               AS r(value text, section text, source text, description text, updated_by text)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, section = EXCLUDED.section,
             source = EXCLUDED.source, description = EXCLUDED.description, updated_by = EXCLUDED.updated_by;`,
          { row: JSON.stringify(start) }
        );
      } else {
        psql(container, `DELETE FROM af_system_config WHERE key = 'mcp_enabled';`);
      }

      const now = psql(container, `SELECT value FROM af_system_config WHERE key = 'mcp_enabled';`);

      console.log(`AI apps restored (af_system_config): ${now ? `mcp_enabled = '${now}'` : 'no row'}`);
      return;
    }

    const { start } = this.mode;

    if (start.stored === null) {
      // The API cannot remove a saved value; the effective starting value stays saved.
      console.warn(`AI apps: nothing was saved at start; saving the starting value ${start.value}`);
    }

    await this.put(start.stored ?? start.value);
    console.log(`AI apps restored (policy API): ${start.stored ?? start.value}`);
  }

  private async put(enabled: boolean): Promise<void> {
    if (this.mode.kind !== 'api') return;
    const response = await this.request.put(`${API_URL}/api/admin/mcp/policy`, {
      headers: { authorization: `Bearer ${await gotrueAdminToken(this.request)}` },
      data: {
        expected_revision: this.mode.revision,
        reason: 'MCP connect-flow screenshot capture',
        changes: { enabled },
      },
      failOnStatusCode: false,
    });
    const text = await response.text();

    expect(response.status(), `PUT /api/admin/mcp/policy: ${text}`).toBe(200);
    this.mode = { ...this.mode, revision: (JSON.parse(text) as { data: PolicyPage }).data.revision };
  }
}

/** Waits until MCP's member status reports the switch, as Settings → MCP and the consent page read it. */
async function waitForAiApps(request: APIRequestContext, page: Page, workspaceId: string, enabled: boolean) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MCP_BASE_URL}/api/mcp/me/workspaces/${workspaceId}`, {
          headers: { authorization: `Bearer ${await accessToken(page)}` },
          failOnStatusCode: false,
        });
        const text = await response.text();

        if (response.status() === 503 && text.includes('mcp_disabled')) return false;
        if (!response.ok()) return `HTTP ${response.status()}`;
        const body = JSON.parse(text) as { enabled?: boolean; data?: { enabled?: boolean } };

        return body.data?.enabled ?? body.enabled;
      },
      { timeout: 30000, message: `MCP member status never reported enabled: ${enabled}` }
    )
    .toBe(enabled);
}

// ---------------------------------------------------------------------------
// The MCP client side
// ---------------------------------------------------------------------------

interface Server {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

interface App {
  name: string;
  clientId: string;
  callback: CallbackServer;
}

interface Authorization {
  url: string;
  consentPath: string;
  verifier: string;
  state: string;
}

async function discover(request: APIRequestContext): Promise<Server> {
  const resource = await getJson(request, `${MCP_BASE_URL}/.well-known/oauth-protected-resource`);
  const server = await getJson(request, `${MCP_BASE_URL}/.well-known/oauth-authorization-server`);

  return {
    resource: resource.resource as string,
    issuer: server.issuer as string,
    authorizationEndpoint: server.authorization_endpoint as string,
    tokenEndpoint: server.token_endpoint as string,
    registrationEndpoint: server.registration_endpoint as string,
  };
}

/** Dynamic client registration of a local app with a loopback redirect, as Claude Code or Gemini CLI. */
async function registerApp(request: APIRequestContext, server: Server, name: string): Promise<App> {
  const callback = await startCallbackServer();
  const response = await request.post(server.registrationEndpoint, {
    data: {
      client_name: name,
      client_uri: 'http://localhost',
      redirect_uris: [callback.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    failOnStatusCode: false,
  });
  const text = await response.text();

  expect(response.status(), `register ${name}: ${text}`).toBe(201);
  return { name, clientId: (JSON.parse(text) as { client_id: string }).client_id, callback };
}

function authorization(server: Server, app: App): Authorization {
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomUUID();
  const url = new URL(server.authorizationEndpoint);

  Object.entries({
    response_type: 'code',
    client_id: app.clientId,
    redirect_uri: app.callback.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'read write',
    resource: server.resource,
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  // The Web consent page the MCP service redirects to carries the same query.
  return { url: url.toString(), consentPath: `/oauth/mcp/authorize${url.search}`, verifier, state };
}

/** Opens the authorization as the app does; the MCP service hands the browser to the consent page. */
async function openConsent(page: Page, app: App, request: Authorization): Promise<void> {
  await page.goto(request.url, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/oauth\/mcp\/authorize/);
  await expect(page.getByTestId('mcp-consent-page')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('mcp-consent-client-name')).toHaveText(app.name);
}

async function finishAuthorization(
  request: APIRequestContext,
  server: Server,
  app: App,
  pending: Authorization
): Promise<McpTokenResponse> {
  const result = await app.callback.waitForCallback(15000);

  expect(result.error).toBeNull();
  expect(result.state).toBe(pending.state);
  return exchangeAuthorizationCode(request, server.tokenEndpoint, {
    code: result.code as string,
    verifier: pending.verifier,
    clientId: app.clientId,
    redirectUri: app.callback.redirectUri,
    resource: server.resource,
  });
}

interface McpSession {
  accessToken: string;
  sessionId?: string;
  protocolVersion?: string;
}

/** One JSON-RPC exchange with the MCP endpoint, answered as JSON or as server-sent events. */
async function rpc(
  request: APIRequestContext,
  serverUrl: string,
  session: McpSession,
  body: Record<string, unknown>
): Promise<{ status: number; sessionId?: string; body?: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    authorization: `Bearer ${session.accessToken}`,
  };

  if (session.sessionId) headers['mcp-session-id'] = session.sessionId;
  if (session.protocolVersion) headers['mcp-protocol-version'] = session.protocolVersion;
  const response = await request.post(serverUrl, { headers, data: body, failOnStatusCode: false });
  const text = await response.text();
  let parsed: Record<string, unknown> | undefined;

  if ((response.headers()['content-type'] ?? '').includes('text/event-stream')) {
    parsed = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>)
      .find((event) => 'result' in event || 'error' in event);
  } else if (text.trim()) {
    parsed = JSON.parse(text) as Record<string, unknown>;
  }

  return { status: response.status(), sessionId: response.headers()['mcp-session-id'], body: parsed };
}

/** `initialize`, `notifications/initialized`, then `create-pages` with a document and a grid. */
async function createPagesThroughMcp(
  request: APIRequestContext,
  serverUrl: string,
  accessToken: string
): Promise<{ documentId: string; gridId: string }> {
  const initialize = await rpc(
    request,
    serverUrl,
    { accessToken },
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLAUDE_CODE, version: '1.0.0' },
      },
    }
  );

  expect(initialize.status, JSON.stringify(initialize.body)).toBe(200);
  const session: McpSession = {
    accessToken,
    sessionId: initialize.sessionId,
    protocolVersion: (initialize.body?.result as { protocolVersion?: string } | undefined)?.protocolVersion,
  };

  expect(
    (await rpc(request, serverUrl, session, { jsonrpc: '2.0', method: 'notifications/initialized' })).status
  ).toBeLessThan(300);
  const created = await rpc(request, serverUrl, session, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'create-pages',
      arguments: {
        pages: [
          {
            name: DOCUMENT_NAME,
            content:
              '# Launch plan\n\nDrafted by an AI app through AppFlowy MCP.\n\n## Milestones\n\n' +
              '- [ ] Collect beta feedback\n- [ ] Finish the docs\n- [ ] Ship the release\n',
          },
          { name: GRID_NAME, layout: 'grid' },
        ],
        confirm: true,
      },
    },
  });
  const result = created.body?.result as
    | { isError?: boolean; structuredContent?: { results: { ok: boolean; view_id: string }[] } }
    | undefined;

  expect(created.status, JSON.stringify(created.body)).toBe(200);
  expect(result?.isError ?? false, JSON.stringify(created.body)).toBe(false);
  const results = result?.structuredContent?.results ?? [];

  expect(
    results.map((item) => item.ok),
    JSON.stringify(created.body)
  ).toEqual([true, true]);
  return { documentId: results[0].view_id, gridId: results[1].view_id };
}

// ---------------------------------------------------------------------------
// AppFlowy Web
// ---------------------------------------------------------------------------

/** Settings → MCP; `tab` picks Connect AI apps or Manage AI apps (the panel opens on Connect). */
async function openMcpSettings(page: Page, tab?: 'connect' | 'manage'): Promise<void> {
  await page.goto('/app?setting=AI_APPS', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('mcp-panel-loading')).toHaveCount(0, { timeout: 30000 });
  if (tab) await page.getByTestId(`mcp-tab-${tab}`).click();
}

async function chooseWorkspace(page: Page, workspaceId: string): Promise<void> {
  const option = page.getByTestId(`mcp-consent-workspace-option-${workspaceId}`);

  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
}

async function newSignedInPage(browser: Browser, request: APIRequestContext, email: string) {
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();

  setupPageErrorHandling(page);
  await signInAndWaitForApp(page, request, email, 1000);
  return { context, page };
}

test('capture the AI apps (MCP) connect-flow screenshots', async ({ browser, request }) => {
  const run = crypto.randomBytes(4).toString('hex');
  const contexts: BrowserContext[] = [];
  const apps: App[] = [];
  const aiApps = await AiAppsSwitch.open(request);

  try {
    // Discovery and registration need AI apps on.
    await aiApps.set(true);
    const server = await discover(request);

    apps.push(await registerApp(request, server, CLAUDE_CODE), await registerApp(request, server, GEMINI_CLI));
    const [claudeCode, geminiCli] = apps;

    const owner = await newSignedInPage(browser, request, `mcp-owner-${run}@appflowy.io`);

    contexts.push(owner.context);
    const workspaceId = await workspaceIdOf(owner.page);
    const member = await newSignedInPage(browser, request, `mcp-member-${run}@appflowy.io`);

    contexts.push(member.context);
    // The member joins the owner's workspace with an invite code (a Free workspace has one member).
    grantWorkspaceProSubscription(workspaceId);
    const ownerToken = await accessToken(owner.page);
    const invite = await cloud<{ code: string | null }>(
      request,
      ownerToken,
      'POST',
      `/api/workspace/${workspaceId}/invite-code`,
      {
        validity_period_hours: 24,
      }
    );
    const code =
      invite.code ??
      (await cloud<{ code: string | null }>(request, ownerToken, 'GET', `/api/workspace/${workspaceId}/invite-code`))
        .code;

    expect(code, 'invite code').toBeTruthy();
    await cloud(request, await accessToken(member.page), 'POST', '/api/workspace/join-by-invite-code', { code });

    await test.step('01, 02: AI apps turned off', async () => {
      await aiApps.set(false);
      await waitForAiApps(request, owner.page, workspaceId, false);

      await openMcpSettings(owner.page);
      await expect(owner.page.getByTestId('mcp-panel-disabled')).toBeVisible();
      await expect(owner.page.getByTestId('mcp-my-connections-empty')).toBeVisible({ timeout: 15000 });
      await shot(owner.page, '01-owner-settings-ai-apps-off.png');

      // A consent request that reaches the page while AI apps are off (the MCP service itself
      // refuses new authorizations with 503 mcp_disabled).
      await owner.page.goto(authorization(server, claudeCode).consentPath, { waitUntil: 'domcontentloaded' });
      const error = owner.page.getByTestId('mcp-consent-error');

      await expect(error).toBeVisible({ timeout: 30000 });
      await expect(error).toHaveAttribute('data-reason', 'mcp_disabled');
      await shot(owner.page, '02-consent-ai-apps-off.png');
    });

    await aiApps.set(true);
    await waitForAiApps(request, owner.page, workspaceId, true);

    await test.step('03: the owner approves and allows a local app', async () => {
      const pending = authorization(server, claudeCode);

      await openConsent(owner.page, claudeCode, pending);
      await chooseWorkspace(owner.page, workspaceId);
      await expect(owner.page.getByTestId('mcp-consent-owner-approval-notice')).toBeVisible({ timeout: 15000 });
      await expect(owner.page.getByTestId('mcp-consent-scope-write')).toBeChecked();
      await expect(owner.page.getByTestId('mcp-consent-approve-and-allow')).toBeEnabled();
      // The whole card, so the frame includes the approval notice and Approve and allow; the
      // pointer leaves the workspace row it clicked, which would otherwise show its hover colour.
      await owner.page.mouse.move(0, 0);
      await shot(owner.page, '03-owner-consent.png', { fitContent: true });
      await owner.page.getByTestId('mcp-consent-approve-and-allow').click();
      const tokens = await finishAuthorization(request, server, claudeCode, pending);

      expect(tokens.workspace_id).toBe(workspaceId);

      await test.step('04: Settings → MCP with the server URL copied', async () => {
        await openMcpSettings(owner.page, 'manage');
        await expect(owner.page.getByTestId('mcp-my-connection-row').filter({ hasText: CLAUDE_CODE })).toBeVisible({
          timeout: 15000,
        });
        // The frame shows Connect AI apps, where the server URL is.
        await owner.page.getByTestId('mcp-tab-connect').click();
        const shown = await owner.page.getByTestId('mcp-endpoint-value').inputValue();

        await owner.page.getByTestId('mcp-copy-endpoint').click();
        await expect(owner.page.getByText('Copied to clipboard').first()).toBeVisible();
        await shot(owner.page, '04-owner-settings.png');
        expect(await owner.page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
        expect(shown).toBe(server.resource);
      });

      await test.step('05: pages the app created through MCP, open in Web', async () => {
        const { documentId, gridId } = await createPagesThroughMcp(request, server.resource, tokens.access_token);

        await owner.page.goto(`/app/${workspaceId}/${gridId}`, { waitUntil: 'domcontentloaded' });
        await expect(DatabaseGridSelectors.grid(owner.page)).toBeVisible({ timeout: 60000 });
        await owner.page.goto(`/app/${workspaceId}/${documentId}`, { waitUntil: 'domcontentloaded' });
        await expect(owner.page.getByText('Collect beta feedback').first()).toBeVisible({ timeout: 60000 });
        await expect(PageSelectors.pageByViewId(owner.page, documentId)).toContainText(DOCUMENT_NAME, {
          timeout: 30000,
        });
        await expect(PageSelectors.pageByViewId(owner.page, gridId)).toContainText(GRID_NAME, { timeout: 30000 });
        await shot(owner.page, '05-web-pages-created-by-ai-app.png');
      });
    });

    await test.step('08: the signed-out setup page', async () => {
      const context = await browser.newContext(contextOptions());

      contexts.push(context);
      const page = await context.newPage();

      await page.goto('/oauth/mcp/setup', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('mcp-setup-gallery')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('mcp-endpoint-value')).toHaveValue(server.resource);
      await shot(page, '08-public-setup.png');
    });

    await test.step('06: a member requests approval for an unapproved app', async () => {
      await openConsent(member.page, geminiCli, authorization(server, geminiCli));
      await chooseWorkspace(member.page, workspaceId);
      await expect(member.page.getByTestId('mcp-consent-member-approval-notice')).toBeVisible({ timeout: 15000 });
      await member.page.getByTestId('mcp-consent-request-approval').click();
      await expect(member.page.getByTestId('mcp-consent-request-sent')).toBeVisible({ timeout: 15000 });
      await shot(member.page, '06-member-request-sent.png');
    });

    await test.step('07: the owner requires approval again after members connected', async () => {
      // The owner lets members connect any app, through Settings → MCP → Manage AI apps.
      await openMcpSettings(owner.page, 'manage');
      await owner.page.getByTestId('mcp-approval-mode-any').click();
      await owner.page.getByTestId('mcp-confirm-allow-all').click();
      await expect(owner.page.getByTestId('mcp-approval-mode-any')).toBeChecked({ timeout: 15000 });
      await owner.page.waitForTimeout(APPROVAL_POLICY_PROPAGATION_MS);

      // The member connects the app they asked for, now without an approval.
      const pending = authorization(server, geminiCli);

      await openConsent(member.page, geminiCli, pending);
      await chooseWorkspace(member.page, workspaceId);
      await expect(member.page.getByTestId('mcp-consent-allow')).toBeEnabled({ timeout: 15000 });
      await member.page.getByTestId('mcp-consent-allow').click();
      await finishAuthorization(request, server, geminiCli, pending);

      await openMcpSettings(owner.page, 'manage');
      await expect(owner.page.getByTestId('mcp-member-connection-row').filter({ hasText: GEMINI_CLI })).toHaveCount(1, {
        timeout: 15000,
      });
      await owner.page.getByTestId('mcp-approval-mode-verified_and_approved').click();
      const dialog = owner.page.getByTestId('mcp-require-approval-dialog');

      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(GEMINI_CLI);
      await shot(owner.page, '07-owner-reenable-approval-confirm.png');
      await owner.page.getByTestId('mcp-confirm-require-approval').click();
      await expect(owner.page.getByTestId('mcp-approval-mode-verified_and_approved')).toBeChecked({ timeout: 15000 });
    });

    await test.step('09: AI apps turned off again, connections kept', async () => {
      await aiApps.set(false);
      await waitForAiApps(request, owner.page, workspaceId, false);
      await openMcpSettings(owner.page);
      await expect(owner.page.getByTestId('mcp-panel-disabled')).toBeVisible();
      await expect(owner.page.getByTestId('mcp-my-connection-row').filter({ hasText: CLAUDE_CODE })).toHaveCount(1, {
        timeout: 15000,
      });
      await shot(owner.page, '09-owner-settings-off-connections-kept.png');
    });
  } finally {
    await aiApps.restore();
    await Promise.all(contexts.map((context) => context.close()));
    await Promise.all(apps.map((app) => app.callback.close()));
  }
});
