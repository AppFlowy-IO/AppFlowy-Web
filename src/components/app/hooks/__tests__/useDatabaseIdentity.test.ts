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

function renderDatabaseIdentity() {
  const params: Parameters<typeof useDatabaseIdentity>[0] = {
    currentWorkspaceId: WORKSPACE_ID,
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

  it('resolves a database ID through the IndexedDB-backed workspace catalog', async () => {
    jest.mocked(getDatabaseIdFromWorkspaceCatalog).mockResolvedValue(DATABASE_ID);
    const { result } = renderDatabaseIdentity();

    await expect(result.current.getDatabaseIdForViewId(SECONDARY_VIEW_ID)).resolves.toBe(DATABASE_ID);
    expect(getDatabaseIdFromWorkspaceCatalog).toHaveBeenCalledWith(WORKSPACE_ID, SECONDARY_VIEW_ID);
  });
});
