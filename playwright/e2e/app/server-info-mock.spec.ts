import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import { mockServerInfoPreservingCapabilities } from '../../support/server-info-helpers';

test('billing override preserves real capabilities and conditional refresh responses', async ({ page }) => {
  let revision = 1;
  const requests: { platform: string | undefined; version: string | undefined; validator: string | undefined }[] = [];
  const server = createServer((request, response) => {
    if (request.url !== '/api/server-info') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Server info fixture</title>');
      return;
    }

    requests.push({
      platform: request.headers['x-platform'] as string | undefined,
      version: request.headers['client-version'] as string | undefined,
      validator: request.headers['if-none-match'],
    });
    const etag = `"capabilities-${revision}"`;

    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
    response.end(
      JSON.stringify({
        code: 0,
        data: {
          self_hosted: true,
          enable_page_history: true,
          enable_database_history: revision > 1,
          ai_enabled: false,
        },
        message: 'success',
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();

    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a port');
    await mockServerInfoPreservingCapabilities(page, { self_hosted: false });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const refresh = (validator?: string) =>
      page.evaluate(async (etag) => {
        const response = await fetch('/api/server-info', {
          headers: {
            'x-platform': 'web',
            'client-version': '1.2.3',
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
          cache: 'no-store',
        });

        return {
          status: response.status,
          etag: response.headers.get('etag'),
          body: response.status === 304 ? null : await response.json(),
        };
      }, validator);
    const first = await refresh();

    expect(first).toEqual({
      status: 200,
      etag: '"capabilities-1"',
      body: {
        code: 0,
        data: { self_hosted: false, enable_page_history: true, enable_database_history: false, ai_enabled: false },
        message: 'success',
      },
    });
    expect(await refresh(first.etag!)).toEqual({ status: 304, etag: first.etag, body: null });

    revision = 2;
    const changed = await refresh(first.etag!);

    expect(changed.status).toBe(200);
    expect(changed.etag).toBe('"capabilities-2"');
    expect(changed.body.data).toEqual({
      self_hosted: false,
      enable_page_history: true,
      enable_database_history: true,
      ai_enabled: false,
    });
    expect(requests).toEqual([
      { platform: 'web', version: '1.2.3', validator: undefined },
      { platform: 'web', version: '1.2.3', validator: first.etag },
      { platform: 'web', version: '1.2.3', validator: first.etag },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
