import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { RowService } from '@/application/services/domains';
import { YDoc } from '@/application/types';
import { useAuthInternal } from '@/components/app/contexts/AuthInternalContext';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import { useRowOperations } from '@/components/app/hooks/useRowOperations';

jest.mock('@/application/services/domains', () => ({
  RowService: {
    create: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('@/components/app/contexts/AuthInternalContext', () => ({
  useAuthInternal: jest.fn(),
}));

jest.mock('@/components/app/contexts/SyncInternalContext', () => ({
  useSyncInternal: jest.fn(),
}));

describe('useRowOperations', () => {
  it('returns the canonical live row doc when retrying synchronization', async () => {
    const databaseId = '11111111-1111-4111-8111-111111111111';
    const rowId = '22222222-2222-4222-8222-222222222222';
    const rowKey = `${databaseId}_rows_${rowId}`;
    const canonicalDoc = new Y.Doc({ guid: rowId }) as YDoc;
    const staleCachedDoc = new Y.Doc({ guid: rowId }) as YDoc;
    const rebindSyncContext = jest.fn(() => canonicalDoc);
    const registerSyncContext = jest.fn();

    jest
      .mocked(useAuthInternal)
      .mockReturnValue({ currentWorkspaceId: 'workspace-id' } as ReturnType<typeof useAuthInternal>);
    jest
      .mocked(useSyncInternal)
      .mockReturnValue({ rebindSyncContext, registerSyncContext } as ReturnType<typeof useSyncInternal>);
    jest.mocked(RowService.create).mockResolvedValue(staleCachedDoc);

    const { result, unmount } = renderHook(() => useRowOperations());

    await expect(result.current.createRow(rowKey, { forceSync: true })).resolves.toBe(canonicalDoc);
    expect(rebindSyncContext).toHaveBeenCalledTimes(1);
    expect(rebindSyncContext).toHaveBeenCalledWith(rowId);
    expect(RowService.create).not.toHaveBeenCalled();
    expect(registerSyncContext).not.toHaveBeenCalled();

    unmount();
    canonicalDoc.destroy();
    staleCachedDoc.destroy();
  });
});
