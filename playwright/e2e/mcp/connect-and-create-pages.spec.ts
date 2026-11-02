/**
 * The whole AI-app journey, starting from what a user sees in AppFlowy Web: copy the MCP server
 * URL from Settings → AI apps, connect an MCP client with only that URL, create pages through MCP,
 * and find them in AppFlowy Web.
 *
 * The client gets nothing from the test configuration: every endpoint comes from the copied URL,
 * the way an AI app discovers them (the `WWW-Authenticate` challenge, RFC 9728 protected-resource
 * metadata, RFC 8414 authorization-server metadata, dynamic client registration, the Web consent
 * page, the token endpoint, then an MCP session on the copied URL itself).
 *
 * Needs a running stack where AI apps are turned on (Admin → AI apps (MCP), or
 * APPFLOWY_MCP_ENABLED=true) and AppFlowy Web knows the MCP origin (server-info `mcp_url`, or
 * APPFLOWY_MCP_BASE_URL). Each run signs up a fresh @appflowy.io user, who owns a new workspace.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const CLIENT_NAME = 'Playwright AI app';
const PROTOCOL_VERSION = '2025-06-18';

interface Discovered {
  /** The canonical MCP server URL (RFC 9728 `resource`); the copied URL must be it. */
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

interface CallbackResult {
  code: string | null;
  error: string | null;
  state: string | null;
  iss: string | null;
}

interface JsonRpcReply {
  status: number;
  sessionId?: string;
  body: Record<string, unknown> | undefined;
}

/** A loopback redirect URI, like the ones local AI apps (Claude Code, Codex, Cursor) register. */
async function startCallbackServer() {
  let resolveCallback!: (result: CallbackResult) => void;
  const waitForCallback = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    resolveCallback({
      code: url.searchParams.get('code'),
      error: url.searchParams.get('error'),
      state: url.searchParams.get('state'),
      iss: url.searchParams.get('iss'),
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Callback</title><p>The AI app received the authorization.</p>');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCallback: (timeoutMs: number) =>
      Promise.race([
        waitForCallback,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for the OAuth callback')), timeoutMs)
        ),
      ]),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function getJson(request: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const response = await request.get(url, { failOnStatusCode: false });

  expect(response.status(), `GET ${url}`).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** RFC 8414 §3: the issuer's path, if any, goes after the well-known prefix. */
function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');

  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

/** A JSON-RPC exchange with the MCP endpoint, answered as JSON or as one server-sent event. */
async function mcpRpc(
  request: APIRequestContext,
  serverUrl: string,
  body: Record<string, unknown>,
  session: { accessToken?: string; sessionId?: string; protocolVersion?: string } = {}
): Promise<JsonRpcReply> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };

  if (session.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
  if (session.sessionId) headers['mcp-session-id'] = session.sessionId;
  if (session.protocolVersion) headers['mcp-protocol-version'] = session.protocolVersion;

  const response = await request.post(serverUrl, { headers, data: body, failOnStatusCode: false });
  const text = await response.text();
  const contentType = response.headers()['content-type'] ?? '';
  let parsed: Record<string, unknown> | undefined;

  if (contentType.includes('text/event-stream')) {
    const events = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>);

    parsed = events.find((event) => 'result' in event || 'error' in event);
  } else if (text.trim()) {
    parsed = JSON.parse(text) as Record<string, unknown>;
  }

  return { status: response.status(), sessionId: response.headers()['mcp-session-id'], body: parsed };
}

/** Everything a client needs, discovered from the server URL alone. */
async function discover(request: APIRequestContext, serverUrl: string): Promise<Discovered> {
  // The MCP endpoint refuses an anonymous client and points at its resource metadata.
  const probe = await request.post(serverUrl, {
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} },
    failOnStatusCode: false,
  });

  expect(probe.status()).toBe(401);
  const challenge = probe.headers()['www-authenticate'] ?? '';
  const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];

  expect(resourceMetadataUrl, `WWW-Authenticate: ${challenge}`).toBeTruthy();

  const resourceMetadata = await getJson(request, resourceMetadataUrl as string);
  const issuer = (resourceMetadata.authorization_servers as string[] | undefined)?.[0];

  expect(issuer, JSON.stringify(resourceMetadata)).toBeTruthy();
  const server = await getJson(request, authorizationServerMetadataUrl(issuer as string));

  expect(server.issuer).toBe(issuer);
  expect(server.code_challenge_methods_supported).toContain('S256');

  return {
    resource: resourceMetadata.resource as string,
    issuer: issuer as string,
    authorizationEndpoint: server.authorization_endpoint as string,
    tokenEndpoint: server.token_endpoint as string,
    registrationEndpoint: server.registration_endpoint as string,
  };
}

/** Read the MCP server URL the way a user takes it: from Settings → AI apps, through Copy. */
async function copyServerUrlFromSettings(page: Page): Promise<string> {
  await page.goto('/app?setting=AI_APPS', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByTestId('mcp-panel-disabled'),
    'AI apps are turned off on this server: turn them on in Admin → AI apps (MCP), or set APPFLOWY_MCP_ENABLED=true'
  ).toHaveCount(0);

  const field = page.getByTestId('mcp-endpoint-value');

  await expect(field).toBeVisible({ timeout: 30000 });
  const shown = await field.inputValue();

  await page.getByTestId('mcp-copy-endpoint').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  expect(new URL(shown).pathname).toBe('/mcp');

  return shown;
}

