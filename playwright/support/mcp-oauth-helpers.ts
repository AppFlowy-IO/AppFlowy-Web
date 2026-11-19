/**
 * The OAuth client side of the MCP Playwright specs, as a local AI app runs it: a loopback redirect
 * URI, PKCE, strict metadata reads and the authorization-code exchange. Each spec keeps its own
 * source for the endpoints (configured paths or full discovery).
 */
import { expect, type APIRequestContext } from '@playwright/test';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** The query of the authorization server's redirect to the app. */
export interface CallbackResult {
  code: string | null;
  error: string | null;
  state: string | null;
  iss: string | null;
}

export interface CallbackServer {
  redirectUri: string;
  /** Resolves with the first redirect to `/callback`; rejects when none arrives within `timeoutMs`. */
  waitForCallback: (timeoutMs: number) => Promise<CallbackResult>;
  close: () => Promise<void>;
}

/** A successful token answer (RFC 6749 §5.1) from the MCP service. */
export interface McpTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  scope?: string;
  /** The workspace the grant is bound to. */
  workspace_id: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A loopback redirect URI, like the ones local AI apps (Claude Code, Codex, Cursor, VS Code) register. */
export async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCallback!: (result: CallbackResult) => void;
  const callback = new Promise<CallbackResult>((resolve) => {
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
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCallback: (timeoutMs) => withTimeout(callback, timeoutMs, 'Timed out waiting for the MCP OAuth callback'),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = `verifier-${crypto.randomBytes(48).toString('base64url')}`;
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  return { verifier, challenge };
}

/** Reads a metadata document; anything but a 200 fails the test instead of passing on without it. */
export async function getJson(request: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const response = await request.get(url, { failOnStatusCode: false });

  expect(response.status(), `GET ${url}`).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** Exchanges an authorization code at the token endpoint, with the PKCE verifier and `resource` (RFC 8707). */
export async function exchangeAuthorizationCode(
  request: APIRequestContext,
  tokenEndpoint: string,
  params: { code: string; verifier: string; clientId: string; redirectUri: string; resource: string }
): Promise<McpTokenResponse> {
  const response = await request.post(tokenEndpoint, {
    form: {
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.verifier,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      resource: params.resource,
    },
    failOnStatusCode: false,
  });
  const body = await response.text();

  expect(response.status(), `POST ${tokenEndpoint}: ${body}`).toBe(200);
  return JSON.parse(body) as McpTokenResponse;
}
