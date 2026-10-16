import EventEmitter from 'events';

import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { Types, YDoc, YDocWithMeta } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';

import { useViewOperations } from '../useViewOperations';

const mockOpenView = jest.fn();
const mockResolveCollabObjectId = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

jest.mock('@/application/view-loader', () => ({
  openView: (...args: unknown[]) => mockOpenView(...args),
}));

jest.mock('../useDatabaseIdentity', () => ({
  useDatabaseIdentity: () => ({
    resolveCollabObjectId: mockResolveCollabObjectId,
    getDatabaseIdForViewId: jest.fn(),
    getViewIdFromDatabaseId: jest.fn(),
  }),
}));

describe('useViewOperations database metadata hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['metadata-only', 'embedded', 'page'] as const)('keeps the correct database owner during %s loading', async (loadKind) => {
    const workspaceId = 'workspace-id';
    const databaseId = 'database-id';
    const activeViewId = 'grid-view-id';
    const metadataViewId = 'form-view-id';
    const canonicalDoc = new Y.Doc() as YDocWithMeta;

    canonicalDoc.object_id = databaseId;
    canonicalDoc.view_id = activeViewId;
    canonicalDoc._collabType = Types.Database;
    canonicalDoc._syncBound = true;

    mockOpenView.mockResolvedValue({
      doc: canonicalDoc,
      fromCache: false,
      collabType: Types.Database,
    });
    mockResolveCollabObjectId.mockResolvedValue(databaseId);

    const authContextValue: AuthInternalContextType = {
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: () => Promise.resolve(),
    };
    const syncContextValue: SyncInternalContextType = {
      registerSyncContext: jest.fn(),
      eventEmitter: new EventEmitter(),
      awarenessMap: {},
    } as unknown as SyncInternalContextType;

    const { result } = renderHook(() => useViewOperations(), {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={authContextValue}>
          <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      ),
    });

    let hydratedDoc: YDoc | undefined;

    await act(async () => {
      hydratedDoc = await result.current.loadView(metadataViewId, false, false, undefined, {
        databaseId,
        databaseMetadataOnly: loadKind === 'metadata-only',
        preserveViewMetadata: loadKind === 'embedded',
        forceFetch: true,
      });
    });

    expect(hydratedDoc).toBe(canonicalDoc);
    expect(mockOpenView).toHaveBeenCalledWith(workspaceId, metadataViewId, undefined, {
      databaseId,
      databaseMetadataOnly: loadKind === 'metadata-only',
      forceFetch: true,
    });
    expect(canonicalDoc.view_id).toBe(loadKind === 'page' ? metadataViewId : activeViewId);
    expect(canonicalDoc._syncBound).toBe(loadKind !== 'page');
  });
});
