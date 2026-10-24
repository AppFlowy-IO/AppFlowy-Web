import { act, renderHook, waitFor } from '@testing-library/react';

import { useWorkspaceDatabases } from '../useWorkspaceDatabases';

const mockListeners = new Set<() => void>();
const mockRevision = jest.fn((workspaceId: string) => `${workspaceId}:1`);
const mockCached = jest.fn((_workspaceId: string): unknown[] | undefined => undefined);
const mockLoad = jest.fn((_workspaceId: string) => Promise.resolve([]));

jest.mock('@/application/services/domains/view', () => ({
  getCachedWorkspaceDatabaseCatalog: (workspaceId: string) => mockCached(workspaceId),
  getWorkspaceDatabaseCatalog: (workspaceId: string) => mockLoad(workspaceId),
  getWorkspaceDatabaseCatalogRevision: (workspaceId: string) => mockRevision(workspaceId),
  subscribeWorkspaceDatabaseCatalog: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

function invalidate(revision: string) {
  mockRevision.mockImplementation(() => revision);
  act(() => mockListeners.forEach((listener) => listener()));
}

beforeEach(() => {
  mockListeners.clear();
  mockRevision.mockClear().mockImplementation((workspaceId: string) => `${workspaceId}:1`);
  mockCached.mockClear().mockImplementation(() => undefined);
  mockLoad.mockClear().mockImplementation(() => Promise.resolve([]));
});

describe('useWorkspaceDatabases', () => {
  it('neither reads the catalog revision nor re-renders on invalidations while disabled', () => {
    let renders = 0;
    const { result } = renderHook(
      ({ enabled }) => {
        renders += 1;
        return useWorkspaceDatabases('ws', enabled);
      },
      { initialProps: { enabled: false } }
    );
    const rendered = renders;

    expect(result.current).toEqual({ databases: [], loading: false, error: null });
    expect(mockRevision).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();

    // A folder change invalidates the catalog: nothing here subscribes to it.
    invalidate('ws:2');
    expect(renders).toBe(rendered);
    expect(mockRevision).not.toHaveBeenCalled();
  });

  it('reads the revision and loads once enabled, and reloads on the next invalidation', async () => {
    const { rerender } = renderHook(({ enabled }) => useWorkspaceDatabases('ws', enabled), {
      initialProps: { enabled: false },
    });

    rerender({ enabled: true });
    expect(mockRevision).toHaveBeenCalledWith('ws');
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));

    invalidate('ws:2');
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  });
});
