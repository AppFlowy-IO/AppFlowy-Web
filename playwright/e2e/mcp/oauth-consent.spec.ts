/**
 * MCP OAuth consent through the Web page (`/oauth/mcp/authorize`).
 *
 * Needs a running Cloud stack with the MCP service on APPFLOWY_MCP_BASE_URL
 * (default http://localhost:8002) whose APPFLOWY_WEB_URL points at this Web
 * app, and a Web build with the same APPFLOWY_MCP_BASE_URL. Each test signs
 * up a fresh @appflowy.io user, who owns a new workspace that requires
 * approval for new AI apps. The MCP email gate must admit that user: its
 * allowlists are empty by default (every account may use MCP); a restricted
 * deployment must include appflowy.io.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import crypto from 'node:crypto';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { exchangeAuthorizationCode, getJson, pkcePair, startCallbackServer } from '../../support/mcp-oauth-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const MCP_BASE_URL = (process.env.APPFLOWY_MCP_BASE_URL || 'http://localhost:8002').replace(/\/+$/, '');
const CLIENT_NAME = 'Playwright MCP Client';

interface ServerMetadata {
  /** Canonical MCP server URL from the protected-resource metadata (RFC 9728). */
  resource: string;
  /** Authorization server issuer (RFC 8414), echoed as `iss` on redirects (RFC 9207). */
  issuer: string;
}

/** What a real client discovers before authorizing; both documents must be served. */
async function discoverServer(request: APIRequestContext): Promise<ServerMetadata> {
  const [resourceMetadata, serverMetadata] = await Promise.all([
    getJson(request, `${MCP_BASE_URL}/.well-known/oauth-protected-resource`),
    getJson(request, `${MCP_BASE_URL}/.well-known/oauth-authorization-server`),
  ]);
  const { resource } = resourceMetadata;
  const { issuer } = serverMetadata;

  expect(typeof resource, JSON.stringify(resourceMetadata)).toBe('string');
  expect(typeof issuer, JSON.stringify(serverMetadata)).toBe('string');
  return { resource: resource as string, issuer: issuer as string };
}

async function registerClient(request: APIRequestContext, redirectUri: string): Promise<string> {
  const response = await request.post(`${MCP_BASE_URL}/api/mcp/register`, {
    data: {
      client_name: CLIENT_NAME,
      client_uri: 'http://127.0.0.1',
      redirect_uris: [redirectUri],
    },
    failOnStatusCode: false,
  });

  expect(response.status()).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Starts authorization the way an AI app does; the MCP service hands the browser to the Web consent page. */
async function openConsent(
  page: Page,
  params: { clientId: string; redirectUri: string; challenge: string; state: string; resource: string }
): Promise<void> {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
    scope: 'read write',
    resource: params.resource,
  });

  await page.goto(`${MCP_BASE_URL}/api/mcp/authorize?${query.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/oauth\/mcp\/authorize/);
  await expect(page.getByTestId('mcp-consent-page')).toBeVisible({ timeout: 30000 });
}

async function listTools(request: APIRequestContext, accessToken: string) {
  return request.post(`${MCP_BASE_URL}/api/mcp`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    failOnStatusCode: false,
  });
}

test.describe('MCP OAuth consent', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
  });

  test('an owner approves and connects a local app, uses it, then disconnects it in Settings', async ({
    page,
    request,
  }) => {
    const callback = await startCallbackServer();

    try {
      await signInAndWaitForApp(page, request, generateRandomEmail(), 1000);

      const server = await discoverServer(request);
      const clientId = await registerClient(request, callback.redirectUri);
      const { verifier, challenge } = pkcePair();
      const state = crypto.randomUUID();

      await openConsent(page, {
        clientId,
        redirectUri: callback.redirectUri,
        challenge,
        state,
        resource: server.resource,
      });

      // Identity: a self-registered app on a loopback redirect.
      await expect(page.getByTestId('mcp-consent-client-name')).toHaveText(CLIENT_NAME);
      await expect(page.getByTestId('mcp-client-unverified-badge')).toBeVisible();
      await expect(page.getByTestId('mcp-consent-redirect-host')).toHaveText('127.0.0.1');
      await expect(page.getByTestId('mcp-consent-localhost-warning')).toBeVisible();

      // Permissions: read is fixed, the requested write is preselected; grant read only.
      await expect(page.getByTestId('mcp-consent-scope-read')).toBeChecked();
      await expect(page.getByTestId('mcp-consent-scope-read')).toBeDisabled();
      await expect(page.getByTestId('mcp-consent-scope-write')).toBeChecked();
      await expect(page.getByTestId('mcp-consent-scope-admin')).not.toBeChecked();
      await page.getByTestId('mcp-consent-scope-write').uncheck();

      // New workspaces require approval, so the owner approves and allows in one step.
      await expect(page.getByTestId('mcp-consent-owner-approval-notice')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('mcp-consent-allow')).toHaveCount(0);
      await page.getByTestId('mcp-consent-approve-and-allow').click();

      const result = await callback.waitForCallback(15000);

      expect(result.error).toBeNull();
      expect(result.state).toBe(state);
      expect(result.code).toBeTruthy();
      expect(result.iss).toBe(server.issuer);

      const tokens = await exchangeAuthorizationCode(request, `${MCP_BASE_URL}/api/mcp/token`, {
        code: result.code as string,
        verifier,
        clientId,
        redirectUri: callback.redirectUri,
        resource: server.resource,
      });

      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      // Unticking write on the consent page narrowed the grant.
      expect(tokens.scope).toBe('read');

      const accessToken = tokens.access_token;
      const toolsResponse = await listTools(request, accessToken);

      expect(toolsResponse.status()).toBe(200);
      expect(((await toolsResponse.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);

      // Settings > MCP > Manage AI apps lists the connection with the granted scope.
      await page.goto('/app?setting=AI_APPS', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('mcp-tab-manage').click();

      const row = page
        .getByTestId('mcp-my-connections')
        .getByTestId('mcp-my-connection-row')
        .filter({ hasText: CLIENT_NAME });

      await expect(row).toHaveCount(1, { timeout: 15000 });
      await expect(row.getByTestId('mcp-scope-badge')).toHaveAttribute('data-level', 'read');

      await row.locator('[data-testid^="mcp-my-disconnect-"]').click();
      await page.getByTestId('mcp-disconnect-dialog').getByTestId('mcp-confirm-disconnect').click();
      await expect(row).toHaveCount(0, { timeout: 15000 });

      // Disconnecting revoked the app's tokens.
      await expect.poll(async () => (await listTools(request, accessToken)).status(), { timeout: 15000 }).toBe(401);
    } finally {
      await callback.close();
    }
  });

  test('cancel returns access_denied to the app through the server', async ({ page, request }) => {
    const callback = await startCallbackServer();

    try {
      await signInAndWaitForApp(page, request, generateRandomEmail(), 1000);

      const server = await discoverServer(request);
      const clientId = await registerClient(request, callback.redirectUri);
      const { challenge } = pkcePair();
      const state = crypto.randomUUID();

      await openConsent(page, {
        clientId,
        redirectUri: callback.redirectUri,
        challenge,
        state,
        resource: server.resource,
      });
      await page.getByTestId('mcp-consent-deny').click();

      const result = await callback.waitForCallback(15000);

      expect(result.error).toBe('access_denied');
      expect(result.code).toBeNull();
      expect(result.state).toBe(state);
      expect(result.iss).toBe(server.issuer);
    } finally {
      await callback.close();
    }
  });
});