test.describe('Connect an AI app with the URL from AppFlowy Web', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
  });

  test('copies the URL, connects through the consent page, and creates pages that appear in Web', async ({
    page,
    request,
  }) => {
    const callback = await startCallbackServer();
    const run = crypto.randomBytes(3).toString('hex');
    const documentName = `Launch plan ${run} (from an AI app)`;
    const gridName = `Customer interviews ${run} (from an AI app)`;

    try {
      await signInAndWaitForApp(page, request, generateRandomEmail(), 1000);
      const serverUrl = await copyServerUrlFromSettings(page);

      console.log(`MCP server URL copied from Settings → AI apps: ${serverUrl}`);

      // Discovery, registration and authorization use nothing but the copied URL.
      const discovered = await discover(request, serverUrl);

      expect(discovered.resource).toBe(serverUrl);
      const registration = await request.post(discovered.registrationEndpoint, {
        data: {
          client_name: CLIENT_NAME,
          redirect_uris: [callback.redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        failOnStatusCode: false,
      });

      expect(registration.status()).toBe(201);
      const clientId = ((await registration.json()) as { client_id: string }).client_id;
      const verifier = crypto.randomBytes(48).toString('base64url');
      const state = crypto.randomUUID();
      const authorize = new URL(discovered.authorizationEndpoint);

      Object.entries({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callback.redirectUri,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        scope: 'read write',
        resource: discovered.resource,
      }).forEach(([key, value]) => authorize.searchParams.set(key, value));

      // The authorization server hands the browser to the Web consent page.
      await page.goto(authorize.toString(), { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/oauth\/mcp\/authorize/);
      await expect(page.getByTestId('mcp-consent-page')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('mcp-consent-client-name')).toHaveText(CLIENT_NAME);
      await expect(page.getByTestId('mcp-consent-scope-write')).toBeChecked();
      // A fresh workspace requires approval, so its owner approves and allows in one step.
      await page.getByTestId('mcp-consent-approve-and-allow').click();

      const result = await callback.waitForCallback(15000);

      expect(result.error).toBeNull();
      expect(result.state).toBe(state);
      expect(result.iss).toBe(discovered.issuer);

      const tokenResponse = await request.post(discovered.tokenEndpoint, {
        form: {
          grant_type: 'authorization_code',
          code: result.code as string,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: callback.redirectUri,
          resource: discovered.resource,
        },
        failOnStatusCode: false,
      });

      expect(tokenResponse.status()).toBe(200);
      const tokens = (await tokenResponse.json()) as Record<string, string>;

      expect(tokens.scope).toBe('read write');
      const workspaceId = tokens.workspace_id;

      // An MCP session on the copied URL, as an AI app opens one.
      const initialize = await mcpRpc(
        request,
        serverUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: CLIENT_NAME, version: '1.0.0' },
          },
        },
        { accessToken: tokens.access_token }
      );

      expect(initialize.status, JSON.stringify(initialize.body)).toBe(200);
      const session = {
        accessToken: tokens.access_token,
        sessionId: initialize.sessionId,
        protocolVersion: (initialize.body?.result as { protocolVersion: string }).protocolVersion,
      };
      const initialized = await mcpRpc(
        request,
        serverUrl,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        session
      );

      expect(initialized.status).toBeLessThan(300);
      const tools = await mcpRpc(request, serverUrl, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
      const toolNames = ((tools.body?.result as { tools: { name: string }[] }).tools ?? []).map((tool) => tool.name);

      expect(toolNames).toContain('create-pages');

      const created = await mcpRpc(
        request,
        serverUrl,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'create-pages',
            arguments: {
              pages: [
                {
                  name: documentName,
                  content:
                    '# Launch plan\n\nDrafted by an AI app through AppFlowy MCP.\n\n- [ ] Collect beta feedback\n- [ ] Ship the release\n',
                },
                { name: gridName, layout: 'grid' },
              ],
              confirm: true,
            },
          },
        },
        session
      );
      const callResult = created.body?.result as
        | { isError?: boolean; structuredContent?: { results: { ok: boolean; view_id: string }[] } }
        | undefined;

      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(callResult?.isError ?? false, JSON.stringify(created.body)).toBe(false);
      const results = callResult?.structuredContent?.results ?? [];

      expect(results.map((item) => item.ok)).toEqual([true, true]);
      console.log(`Created through MCP in workspace ${workspaceId}: ${results.map((item) => item.view_id).join(', ')}`);

      // The pages are in AppFlowy Web: the document opens with its content, both are in the sidebar.
      await page.goto(`/app/${workspaceId}/${results[0].view_id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Collect beta feedback').first()).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(documentName).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(gridName).first()).toBeVisible({ timeout: 30000 });

      // And the AI app is listed as the user's connection.
      await page.goto('/app?setting=AI_APPS', { waitUntil: 'domcontentloaded' });
      await expect(
        page.getByTestId('mcp-my-connections').getByTestId('mcp-my-connection-row').filter({ hasText: CLIENT_NAME })
      ).toHaveCount(1, { timeout: 30000 });
    } finally {
      await callback.close();
    }
  });
});
