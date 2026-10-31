import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import {
  unpublishFixture,
  type SavedDashboard,
} from '../../support/dashboard-publish-fixture-helpers';

const fixture: SavedDashboard = {
  key: 'cleanup-test',
  title: 'Cleanup test',
  workspaceId: 'workspace',
  workspaceName: 'Test workspace',
  spaceId: 'space',
  dashboardViewId: 'dashboard',
  hostPageId: 'host',
  hostDatabaseId: 'database',
  sourcePageIds: ['host', 'source'],
  widgets: [],
};

function mockResponse(body: unknown): APIResponse {
  return {
    ok: () => true,
    status: () => 200,
    json: async () => body,
  } as APIResponse;
}

function mockPublications(options: {
  lookupFailure?: string;
  unpublishFailure?: string;
  retainedPublication?: string;
} = {}) {
  const published = new Set(['dashboard', 'host', 'source']);
  const lookedUp: string[] = [];
  const unpublished: string[] = [];
  const request = {
    get: async (url: string) => {
      const viewId = new URL(url).pathname.split('/').at(-1)!;

      lookedUp.push(viewId);
      if (viewId === options.lookupFailure) throw new Error(`Lookup unavailable for ${viewId}`);
      return mockResponse(published.has(viewId)
        ? { code: 0, data: { view_id: viewId, namespace: 'fixture', publish_name: viewId } }
        : { code: -2 });
    },
    post: async (url: string) => {
      const match = new URL(url).pathname.match(/^\/api\/workspace\/workspace\/page-view\/([^/]+)\/unpublish$/);

      if (!match) throw new Error(`Unexpected mutation: ${url}`);
      const viewId = match[1];

      unpublished.push(viewId);
      if (viewId === options.unpublishFailure) throw new Error(`Unpublish unavailable for ${viewId}`);
      if (viewId !== options.retainedPublication) published.delete(viewId);
      return mockResponse({ code: 0 });
    },
  } as unknown as APIRequestContext;

  return { request, lookedUp, unpublished, published };
}

test('a failed unpublish still cleans up every later fixture publication', async () => {
  const mock = mockPublications({ unpublishFailure: 'dashboard' });

  await expect(unpublishFixture(mock.request, 'test-token', fixture)).rejects.toThrow(
    'dashboard: Unpublish unavailable for dashboard'
  );
  expect(mock.unpublished).toEqual(['dashboard', 'host', 'source']);
  expect([...mock.published]).toEqual(['dashboard']);
});

test('lookup and unpublish failures are both reported after later sources are cleaned up', async () => {
  const mock = mockPublications({ lookupFailure: 'dashboard', unpublishFailure: 'host' });
  const failure = await unpublishFixture(mock.request, 'test-token', fixture).catch((error: Error) => error);

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('dashboard: Lookup unavailable for dashboard');
  expect((failure as Error).message).toContain('host: Unpublish unavailable for host');
  expect(mock.lookedUp).toContain('source');
  expect(mock.unpublished).toEqual(['host', 'source']);
  expect([...mock.published]).toEqual(['dashboard', 'host']);
});

test('cleanup detects a publication still exposed after a successful unpublish response', async () => {
  const mock = mockPublications({ retainedPublication: 'dashboard' });

  await expect(unpublishFixture(mock.request, 'test-token', fixture)).rejects.toThrow(
    'Fixture view dashboard must no longer be public'
  );
  expect(mock.unpublished).toEqual(['dashboard', 'host', 'source']);
  expect([...mock.published]).toEqual(['dashboard']);
});
