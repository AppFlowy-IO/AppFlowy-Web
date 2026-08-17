import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { useDatabase, useDatabaseContextOptional, useRowData, useRowMetaSelector } from '@/application/database-yjs';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { openCollabDB } from '@/application/db';
import { getCachedRowSubDoc, getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { CollabOrigin, YDatabase, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { DatabaseRowSubDocument } from '../DatabaseRowSubDocument';

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabase: jest.fn(),
  useDatabaseContextOptional: jest.fn(),
  useRowData: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateRowMetaDispatch: jest.fn(),
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn().mockResolvedValue(true),
  openCollabDB: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowSubDoc: jest.fn(),
  getOrCreateRowSubDoc: jest.fn(),
  trackRowDocEnsure: jest.fn(),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: jest.fn(),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: jest.fn(),
}));

jest.mock('@/components/_shared/skeleton/EditorSkeleton', () => ({
  EditorSkeleton: () => <div data-testid='editor-skeleton' />,
}));

jest.mock('@/components/editor', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    Editor: ({
      viewId,
      doc,
      readOnly,
      canComment,
      canWrite,
      contentPadding,
      onEditorConnected,
    }: {
      viewId: string;
      doc: { guid: string };
      readOnly: boolean;
      canComment?: boolean;
      canWrite?: boolean;
      contentPadding?: string;
      onEditorConnected?: (editor: { children: unknown[] }) => void;
    }) => {
      React.useEffect(() => {
        onEditorConnected?.({ children: [] });
      }, [onEditorConnected]);

      return (
        <div
          data-testid='row-document-editor'
          data-view-id={viewId}
          data-doc-id={doc.guid}
          data-read-only={String(readOnly)}
          data-can-comment={String(canComment)}
          data-can-write={String(canWrite)}
          data-content-padding={contentPadding}
        />
      );
    },
  };
});

const mockUseDatabase = useDatabase as jest.MockedFunction<typeof useDatabase>;
const mockUseDatabaseContextOptional = useDatabaseContextOptional as jest.MockedFunction<
  typeof useDatabaseContextOptional
>;
const mockUseRowData = useRowData as jest.MockedFunction<typeof useRowData>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;
const mockUseUpdateRowMetaDispatch = useUpdateRowMetaDispatch as jest.MockedFunction<typeof useUpdateRowMetaDispatch>;
const mockOpenCollabDB = openCollabDB as jest.MockedFunction<typeof openCollabDB>;
const mockGetCachedRowSubDoc = getCachedRowSubDoc as jest.MockedFunction<typeof getCachedRowSubDoc>;
const mockGetOrCreateRowSubDoc = getOrCreateRowSubDoc as jest.MockedFunction<typeof getOrCreateRowSubDoc>;
const mockUseCurrentWorkspaceIdOptional = useCurrentWorkspaceIdOptional as jest.MockedFunction<
  typeof useCurrentWorkspaceIdOptional
>;
const mockUseCurrentUserOptional = useCurrentUserOptional as jest.MockedFunction<typeof useCurrentUserOptional>;

function createRowDocumentState(documentId: string) {
  const doc = new Y.Doc({ guid: documentId });
  const root = doc.getMap(YjsEditorKey.data_section);

  root.set(YjsEditorKey.document, new Y.Map());
  return Y.encodeStateAsUpdate(doc);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index++) {
    await Promise.resolve();
  }
}

