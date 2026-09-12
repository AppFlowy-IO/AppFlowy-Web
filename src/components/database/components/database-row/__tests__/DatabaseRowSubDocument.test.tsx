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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

  return { rows };
}

describe('DatabaseRowSubDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([false, true])('reopens a persisted empty row document without repair (readOnly=%s)', async (readOnly) => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn();
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
      isEmptyDocument: true,
      readOnly,
    });

    for (let open = 1; open <= 2; open++) {
      const view = render(<DatabaseRowSubDocument rowId={rowId} />);
      const editor = await screen.findByTestId('row-document-editor');

      expect(editor.getAttribute('data-read-only')).toBe(String(readOnly));
      expect(editor.getAttribute('data-can-write')).toBe(String(!readOnly));
      expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(open);
      expect(loadRowDocument).toHaveBeenCalledTimes(open);
      expect(createRowDocument).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it.each([
    { failure: 'fetch error', isEmptyDocument: false },
    { failure: 'fetch error', isEmptyDocument: true },
    { failure: 'incomplete document', isEmptyDocument: false },
    { failure: 'incomplete document', isEmptyDocument: true },
    { failure: 'existence error', isEmptyDocument: false },
    { failure: 'existence error', isEmptyDocument: true },
  ])('does not repair after a $failure, including retries (empty=$isEmptyDocument)', async ({ failure, isEmptyDocument }) => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    if (failure !== 'incomplete document') {
      Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    }

    const transientError = new Error('temporary request failure');
    const loadRowDocument = failure === 'fetch error'
      ? jest.fn().mockRejectedValue(transientError)
      : jest.fn().mockResolvedValue(cachedDoc);
    const checkIfRowDocumentExists = failure === 'existence error'
      ? jest.fn().mockRejectedValue(transientError)
      : jest.fn().mockResolvedValue(true);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
      isEmptyDocument,
      readOnly: true,
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await act(flushAsyncWork);

    expect(createRowDocument).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(createRowDocument).not.toHaveBeenCalled();
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(screen.queryByTestId('row-document-no-access')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([false, true])('recovers from a temporary fetch failure by reading again (empty=%s)', async (isEmptyDocument) => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn()
      .mockRejectedValueOnce(new Error('temporary fetch failure'))
      .mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(true),
      isEmptyDocument,
      readOnly: true,
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await act(flushAsyncWork);

    expect(createRowDocument).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await flushAsyncWork();
    });

    expect(screen.getByTestId('row-document-editor').getAttribute('data-read-only')).toBe('true');
    expect(loadRowDocument).toHaveBeenCalledTimes(2);

    for (const attempt of [1, 2]) {
      expect(loadRowDocument).toHaveBeenNthCalledWith(attempt, documentId, {
        maxAttempts: 1,
        rowDocumentSource: {
          database_id: 'database-id',
          database_view_id: 'database-view-id',
          row_id: rowId,
        },
      });
    }

    expect(createRowDocument).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reads an empty document that appears before a failed creation is retried', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(null);
    const checkIfRowDocumentExists = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

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
    expect(createRowDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await flushAsyncWork();
    });

    expect(screen.getByTestId('row-document-editor')).not.toBeNull();
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createRowDocument).toHaveBeenCalledTimes(1);
  });

  it('creates a nonempty row document only after missing-document retries are exhausted', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(false);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await act(flushAsyncWork);
    expect(createRowDocument).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
      await flushAsyncWork();
    });
    expect(createRowDocument).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(screen.getByTestId('row-document-editor')).not.toBeNull();
    expect(createRowDocument).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for server creation before binding an empty row that exists only locally', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const creation = createDeferred<Uint8Array>();
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockReturnValue(creation.promise);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(false),
      isEmptyDocument: true,
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await waitFor(() => expect(createRowDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(loadRowDocument).not.toHaveBeenCalled();

    await act(async () => {
      creation.resolve(createRowDocumentState(documentId));
      await flushAsyncWork();
    });
    expect(await screen.findByTestId('row-document-editor')).not.toBeNull();
  });

  it('reads an existing row document without creation', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn();
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
    expect(loadRowDocument).toHaveBeenCalledWith(documentId, {
      maxAttempts: 1,
      rowDocumentSource: {
        database_id: 'database-id',
        database_view_id: 'database-view-id',
        row_id: rowId,
      },
    });
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it.each([
    { deniedOperation: 'existence check', isEmptyDocument: false, readOnly: false },
    { deniedOperation: 'document fetch', isEmptyDocument: false, readOnly: false },
    { deniedOperation: 'existence check', isEmptyDocument: true, readOnly: false },
    { deniedOperation: 'document fetch', isEmptyDocument: true, readOnly: false },
    { deniedOperation: 'existence check', isEmptyDocument: false, readOnly: true },
    { deniedOperation: 'document fetch', isEmptyDocument: false, readOnly: true },
    { deniedOperation: 'existence check', isEmptyDocument: true, readOnly: true },
    { deniedOperation: 'document fetch', isEmptyDocument: true, readOnly: true },
  ])(
    'shows no access without repair after a denied $deniedOperation (empty=$isEmptyDocument, readOnly=$readOnly)',
    async ({ deniedOperation, isEmptyDocument, readOnly }) => {
      jest.useFakeTimers();

      const rowId = 'row-id';
      const documentId = 'document-id';
      const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
      const denied = { code: 1012, message: 'user is not allowed to access this view' };
      const loadRowDocument = jest.fn().mockRejectedValue(denied);
      const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));
      const checkIfRowDocumentExists =
        deniedOperation === 'existence check'
          ? jest.fn().mockRejectedValue(denied)
          : jest.fn().mockResolvedValue(true);

      configureRowDocumentTest({
        documentIds: { [rowId]: documentId },
        cachedDocs: new Map([[documentId, cachedDoc]]),
        loadRowDocument,
        createRowDocument,
        checkIfRowDocumentExists,
        readOnly,
        isEmptyDocument,
      });

      render(<DatabaseRowSubDocument rowId={rowId} />);

      await act(flushAsyncWork);

      expect(screen.getByTestId('row-document-no-access')).not.toBeNull();
      expect(screen.queryByTestId('row-document-editor')).toBeNull();
      expect(createRowDocument).not.toHaveBeenCalled();
      expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(1);
      expect(loadRowDocument).toHaveBeenCalledTimes(deniedOperation === 'existence check' ? 0 : 1);
      expect(jest.getTimerCount()).toBe(0);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
        await flushAsyncWork();
      });

      expect(createRowDocument).not.toHaveBeenCalled();
      expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(1);
      expect(loadRowDocument).toHaveBeenCalledTimes(deniedOperation === 'existence check' ? 0 : 1);
    }
  );

  it('shows no access without retrying when empty row document creation is forbidden', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn();
    const createRowDocument = jest
      .fn()
      .mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(false);

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
    expect(checkIfRowDocumentExists).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(createRowDocument).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale creation response after switching rows', async () => {
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
    const firstCreation = createDeferred<Uint8Array | null>();
    const loadRowDocument = jest.fn();
    const createRowDocument = jest.fn((documentId: string) => {
      if (documentId === firstDocumentId) return firstCreation.promise;
      return Promise.resolve(createRowDocumentState(documentId));
    });
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(false);

    configureRowDocumentTest({
      documentIds: {
        [firstRowId]: firstDocumentId,
        [secondRowId]: secondDocumentId,
      },
      cachedDocs,
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
      isEmptyDocument: true,
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
      firstCreation.resolve(createRowDocumentState(firstDocumentId));
      await flushAsyncWork();
    });

    const editor = screen.getByTestId('row-document-editor');

    expect(editor.getAttribute('data-view-id')).toBe(secondDocumentId);
    expect(editor.getAttribute('data-doc-id')).toBe(secondDocumentId);
    expect(firstCachedDoc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.document)).toBe(false);
  });

  it('ignores a stale read denial after switching rows', async () => {
    const firstRowId = 'row-a';
    const secondRowId = 'row-b';
    const firstDocumentId = 'document-a';
    const secondDocumentId = 'document-b';
    const firstCachedDoc = new Y.Doc({ guid: firstDocumentId }) as YDoc;
    const secondCachedDoc = new Y.Doc({ guid: secondDocumentId }) as YDoc;

    Y.applyUpdate(secondCachedDoc, createRowDocumentState(secondDocumentId));
    const firstRead = createDeferred<YDoc>();
    const loadRowDocument = jest.fn((documentId: string) =>
      documentId === firstDocumentId ? firstRead.promise : Promise.resolve(secondCachedDoc)
    );
    const createRowDocument = jest.fn();

    configureRowDocumentTest({
      documentIds: { [firstRowId]: firstDocumentId, [secondRowId]: secondDocumentId },
      cachedDocs: new Map([
        [firstDocumentId, firstCachedDoc],
        [secondDocumentId, secondCachedDoc],
      ]),
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(true),
    });

    const { rerender } = render(<DatabaseRowSubDocument rowId={firstRowId} />);

    await waitFor(() => expect(loadRowDocument).toHaveBeenCalledWith(firstDocumentId, expect.any(Object)));
    rerender(<DatabaseRowSubDocument rowId={secondRowId} />);
    expect((await screen.findByTestId('row-document-editor')).getAttribute('data-doc-id')).toBe(secondDocumentId);

    await act(async () => {
      firstRead.reject({ code: 1012, message: 'document read denied' });
      await flushAsyncWork();
    });

    expect(screen.getByTestId('row-document-editor').getAttribute('data-doc-id')).toBe(secondDocumentId);
    expect(screen.queryByTestId('row-document-no-access')).toBeNull();
    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it('preserves inherited comment-only access in the row document editor', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));

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

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
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

  it('attributes local body edits without attributing remote document updates', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    let pendingFlush: (() => void) | null = null;
    const { rows } = configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockResolvedValue(cachedDoc),
      createRowDocument: jest.fn().mockResolvedValue(createRowDocumentState(documentId)),
      checkIfRowDocumentExists: jest.fn().mockResolvedValue(true),
    });

    mockUseCurrentUserOptional.mockReturnValue({
      uid: '42',
      attributionUid: '42',
      uuid: 'user-uuid',
      email: 'user@appflowy.test',
      name: 'User',
      avatar: null,
      latestWorkspaceId: 'workspace-id',
    });

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
      cachedDoc.transact(() => cachedDoc.getMap(YjsEditorKey.data_section).set('remote-change', 1), CollabOrigin.Remote);
      pendingFlush?.();
    });

    expect(rows.get(rowId)?.get(YjsDatabaseKey.last_edited_by)).toBeUndefined();

    act(() => {
      cachedDoc.transact(() => cachedDoc.getMap(YjsEditorKey.data_section).set('local-change', 1), CollabOrigin.Local);
      pendingFlush?.();
    });

    expect(rows.get(rowId)?.get(YjsDatabaseKey.last_edited_by)).toBe('42');
  });
});
