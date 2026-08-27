import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, RowMetaKey, useRowMetaSelector } from '@/application/database-yjs';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { YDoc, YjsEditorKey } from '@/application/types';

const rowId = 'c570d6fd-4ec2-4ce9-9c2f-2bca48174007';

function createWrapper(rowDoc: YDoc, ensureRow?: DatabaseContextState['ensureRow']) {
  const databaseDoc = new Y.Doc() as YDoc;
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: 'database-page-id',
    activeViewId: 'board-view-id',
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
    ensureRow,
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

  it('observes row-page metadata from the canonical doc when a seed shell is already present', async () => {
    const shellRowDoc = new Y.Doc() as YDoc;
    const shellRoot = shellRowDoc.getMap(YjsEditorKey.data_section);
    const shellMeta = new Y.Map<unknown>();
    const canonicalRowDoc = new Y.Doc() as YDoc;
    const canonicalRoot = canonicalRowDoc.getMap(YjsEditorKey.data_section);
    const canonicalMeta = new Y.Map<unknown>();
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    expect(isDocumentEmptyKey).toBeDefined();
    shellMeta.set(isDocumentEmptyKey as string, true);
    shellRoot.set(YjsEditorKey.meta, shellMeta);
    canonicalMeta.set(isDocumentEmptyKey as string, true);
    canonicalRoot.set(YjsEditorKey.meta, canonicalMeta);

    const ensureRow = jest.fn(async () => canonicalRowDoc);
    const { result } = renderHook(() => useRowMetaSelector(rowId), {
      wrapper: createWrapper(shellRowDoc, ensureRow),
    });

    await waitFor(() => {
      expect(result.current?.isEmptyDocument).toBe(true);
    });

    act(() => {
      canonicalMeta.set(isDocumentEmptyKey as string, false);
    });

    await waitFor(() => {
      expect(result.current?.isEmptyDocument).toBe(false);
    });
  });

  it('clears metadata when the canonical row doc is replaced by an empty doc', async () => {
    const initialRowDoc = new Y.Doc() as YDoc;
    const initialRoot = initialRowDoc.getMap(YjsEditorKey.data_section);
    const initialMeta = new Y.Map<unknown>();
    const replacementRowDoc = new Y.Doc() as YDoc;
    const databaseDoc = new Y.Doc() as YDoc;
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    expect(isDocumentEmptyKey).toBeDefined();
    initialMeta.set(isDocumentEmptyKey as string, false);
    initialRoot.set(YjsEditorKey.meta, initialMeta);

    let contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: 'database-page-id',
      activeViewId: 'board-view-id',
      rowMap: { [rowId]: initialRowDoc },
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, rerender, unmount } = renderHook(() => useRowMetaSelector(rowId), { wrapper });

    expect(result.current?.isEmptyDocument).toBe(false);

    contextValue = { ...contextValue, rowMap: { [rowId]: replacementRowDoc } };
    rerender();

    await waitFor(() => {
      expect(result.current).toBeNull();
    });

    unmount();
    initialRowDoc.destroy();
    replacementRowDoc.destroy();
    databaseDoc.destroy();
  });

  it('clears metadata when the active row doc removes its metadata map', async () => {
    const rowDoc = new Y.Doc() as YDoc;
    const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const rowMeta = new Y.Map<unknown>();
    const isDocumentEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty);

    expect(isDocumentEmptyKey).toBeDefined();
    rowMeta.set(isDocumentEmptyKey as string, false);
    rowRoot.set(YjsEditorKey.meta, rowMeta);

    const { result, unmount } = renderHook(() => useRowMetaSelector(rowId), {
      wrapper: createWrapper(rowDoc),
    });

    expect(result.current?.isEmptyDocument).toBe(false);

    act(() => {
      rowRoot.delete(YjsEditorKey.meta);
    });

    await waitFor(() => {
      expect(result.current).toBeNull();
    });

    unmount();
    rowDoc.destroy();
  });
});
