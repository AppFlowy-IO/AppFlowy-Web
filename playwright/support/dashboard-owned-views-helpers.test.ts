import { seedDatabaseTabs } from './dashboard-owned-views-helpers';
import { apiPost, createDatabaseViewThroughApi } from './dashboard-test-helpers';

import type { APIRequestContext, Page } from '@playwright/test';

jest.mock('@playwright/test', () => ({ expect }));
jest.mock('./dashboard-test-helpers', () => ({
  apiPost: jest.fn(),
  createDatabaseViewThroughApi: jest.fn(),
  dashboardWorld: () => ({ workspaceId: 'workspace', owner: { accessToken: 'token' } }),
  fixtureDatabase: () => ({ pageId: 'parent', databaseId: 'database', views: { Grid: 'original-grid' } }),
}));
jest.mock('./duplicate-test-helpers', () => ({}));
jest.mock('./page-utils', () => ({}));
jest.mock('./selectors', () => ({}));

const atomicCreate = createDatabaseViewThroughApi as jest.MockedFunction<typeof createDatabaseViewThroughApi>;
const legacyPost = apiPost as jest.Mock;
const page = {} as Page;
const request = {} as APIRequestContext;

beforeEach(() => {
  jest.clearAllMocks();
  legacyPost.mockRejectedValue(new Error('Database views changed during admission; refresh and retry'));
});

it('seeds twelve ordered Grid tabs through the idempotent fixture boundary', async () => {
  atomicCreate.mockImplementation(async () => `created-${atomicCreate.mock.calls.length}`);

  await expect(seedDatabaseTabs(page, request, 'Projects', 12)).resolves.toEqual(
    Array.from({ length: 12 }, (_, index) => `created-${index + 1}`)
  );
  expect(atomicCreate.mock.calls.map(([calledPage, calledRequest, view]) => ({
    sameContext: calledPage === page && calledRequest === request,
    ...view,
  }))).toEqual(Array.from({ length: 12 }, (_, index) => ({
    sameContext: true, database: 'Projects', folderLayout: 1, name: `Grid ${index + 1}`,
    prevViewId: index === 0 ? 'original-grid' : `created-${index}`,
  })));
  expect(legacyPost).not.toHaveBeenCalled();
});

it('propagates a terminal atomic failure without repeating creation or seeding later tabs', async () => {
  const failure = new Error('Fixture view creation failed: 1017');

  atomicCreate.mockResolvedValueOnce('created-1').mockRejectedValueOnce(failure);
  await expect(seedDatabaseTabs(page, request, 'Projects', 12)).rejects.toBe(failure);
  expect(atomicCreate).toHaveBeenCalledTimes(2);
  expect(legacyPost).not.toHaveBeenCalled();
});
