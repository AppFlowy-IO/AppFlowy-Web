import { renderHook } from '@testing-library/react';

import type { SyncContextType } from '@/components/ws/useSync';

import { useDatabaseIdentity } from '../useDatabaseIdentity';

jest.mock('@/application/db', () => ({
  openCollabDB: jest.fn(),
}));

jest.mock('@/application/view-loader', () => ({
  getDatabaseIdFromDoc: jest.fn(),
}));

const WORKSPACE_ID = 'workspace-1';
const DATABASE_ID = 'database-1';
const PRIMARY_VIEW_ID = 'view-1';
const SECONDARY_VIEW_ID = 'view-2';
const STORAGE_KEY = `db_mappings_${WORKSPACE_ID}`;
const DATABASE_MAPPINGS = {
  [DATABASE_ID]: [PRIMARY_VIEW_ID, SECONDARY_VIEW_ID],
};

const registerSyncContext = jest.fn() as unknown as SyncContextType['registerSyncContext'];

function renderDatabaseIdentity() {
  return renderHook(() =>
    useDatabaseIdentity({
      currentWorkspaceId: WORKSPACE_ID,
      registerSyncContext,
    })
  );
}

describe('useDatabaseIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', `/app/${WORKSPACE_ID}/page`);
  });

  it('resolves a database view from template duplication URL mappings', async () => {
    const encodedMappings = encodeURIComponent(JSON.stringify(DATABASE_MAPPINGS));

    window.history.replaceState({}, '', `/app/${WORKSPACE_ID}/page?db_mappings=${encodedMappings}`);

    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(DATABASE_MAPPINGS);
  });

  it('resolves a database view from persisted template mappings after reload', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DATABASE_MAPPINGS));

    const { result } = renderDatabaseIdentity();

    await expect(result.current.getViewIdFromDatabaseId(DATABASE_ID)).resolves.toBe(PRIMARY_VIEW_ID);
  });
});
