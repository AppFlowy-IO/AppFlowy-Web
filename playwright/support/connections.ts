import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, type Page, type Request } from '@playwright/test';

import { fixtureHTML, test as base } from './integrations-server';

import type { IntegrationConnection, IntegrationProvider } from '../../src/application/integrations/types';

export const CLOUD_ORIGIN = 'https://cloud.connections.test';
export const PROVIDER_ORIGIN = 'https://provider.connections.test';
export const WORKSPACE_ID = 'connection-test-workspace';
export const CALLBACK_PATH = '/api/integrations/connections/callback';

interface Authorization {
  id: string;
  provider: IntegrationProvider;
  state: string;
  code: string;
}

interface ConnectionApp {
  connections: IntegrationConnection[];
  providers: IntegrationProvider[];
  authorizations: Authorization[];
  requests: Request[];
  open: () => Promise<void>;
}

// Only the HTTP boundary is controlled: the panel, hooks, API client, popup,
// cross-origin messaging and callback page all execute in the browser.
export const test = base.extend<{ connectionApp: ConnectionApp }>({
  connectionApp: async ({ context, page, integrationsURL }, use) => {
    const appOrigin = new URL(integrationsURL).origin;
    const callbackHTML = await readFile(
      process.env.APPFLOWY_OAUTH_CALLBACK_HTML || new URL('./fixtures/oauth_callback.html', import.meta.url),
      'utf8'
    );
    const unexpectedRequests: string[] = [];
    const pageErrors: string[] = [];
    const app: ConnectionApp = {
      connections: [],
      providers: ['google-drive', 'google-calendar'],
      authorizations: [],
      requests: [],
      open: async () => {
        await page.goto(new URL('/connections-fixture', integrationsURL).href);
        await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('status', { name: 'Loading connections' })).toBeHidden();
      },
    };

    page.on('pageerror', (error) => pageErrors.push(error.message));
    context.on('request', (request) => {
      const url = new URL(request.url());

      if (url.origin === appOrigin && url.pathname.startsWith('/api/')) app.requests.push(request);
    });

    // Fail closed: a missing mock must never contact Google or a developer's Cloud.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());

      if (url.origin === appOrigin && !url.pathname.startsWith('/api/')) return route.continue();
      unexpectedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    await context.route(`${appOrigin}/connections-fixture`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: fixtureHTML('connections'),
      })
    );
    await context.route(`${appOrigin}/api/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataJSON();
      let data: unknown;

      if (url.pathname === '/api/server-info') {
        expect(request.headers()['x-platform']).toBe('app');
        data = { connections: app.providers };
      } else if (url.pathname === '/api/integrations/connections' && request.method() === 'GET') {
        expect(url.searchParams.get('workspace_id')).toBe(WORKSPACE_ID);
        expect(url.searchParams.get('include_metadata')).toBe('true');
        data = { connections: app.connections };
      } else if (url.pathname.startsWith('/api/integrations/connect/')) {
        const provider = url.pathname.split('/').pop() as IntegrationProvider;

        expect(request.method()).toBe('POST');
        expect(body).toEqual({ workspace_id: WORKSPACE_ID });
        expect(app.providers).toContain(provider);
        const authorization: Authorization = {
          id: randomUUID(),
          state: randomUUID(),
          code: randomUUID(),
          provider,
        };

        app.authorizations.push(authorization);
        const oauthURL = new URL('/authorize', PROVIDER_ORIGIN);

        oauthURL.search = new URLSearchParams({
          state: authorization.state,
          redirect_uri: `${CLOUD_ORIGIN}/callback`,
        }).toString();
        data = { connection_id: authorization.id, oauth_url: oauthURL.href };
      } else if (url.pathname === CALLBACK_PATH) {
        const authorization = app.authorizations.find((item) => item.id === body.connection_id);

        expect(authorization).toBeDefined();
        expect(request.method()).toBe('POST');
        expect(body).toEqual({
          workspace_id: WORKSPACE_ID,
          provider: authorization!.provider,
          connection_id: authorization!.id,
          oauth_query: new URLSearchParams({ code: authorization!.code, state: authorization!.state }).toString(),
        });
        // A duplicate browser confirmation should fail the test, not silently succeed.
        expect(app.connections.some((connection) => connection.id === authorization!.id)).toBe(false);
        const connection: IntegrationConnection = {
          id: authorization!.id,
          provider: authorization!.provider,
          account_identifier: `${authorization!.provider}-${app.connections.length + 1}@example.test`,
          status: 'active',
          connected_at: new Date().toISOString(),
        };

        app.connections.push(connection);
        data = { success: true, connection };
      } else if (url.pathname === '/api/integrations/proxy') {
        expect(request.method()).toBe('POST');
        expect(body.workspace_id).toBe(WORKSPACE_ID);
        expect(body.method).toBe('GET');
        const connection = app.connections.find((item) => item.id === body.connection_id);

        expect(connection).toBeDefined();
        expect(body.endpoint).toBe(
          connection!.provider === 'google-drive' ? '/drive/v3/about/?fields=user' : '/oauth2/v2/userinfo'
        );
        data = {
          data:
            connection!.provider === 'google-drive'
              ? { user: { emailAddress: connection!.account_identifier } }
              : { email: connection!.account_identifier },
        };
      } else if (url.pathname.startsWith('/api/integrations/connections/') && request.method() === 'DELETE') {
        const id = url.pathname.split('/').pop();

        expect(app.connections.some((connection) => connection.id === id)).toBe(true);
        app.connections = app.connections.filter((connection) => connection.id !== id);
        data = { success: true };
      } else {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }

      await route.fulfill({ json: { code: 0, data, message: '' } });
    });
    await context.route(`${PROVIDER_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      const authorization = app.authorizations.find((item) => item.state === url.searchParams.get('state'));

      expect(authorization).toBeDefined();
      expect(url.pathname).toBe('/authorize');
      expect(url.searchParams.get('redirect_uri')).toBe(`${CLOUD_ORIGIN}/callback`);
      // A new navigation lets context.route serve the cross-origin callback;
      // Playwright only routes the first request of an HTTP redirect chain.
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body><h1>Test provider consent</h1>
          <form action="${CLOUD_ORIGIN}/callback" method="get">
            <input type="hidden" name="code" value="${authorization!.code}">
            <input type="hidden" name="state" value="${authorization!.state}">
            <button>Allow access</button>
          </form>
          <form action="${CLOUD_ORIGIN}/callback" method="get">
            <input type="hidden" name="error" value="access_denied">
            <input type="hidden" name="state" value="${authorization!.state}">
            <button>Deny access</button>
          </form></body></html>`,
      });
    });
    await context.route(`${CLOUD_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());

      expect(['/callback', '/message-test']).toContain(url.pathname);
      await route.fulfill({
        contentType: 'text/html',
        body:
          url.pathname === '/callback'
            ? callbackHTML.replace('{{OAUTH_QUERY}}', encodeURIComponent(url.search.slice(1)))
            : '<!doctype html><html><body>Cross-origin message test</body></html>',
      });
    });

    await use(app);
    expect(unexpectedRequests, 'Unexpected network requests').toEqual([]);
    expect(pageErrors, 'Uncaught application errors').toEqual([]);
  },
});

export async function startConnection(page: Page, provider: IntegrationProvider): Promise<Page> {
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const popupOpened = page.waitForEvent('popup');

  await page.getByRole('menuitem', { name: provider === 'google-drive' ? 'Google Drive' : 'Google Calendar' }).click();
  const popup = await popupOpened;

  await expect(popup.getByRole('heading', { name: 'Test provider consent' })).toBeVisible();
  await expect(page.getByText('Complete authorization in the browser window.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeDisabled();
  return popup;
}

export async function allowConnection(popup: Page) {
  await Promise.all([popup.waitForEvent('close'), popup.getByRole('button', { name: 'Allow access' }).click()]);
}