function configureRowDocumentTest({
  documentIds,
  cachedDocs,
  loadRowDocument,
  createRowDocument,
  checkIfRowDocumentExists,
  isEmptyDocument = false,
  readOnly = false,
  canComment = false,
  canWrite = !readOnly,
}: {
  documentIds: Record<string, string>;
  cachedDocs: Map<string, YDoc>;
  loadRowDocument: jest.Mock;
  createRowDocument: jest.Mock;
  checkIfRowDocumentExists: jest.Mock;
  isEmptyDocument?: boolean;
  readOnly?: boolean;
  canComment?: boolean;
  canWrite?: boolean;
}) {
  const databaseDoc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const database = databaseDoc.getMap('database') as YDatabase;
  const fields = new Y.Map();
  const rows = new Map<string, YDatabaseRow>();

  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);

  for (const rowId of Object.keys(documentIds)) {
    const rowDoc = new Y.Doc({ guid: rowId });
    const row = rowDoc.getMap('row') as YDatabaseRow;

    row.set(YjsDatabaseKey.cells, new Y.Map());
    rows.set(rowId, row);
  }

  mockUseDatabase.mockReturnValue(database);
  mockUseRowData.mockImplementation((rowId) => rows.get(rowId));
  mockUseRowMetaSelector.mockImplementation((rowId) => ({
    documentId: documentIds[rowId],
    isEmptyDocument,
  }));
  mockUseUpdateRowMetaDispatch.mockReturnValue(jest.fn());
  mockUseCurrentWorkspaceIdOptional.mockReturnValue('workspace-id');
  mockUseCurrentUserOptional.mockReturnValue(undefined);
  mockGetCachedRowSubDoc.mockImplementation((documentId) => cachedDocs.get(documentId));
  mockGetOrCreateRowSubDoc.mockImplementation(async (documentId) => {
    const doc = cachedDocs.get(documentId);

    if (!doc) throw new Error(`Missing cached document ${documentId}`);
    return doc;
  });
  mockOpenCollabDB.mockImplementation(async (documentId) => {
    const doc = cachedDocs.get(documentId);

    if (!doc) throw new Error(`Missing cached document ${documentId}`);
    return doc;
  });
  mockUseDatabaseContextOptional.mockReturnValue({
    activeViewId: 'database-view-id',
    databaseDoc,
    databasePageId: 'database-page-id',
    loadRowDocument,
    createRowDocument,
    checkIfRowDocumentExists,
    readOnly,
    canComment,
    canWrite,
    rowMap: null,
    workspaceId: 'workspace-id',
  });
}

