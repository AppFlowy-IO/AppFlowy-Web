import { render, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { Types, UIVariant, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

import {
  type EmbeddedDatabasePermissions,
  EmbeddedDatabasePermissionsResolver,
  resolveEmbeddedDatabaseCollabId,
  useAppEmbeddedDatabasePermissions,
} from '../useEmbeddedDatabasePermissions';

jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: jest.fn(),
}));

const mockUseViewActionPermissions = useViewActionPermissions as jest.MockedFunction<typeof useViewActionPermissions>;

const sourceViewId = 'source-view-id';
const sourceDatabaseId = 'source-database-id';

function mockSourceCapabilities(canWrite: boolean, canShare: boolean) {
  mockUseViewActionPermissions.mockReturnValue({
    canRead: true,
    canWrite,
    canShare,
    canCreateViewActions: canWrite,
    canManageViewActions: canShare,
    canUsePageHistory: canWrite,
    hasLoadedViewActionPermissions: true,
    isLoadingViewActionPermissions: false,
  });
}

describe('useEmbeddedDatabasePermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('derives the canonical database collab from a legacy block document', () => {
    const doc = new Y.Doc({ guid: 'legacy-view-id' });
    const root = doc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map<unknown>();

    database.set(YjsDatabaseKey.id, sourceDatabaseId);
    root.set(YjsEditorKey.database, database);

    expect(resolveEmbeddedDatabaseCollabId(undefined, doc)).toBe(sourceDatabaseId);
  });

  it('falls back to the loaded collab guid when a legacy database has no inner ID', () => {
    const doc = new Y.Doc({ guid: 'legacy-database-collab-id' });

    expect(resolveEmbeddedDatabaseCollabId(undefined, doc)).toBe('legacy-database-collab-id');
  });

  it('keeps a writable parent document from granting writes to a read-only source database', () => {
    mockSourceCapabilities(false, false);

    const { result } = renderHook(() =>
      useAppEmbeddedDatabasePermissions({
        sourceViewId,
        sourceDatabaseId,
      })
    );

    expect(result.current).toEqual({ readOnly: true, canWrite: false, canShare: false });
    expect(mockUseViewActionPermissions).toHaveBeenCalledWith(null, true, sourceViewId, {
      collabObjectId: sourceDatabaseId,
      collabType: Types.Database,
    });
  });

  it('uses source sharing permission even when the parent document cannot share', () => {
    mockSourceCapabilities(true, true);

    const { result } = renderHook(() =>
      useAppEmbeddedDatabasePermissions({
        sourceViewId,
        sourceDatabaseId,
      })
    );

    expect(result.current).toEqual({ readOnly: false, canWrite: true, canShare: true });
  });

  it('probes the known database collab without requiring source folder metadata', () => {
    mockSourceCapabilities(true, false);

    const { result } = renderHook(() =>
      useAppEmbeddedDatabasePermissions({
        sourceViewId,
        sourceDatabaseId,
      })
    );

    expect(result.current).toEqual({ readOnly: false, canWrite: true, canShare: false });
    expect(mockUseViewActionPermissions).toHaveBeenCalledWith(null, true, sourceViewId, {
      collabObjectId: sourceDatabaseId,
      collabType: Types.Database,
    });
  });

  it('fails closed until the database collab identity is available', () => {
    mockSourceCapabilities(false, false);

    const { result } = renderHook(() =>
      useAppEmbeddedDatabasePermissions({
        sourceViewId,
      })
    );

    expect(result.current).toEqual({ readOnly: true, canWrite: false, canShare: false });
    expect(mockUseViewActionPermissions).toHaveBeenCalledWith(null, false, sourceViewId, undefined);
  });

  it('preserves the static publish permissions without mounting the app permission resolver', () => {
    mockSourceCapabilities(false, false);
    let resolvedPermissions: EmbeddedDatabasePermissions | undefined;

    render(
      <EmbeddedDatabasePermissionsResolver
        sourceViewId={sourceViewId}
        sourceDatabaseId={sourceDatabaseId}
        variant={UIVariant.Publish}
        publishReadOnly
      >
        {(permissions) => {
          resolvedPermissions = permissions;
          return null;
        }}
      </EmbeddedDatabasePermissionsResolver>
    );

    expect(resolvedPermissions).toEqual({ readOnly: true, canWrite: false, canShare: false });
    expect(mockUseViewActionPermissions).not.toHaveBeenCalled();
  });
});
