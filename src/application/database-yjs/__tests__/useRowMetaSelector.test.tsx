import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, RowMetaKey, useRowMetaSelector } from '@/application/database-yjs';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { YDoc, YjsEditorKey } from '@/application/types';

const rowId = 'c570d6fd-4ec2-4ce9-9c2f-2bca48174007';

function createWrapper(rowDoc: YDoc) {
  const databaseDoc = new Y.Doc() as YDoc;
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: 'database-page-id',
    activeViewId: 'board-view-id',
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useRowMetaSelector', () => {
  it('observes metadata that arrives after an initially empty row doc', async () => {
    const localRowDoc = new Y.Doc() as YDoc;
    const remoteRowDoc = new Y.Doc();
    const remoteRoot = remoteRowDoc.getMap(YjsEditorKey.data_section);
    const remoteMeta = new Y.Map<unknown>();
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    expect(isDocumentEmptyKey).toBeDefined();
    remoteMeta.set(isDocumentEmptyKey as string, false);
    remoteRoot.set(YjsEditorKey.meta, remoteMeta);

    const { result } = renderHook(() => useRowMetaSelector(rowId), {
      wrapper: createWrapper(localRowDoc),
    });

    expect(result.current?.isEmptyDocument).not.toBe(false);

    act(() => {
      Y.applyUpdate(localRowDoc, Y.encodeStateAsUpdate(remoteRowDoc));
    });

    await waitFor(() => {
      expect(result.current?.isEmptyDocument).toBe(false);
    });
  });
});
