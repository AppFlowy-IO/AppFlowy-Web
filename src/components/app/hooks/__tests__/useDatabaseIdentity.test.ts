import { renderHook } from '@testing-library/react';

import { getDatabaseIdFromWorkspaceCatalog, getViewIdFromWorkspaceCatalog } from '@/application/services/domains/view';

import { useDatabaseIdentity } from '../useDatabaseIdentity';

jest.mock('@/application/view-loader', () => ({
  getDatabaseIdFromDoc: jest.fn(),
}));

jest.mock('@/application/services/domains/view', () => ({
  getDatabaseIdFromWorkspaceCatalog: jest.fn(),
  getViewIdFromWorkspaceCatalog: jest.fn(),
}));

const WORKSPACE_ID = 'workspace-1';
const DATABASE_ID = 'database-1';
const PRIMARY_VIEW_ID = 'view-1';
const SECONDARY_VIEW_ID = 'view-2';
const STORAGE_KEY = `db_mappings_${WORKSPACE_ID}`;
const DATABASE_MAPPINGS = {
  [DATABASE_ID]: [PRIMARY_VIEW_ID, SECONDARY_VIEW_ID],
};

type LoadDatabaseRelations = (options?: { refresh?: boolean }) => Promise<Record<string, string> | undefined>;

function renderDatabaseIdentity(loadDatabaseRelations?: LoadDatabaseRelations) {
  const params: Parameters<typeof useDatabaseIdentity>[0] = {
    currentWorkspaceId: WORKSPACE_ID,
    loadDatabaseRelations,
  };

  return renderHook(() => useDatabaseIdentity(params));
}

describe('useDatabaseIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', `/app/${WORKSPACE_ID}/page`);
    jest.mocked(getDatabaseIdFromWorkspaceCatalog).mockResolvedValue(null);
    jest.mocked(getViewIdFromWorkspaceCatalog).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves a database view from template duplication URL mappings', async () => {
    const encodedMappings = encodeURIComponent(JSON.stringify(DATABASE_MAPPINGS));

    window.history.replaceState({}, '', `/app/${WORKSPACE_ID}/page?db_mappings=${encodedMappings}`);

    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(DATABASE_MAPPINGS);
  });

  it('uses URL mappings when localStorage persistence is unavailable', async () => {
    const storageError = new DOMException('Storage is disabled', 'SecurityError');

    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw storageError;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const encodedMappings = encodeURIComponent(JSON.stringify(DATABASE_MAPPINGS));

    window.history.replaceState({}, '', `/app/${WORKSPACE_ID}/page?db_mappings=${encodedMappings}`);

    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
  });

  it('resolves a database view from persisted template mappings after reload', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DATABASE_MAPPINGS));

    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
  });

  it('resolves a database view through the IndexedDB-backed workspace catalog', async () => {
    jest.mocked(getViewIdFromWorkspaceCatalog).mockResolvedValue(PRIMARY_VIEW_ID);
    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
    expect(getViewIdFromWorkspaceCatalog).toHaveBeenCalledWith(WORKSPACE_ID, DATABASE_ID);
  });

  it('falls back to refreshed workspace relation metadata when the catalog misses a legacy database', async () => {
    const loadDatabaseRelations = jest
      .fn<ReturnType<LoadDatabaseRelations>, Parameters<LoadDatabaseRelations>>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ [DATABASE_ID]: PRIMARY_VIEW_ID });
    const { result } = renderDatabaseIdentity(loadDatabaseRelations);

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);

    expect(getViewIdFromWorkspaceCatalog).toHaveBeenCalledWith(WORKSPACE_ID, DATABASE_ID);
    expect(loadDatabaseRelations).toHaveBeenNthCalledWith(1);
    expect(loadDatabaseRelations).toHaveBeenNthCalledWith(2, { refresh: true });
  });

  it('shares and briefly caches a missing legacy relation lookup across remount callers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00Z'));
    const loadDatabaseRelations = jest
      .fn<ReturnType<LoadDatabaseRelations>, Parameters<LoadDatabaseRelations>>()
      .mockResolvedValue({});
    const first = renderDatabaseIdentity(loadDatabaseRelations);
    const second = renderDatabaseIdentity(loadDatabaseRelations);

    await expect(
      Promise.all([
        first.result.current.getViewIdFromDatabaseId(DATABASE_ID),
        second.result.current.getViewIdFromDatabaseId(DATABASE_ID),
      ])
    ).resolves.toEqual([null, null]);
    expect(loadDatabaseRelations).toHaveBeenCalledTimes(2);

    first.unmount();
    const remounted = renderDatabaseIdentity(loadDatabaseRelations);

    await expect(remounted.result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBeNull();
    expect(loadDatabaseRelations).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(30_001);
    await expect(remounted.result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBeNull();
    expect(loadDatabaseRelations).toHaveBeenCalledTimes(4);
  });

  it('resolves a database ID through the IndexedDB-backed workspace catalog', async () => {
    jest.mocked(getDatabaseIdFromWorkspaceCatalog).mockResolvedValue(DATABASE_ID);
    const { result } = renderDatabaseIdentity();

    await expect(result.current.getDatabaseIdForViewId(SECONDARY_VIEW_ID)).resolves.toBe(DATABASE_ID);
    expect(getDatabaseIdFromWorkspaceCatalog).toHaveBeenCalledWith(WORKSPACE_ID, SECONDARY_VIEW_ID);
  });
});