describe('DatabaseRowSubDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('repairs and opens an existing row document immediately after one failed page fetch', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
    });

    render(<DatabaseRowSubDocument rowId={rowId} contentPadding='template' />);

    const editor = await screen.findByTestId('row-document-editor');

    expect(editor).not.toBeNull();
    expect(editor.getAttribute('data-content-padding')).toBe('template');
    expect(screen.queryByTestId('editor-skeleton')).toBeNull();
    expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(1);
    expect(loadRowDocument).toHaveBeenCalledWith(documentId, { maxAttempts: 1 });
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createRowDocument).toHaveBeenCalledWith(documentId, {
      database_id: 'database-id',
      database_view_id: 'database-view-id',
      row_id: rowId,
    });
    expect(createRowDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps the one-attempt load policy when repair fails and a retry is scheduled', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(null);
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
    });

    render(<DatabaseRowSubDocument rowId={rowId} />);

    await act(flushAsyncWork);

    expect(loadRowDocument).toHaveBeenNthCalledWith(1, documentId, { maxAttempts: 1 });
    expect(createRowDocument).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await flushAsyncWork();
    });

    expect(loadRowDocument).toHaveBeenNthCalledWith(2, documentId, { maxAttempts: 1 });
  });

  it('shows no access without repairing or retrying when an existing row document is forbidden', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest
      .fn()
      .mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });
    const createRowDocument = jest.fn();
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
    });

    render(<DatabaseRowSubDocument rowId={rowId} />);

    await act(flushAsyncWork);

    expect(screen.getByTestId('row-document-no-access')).not.toBeNull();
    expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(1);
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(loadRowDocument).toHaveBeenCalledWith(documentId, { maxAttempts: 1 });
    expect(createRowDocument).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it('shows no access without retrying when empty row document creation is forbidden', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn();
    const createRowDocument = jest
      .fn()
      .mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });
    const checkIfRowDocumentExists = jest.fn();

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
      isEmptyDocument: true,
    });

    render(<DatabaseRowSubDocument rowId={rowId} />);

    await act(flushAsyncWork);

    expect(screen.getByTestId('row-document-no-access')).not.toBeNull();
    expect(createRowDocument).toHaveBeenCalledTimes(1);
    expect(loadRowDocument).not.toHaveBeenCalled();
    expect(checkIfRowDocumentExists).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(createRowDocument).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale repair response after switching rows', async () => {
    const firstRowId = 'row-a';
    const secondRowId = 'row-b';
    const firstDocumentId = 'document-a';
    const secondDocumentId = 'document-b';
    const firstCachedDoc = new Y.Doc({ guid: firstDocumentId }) as YDoc;
    const secondCachedDoc = new Y.Doc({ guid: secondDocumentId }) as YDoc;
    const cachedDocs = new Map([
      [firstDocumentId, firstCachedDoc],
      [secondDocumentId, secondCachedDoc],
    ]);
    const firstRepair = createDeferred<Uint8Array | null>();
    const loadRowDocument = jest.fn((documentId: string) => Promise.resolve(cachedDocs.get(documentId) ?? null));
    const createRowDocument = jest.fn((documentId: string) => {
      if (documentId === firstDocumentId) return firstRepair.promise;
      return Promise.resolve(createRowDocumentState(documentId));
    });
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    configureRowDocumentTest({
      documentIds: {
        [firstRowId]: firstDocumentId,
        [secondRowId]: secondDocumentId,
      },
      cachedDocs,
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
    });

    const { rerender } = render(<DatabaseRowSubDocument rowId={firstRowId} />);

    await waitFor(() => expect(createRowDocument).toHaveBeenCalledWith(firstDocumentId, expect.any(Object)));

    rerender(<DatabaseRowSubDocument rowId={secondRowId} />);

    await waitFor(() => {
      const editor = screen.getByTestId('row-document-editor');

      expect(editor.getAttribute('data-view-id')).toBe(secondDocumentId);
      expect(editor.getAttribute('data-doc-id')).toBe(secondDocumentId);
    });

    await act(async () => {
      firstRepair.resolve(createRowDocumentState(firstDocumentId));
      await flushAsyncWork();
    });

    const editor = screen.getByTestId('row-document-editor');

    expect(editor.getAttribute('data-view-id')).toBe(secondDocumentId);
    expect(editor.getAttribute('data-doc-id')).toBe(secondDocumentId);
    expect(firstCachedDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.document)).toBe(false);
  });

  it('preserves inherited comment-only access in the row document editor', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockResolvedValue(cachedDoc),
      createRowDocument: jest.fn().mockResolvedValue(createRowDocumentState(documentId)),
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(true),
      readOnly: true,
      canComment: true,
      canWrite: false,
    });

    render(<DatabaseRowSubDocument rowId={rowId} />);

    const editor = await screen.findByTestId('row-document-editor');

    expect(editor.getAttribute('data-read-only')).toBe('true');
    expect(editor.getAttribute('data-can-comment')).toBe('true');
    expect(editor.getAttribute('data-can-write')).toBe('false');
  });

  it('registers a synchronous flush for pending document metadata updates', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const updateRowMeta = jest.fn();
    let pendingFlush: (() => void) | null = null;

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockResolvedValue(cachedDoc),
      createRowDocument: jest.fn().mockResolvedValue(createRowDocumentState(documentId)),
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(true),
    });
    mockUseUpdateRowMetaDispatch.mockReturnValue(updateRowMeta);

    render(
      <DatabaseRowSubDocument
        rowId={rowId}
        onRegisterPendingMetaFlush={(flush) => {
          pendingFlush = flush;
        }}
      />
    );

    await screen.findByTestId('row-document-editor');
    await waitFor(() => expect(pendingFlush).toEqual(expect.any(Function)));

    act(() => {
      cachedDoc.transact(
        () => cachedDoc.getMap(YjsEditorKey.data_section).set('local-change', Date.now()),
        CollabOrigin.Local
      );
      pendingFlush?.();
    });

    expect(updateRowMeta).toHaveBeenCalledWith(RowMetaKey.IsDocumentEmpty, false);
  });
});
