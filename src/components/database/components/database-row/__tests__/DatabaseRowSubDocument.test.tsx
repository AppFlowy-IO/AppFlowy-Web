import { TextEncoder } from 'util';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { AtomicCreationPendingError } from '@/application/atomic-creation/journal';
import type { AtomicCreationRecord } from '@/application/atomic-creation/types';
import { ERROR_CODE } from '@/application/constants';
import { useDatabase, useDatabaseContextOptional, useRowData, useRowMetaSelector } from '@/application/database-yjs';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { openCollabDB } from '@/application/db';
import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from '@/application/row-document/atomic-first-body';
import { getCachedRowSubDoc, getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { CollabOrigin, YDatabase, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { DatabaseRowSubDocument } from '../DatabaseRowSubDocument';

Object.assign(globalThis, { TextEncoder });
const missingDocument = { code: ERROR_CODE.RECORD_NOT_FOUND, message: 'Collab not found' };
const mockCheckIfRowDocumentExists = jest.fn();
let mockRenderedDoc: YDoc | null = null;
let mockEditor: { children: unknown[]; undoManager?: Y.UndoManager } = { children: [] };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabase: jest.fn(),
  useDatabaseContextOptional: jest.fn(),
  useRowData: jest.fn(),
  useRowMetaSelector: jest.fn(),
}));

jest.mock('@/application/row-document/atomic-first-body', () => ({
  hasPendingAtomicRowFirstBody: jest.fn(),
  prepareAtomicRowFirstBody: jest.fn(),
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
      addPage,
      contentPadding,
      onEditorConnected,
    }: {
      viewId: string;
      doc: { guid: string };
      readOnly: boolean;
      canComment?: boolean;
      canWrite?: boolean;
      addPage?: unknown;
      contentPadding?: string;
      onEditorConnected?: (editor: { children: unknown[] }) => void;
    }) => {
      mockRenderedDoc = doc as YDoc;
      React.useEffect(() => {
        onEditorConnected?.(mockEditor);
      }, [onEditorConnected]);

      return (
        <div
          data-testid='row-document-editor'
          data-view-id={viewId}
          data-doc-id={doc.guid}
          data-read-only={String(readOnly)}
          data-can-comment={String(canComment)}
          data-can-write={String(canWrite)}
          data-can-add-page={String(Boolean(addPage))}
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
  isEmptyDocument = false,
  readOnly = false,
  canComment = false,
  canWrite = !readOnly,
}: {
  documentIds: Record<string, string>;
  cachedDocs: Map<string, YDoc>;
  loadRowDocument: jest.Mock;
  createRowDocument: jest.Mock;
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
    checkIfRowDocumentExists: mockCheckIfRowDocumentExists,
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
    mockEditor = { children: [] };
    (hasPendingAtomicRowFirstBody as jest.Mock).mockResolvedValue(false);
    (prepareAtomicRowFirstBody as jest.Mock).mockRejectedValue(new Error('first-body admission unavailable'));
  });

  afterEach(() => {
    expect(mockCheckIfRowDocumentExists).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it.each([false, true])('reopens a persisted empty row document without repair (readOnly=%s)', async (readOnly) => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn();

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      isEmptyDocument: true,
      readOnly,
    });

    for (let open = 1; open <= 2; open++) {
      const view = render(<DatabaseRowSubDocument rowId={rowId} />);
      const editor = await screen.findByTestId('row-document-editor');

      expect(editor.getAttribute('data-read-only')).toBe(String(readOnly));
      expect(editor.getAttribute('data-can-write')).toBe(String(!readOnly));
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
  ])(
    'does not repair after a $failure, including retries (empty=$isEmptyDocument)',
    async ({ failure, isEmptyDocument }) => {
      jest.useFakeTimers();

      const rowId = 'row-id';
      const documentId = 'document-id';
      const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

      if (failure !== 'incomplete document') {
        Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
      }

      const transientError = new Error('temporary request failure');
      const loadRowDocument =
        failure === 'fetch error' ? jest.fn().mockRejectedValue(transientError) : jest.fn().mockResolvedValue(cachedDoc);
      const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

      configureRowDocumentTest({
        documentIds: { [rowId]: documentId },
        cachedDocs: new Map([[documentId, cachedDoc]]),
        loadRowDocument,
        createRowDocument,
        isEmptyDocument,
        readOnly: false,
      });
      render(<DatabaseRowSubDocument rowId={rowId} />);
      await act(flushAsyncWork);

      expect(createRowDocument).not.toHaveBeenCalled();
      expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
        await flushAsyncWork();
      });

      expect(createRowDocument).not.toHaveBeenCalled();
      expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
      expect(screen.queryByTestId('row-document-editor')).toBeNull();
      expect(screen.queryByTestId('row-document-no-access')).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('chat.openPagePreviewFailedToast');
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each([false, true])(
    'recovers from a temporary fetch failure by reading again (empty=%s)',
    async (isEmptyDocument) => {
      jest.useFakeTimers();

      const rowId = 'row-id';
      const documentId = 'document-id';
      const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

      Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
      const loadRowDocument = jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary fetch failure'))
        .mockResolvedValue(cachedDoc);
      const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

      configureRowDocumentTest({
        documentIds: { [rowId]: documentId },
        cachedDocs: new Map([[documentId, cachedDoc]]),
        loadRowDocument,
        createRowDocument,
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
      expect(screen.queryByRole('alert')).toBeNull();
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
    }
  );

  it('clears the exhausted-load error when another row is opened', async () => {
    jest.useFakeTimers();

    const readyDoc = new Y.Doc({ guid: 'ready-document' }) as YDoc;

    Y.applyUpdate(readyDoc, createRowDocumentState('ready-document'));
    const loadRowDocument = jest.fn().mockImplementation(async (documentId: string) => {
      if (documentId === 'failed-document') throw new Error('Request failed');
      return readyDoc;
    });

    configureRowDocumentTest({
      documentIds: { 'failed-row': 'failed-document', 'ready-row': 'ready-document' },
      cachedDocs: new Map([['ready-document', readyDoc]]),
      loadRowDocument,
      createRowDocument: jest.fn(),
    });
    const { rerender } = render(<DatabaseRowSubDocument rowId='failed-row' />);

    await act(flushAsyncWork);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });
    expect(screen.getByRole('alert').textContent).toContain('chat.openPagePreviewFailedToast');

    rerender(<DatabaseRowSubDocument rowId='ready-row' />);
    await act(flushAsyncWork);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('row-document-editor').getAttribute('data-view-id')).toBe('ready-document');
  });

  it('reads an empty document that appears when retrying failed creation', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockRejectedValueOnce(missingDocument).mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(null);

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      isEmptyDocument: true,
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await act(flushAsyncWork);
    expect(createRowDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'atomicCreation.retry' }));
    await act(async () => {
      await flushAsyncWork();
    });

    expect(screen.getByTestId('row-document-editor')).not.toBeNull();
    expect(loadRowDocument).toHaveBeenCalledTimes(2);
    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it('never creates a blank replacement when a nonempty row body remains missing', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockRejectedValue(missingDocument);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
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

    expect(screen.getByTestId('row-document-load-error')).not.toBeNull();
    expect(createRowDocument).not.toHaveBeenCalled();
    expect(loadRowDocument).toHaveBeenCalledTimes(4);
    expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([true, undefined])('initializes a missing body before editing and sync (empty=%s)', async (isEmptyDocument) => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const creation = createDeferred<YDoc>();
    const createEmpty = jest.fn(() => creation.promise);
    const dispose = jest.fn();
    const createRowDocument = jest.fn();
    const bindViewSync = jest.fn();

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockRejectedValue(missingDocument),
      createRowDocument,
      isEmptyDocument: true,
    });
    mockUseRowMetaSelector.mockReturnValue({ documentId, isEmptyDocument } as ReturnType<typeof useRowMetaSelector>);
    mockUseDatabaseContextOptional.mockReturnValue({
      ...mockUseDatabaseContextOptional(),
      bindViewSync,
      addPage: jest.fn(),
    } as ReturnType<typeof useDatabaseContextOptional>);
    (prepareAtomicRowFirstBody as jest.Mock).mockResolvedValue({ createEmpty, dispose });
    render(<DatabaseRowSubDocument rowId={rowId} />);
    await waitFor(() => expect(createEmpty).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('row-document-loading')).toBeTruthy();
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(createRowDocument).not.toHaveBeenCalled();
    expect(bindViewSync).not.toHaveBeenCalled();
    expect(mockUseUpdateRowMetaDispatch()).not.toHaveBeenCalled();

    await act(async () => {
      Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
      creation.resolve(cachedDoc);
      await flushAsyncWork();
    });
    expect(mockRenderedDoc).toBe(cachedDoc);
    expect(bindViewSync).toHaveBeenCalledWith(cachedDoc);
    expect(screen.getByTestId('row-document-editor').getAttribute('data-can-add-page')).toBe('true');
    expect(mockUseUpdateRowMetaDispatch()).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error after failed creation and waits for explicit retry', async () => {
    jest.useFakeTimers();
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const createEmpty = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const dispose = jest.fn();

    configureRowDocumentTest({
      documentIds: { row: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockRejectedValue(missingDocument),
      createRowDocument: jest.fn(),
      isEmptyDocument: true,
    });
    (prepareAtomicRowFirstBody as jest.Mock).mockResolvedValue({ createEmpty, dispose });
    render(<DatabaseRowSubDocument rowId='row' />);
    await act(flushAsyncWork);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByTestId('row-document-load-error')).toBeTruthy();
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    createEmpty.mockResolvedValue(cachedDoc);
    fireEvent.click(screen.getByRole('button', { name: 'atomicCreation.retry' }));
    expect(screen.getByTestId('row-document-loading')).toBeTruthy();
    await act(flushAsyncWork);
    expect(screen.getByTestId('row-document-editor')).toBeTruthy();
    expect(screen.queryByTestId('row-document-load-error')).toBeNull();
  });

  it.each([true, false])(
    'reports offline opening immediately even before lazy Row metadata loads (loaded=%s)',
    async (metadataLoaded) => {
      const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      const documentId = 'document-id';

      try {
        configureRowDocumentTest({
          documentIds: { '11111111-1111-4111-8111-111111111111': documentId },
          cachedDocs: new Map(),
          loadRowDocument: jest.fn(),
          createRowDocument: jest.fn(),
          isEmptyDocument: true,
        });
        if (!metadataLoaded) mockUseRowMetaSelector.mockReturnValue(null);
        render(<DatabaseRowSubDocument rowId='11111111-1111-4111-8111-111111111111' />);
        await act(flushAsyncWork);
        expect(screen.getByTestId('row-document-load-error').textContent).toContain('atomicCreation.offline');
        expect(screen.queryByTestId('row-document-editor')).toBeNull();
        expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
      } finally {
        online.mockRestore();
      }
    }
  );

  it.each([
    { readOnly: true, canWrite: false },
    { readOnly: false, canWrite: false },
  ])('does not initialize a missing row page without write access (%j)', async (access) => {
    jest.useFakeTimers();
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    configureRowDocumentTest({
      documentIds: { row: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockRejectedValue(missingDocument),
      createRowDocument: jest.fn(),
      isEmptyDocument: true,
      ...access,
    });
    render(<DatabaseRowSubDocument rowId='row' />);
    await act(flushAsyncWork);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(screen.getByTestId('row-document-load-error')).toBeTruthy();
  });

  it('publishes content transitions only from local edits, including clearing and immediate close', async () => {
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    configureRowDocumentTest({
      documentIds: { row: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockResolvedValue(cachedDoc),
      createRowDocument: jest.fn(),
      isEmptyDocument: true,
    });
    const updateRowMeta = mockUseUpdateRowMetaDispatch();
    let flush: (() => void) | null = null;
    const registerFlush = (current: (() => void) | null) => {
      flush = current;
    };

    const { unmount, rerender } = render(
      <DatabaseRowSubDocument rowId='row' onRegisterPendingMetaFlush={registerFlush} />
    );

    await screen.findByTestId('row-document-editor');
    expect(updateRowMeta).not.toHaveBeenCalled();
    let revision = 0;
    const change = (origin: CollabOrigin | null) => {
      cachedDoc.transact(() => cachedDoc.getMap('test').set('revision', ++revision), origin);
      flush?.();
    };

    // A cached/remote body and Row metadata update may refresh UI, but publish nothing.
    act(() => {
      mockEditor.children = [{ text: 'remote body' }];
      change(CollabOrigin.Remote);
      change(null); // Unattributed hydration is not an authored edit.
    });
    expect(updateRowMeta).not.toHaveBeenCalled();
    mockUseRowMetaSelector.mockReturnValue({ documentId, isEmptyDocument: false });
    rerender(
      <DatabaseRowSubDocument rowId='row' contentPadding='template' onRegisterPendingMetaFlush={registerFlush} />
    );
    expect(updateRowMeta).not.toHaveBeenCalled();

    act(() => {
      mockEditor.children = [{ text: '' }];
      change(CollabOrigin.Local);
    });
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, true);
    act(() => {
      mockEditor.children = [{ text: 'body' }];
      change(CollabOrigin.LocalManual);
    });
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, false);
    act(() => {
      mockEditor.children = [{ text: 'body plus typing' }];
      change(CollabOrigin.Local);
    });
    expect(updateRowMeta).toHaveBeenCalledTimes(2);

    // A peer's clear must not cause the next local nonempty edit to be deduplicated.
    mockUseRowMetaSelector.mockReturnValue({ documentId, isEmptyDocument: true });
    rerender(<DatabaseRowSubDocument rowId='row' onRegisterPendingMetaFlush={registerFlush} />);
    act(() => change(CollabOrigin.Local));
    expect(updateRowMeta).toHaveBeenCalledTimes(3);
    act(() => {
      mockEditor.children = [];
      cachedDoc.transact(() => cachedDoc.getMap('test').set('revision', ++revision), CollabOrigin.Local);
    });
    unmount();
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, true);
    expect(updateRowMeta).toHaveBeenCalledTimes(4);
  });

  it('updates the content indicator for undo and redo without treating remote changes as local history', async () => {
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const text = cachedDoc.getText('body');
    const undoManager = new Y.UndoManager(text, { trackedOrigins: new Set([CollabOrigin.Local]) });

    mockEditor.undoManager = undoManager;
    text.observe(() => {
      mockEditor.children = [{ text: text.toString() }];
    });
    configureRowDocumentTest({
      documentIds: { row: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockResolvedValue(cachedDoc),
      createRowDocument: jest.fn(),
      isEmptyDocument: true,
    });
    const updateRowMeta = mockUseUpdateRowMetaDispatch();
    let flush: (() => void) | null = null;

    render(
      <DatabaseRowSubDocument
        rowId='row'
        onRegisterPendingMetaFlush={(current) => {
          flush = current;
        }}
      />
    );
    await screen.findByTestId('row-document-editor');
    act(() => {
      cachedDoc.transact(() => text.insert(0, 'body'), CollabOrigin.Local);
      flush?.();
    });
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, false);
    act(() => {
      undoManager.undo();
      flush?.();
    });
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, true);
    act(() => {
      undoManager.redo();
      flush?.();
    });
    expect(updateRowMeta).toHaveBeenLastCalledWith(RowMetaKey.IsDocumentEmpty, false);
    expect(updateRowMeta).toHaveBeenCalledTimes(3);
    act(() => {
      cachedDoc.transact(() => text.delete(0, text.length), CollabOrigin.Remote);
      flush?.();
    });
    expect(updateRowMeta).toHaveBeenCalledTimes(3);
  });

  it('reads an existing row document without creation', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;

    Y.applyUpdate(cachedDoc, createRowDocumentState(documentId));
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn();

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
    });

    render(<DatabaseRowSubDocument rowId={rowId} contentPadding='template' />);

    const editor = await screen.findByTestId('row-document-editor');

    expect(editor).not.toBeNull();
    expect(editor.getAttribute('data-content-padding')).toBe('template');
    expect(screen.queryByTestId('editor-skeleton')).toBeNull();
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
    { isEmptyDocument: false, readOnly: false },
    { isEmptyDocument: true, readOnly: false },
    { isEmptyDocument: false, readOnly: true },
    { isEmptyDocument: true, readOnly: true },
  ])(
    'shows no access without repair after a denied document fetch (empty=$isEmptyDocument, readOnly=$readOnly)',
    async ({ isEmptyDocument, readOnly }) => {
      jest.useFakeTimers();

      const rowId = 'row-id';
      const documentId = 'document-id';
      const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
      const denied = { code: 1012, message: 'user is not allowed to access this view' };
      const loadRowDocument = jest.fn().mockRejectedValue(denied);
      const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));

      configureRowDocumentTest({
        documentIds: { [rowId]: documentId },
        cachedDocs: new Map([[documentId, cachedDoc]]),
        loadRowDocument,
        createRowDocument,
        readOnly,
        isEmptyDocument,
      });

      render(<DatabaseRowSubDocument rowId={rowId} />);

      await act(flushAsyncWork);

      expect(screen.getByTestId('row-document-no-access')).not.toBeNull();
      expect(screen.queryByTestId('row-document-editor')).toBeNull();
      expect(createRowDocument).not.toHaveBeenCalled();
      expect(loadRowDocument).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
        await flushAsyncWork();
      });

      expect(createRowDocument).not.toHaveBeenCalled();
      expect(loadRowDocument).toHaveBeenCalledTimes(1);
    }
  );

  it('shows no access without retrying when first-body admission is forbidden', async () => {
    jest.useFakeTimers();

    const rowId = 'row-id';
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockRejectedValue(missingDocument);
    const createRowDocument = jest
      .fn()
      .mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });

    configureRowDocumentTest({
      documentIds: { [rowId]: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument,
      createRowDocument,
      isEmptyDocument: true,
    });

    (prepareAtomicRowFirstBody as jest.Mock).mockRejectedValue({
      code: 1012,
      message: 'user is not allowed to access this view',
    });
    render(<DatabaseRowSubDocument rowId={rowId} />);

    await act(flushAsyncWork);

    expect(screen.getByTestId('row-document-no-access')).not.toBeNull();
    expect(createRowDocument).not.toHaveBeenCalled();
    expect(loadRowDocument).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(createRowDocument).not.toHaveBeenCalled();
  });

  it('shows no access for a denied atomic request wrapped by its durable journal', async () => {
    const documentId = 'document-id';
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const dispose = jest.fn();
    const createEmpty = jest
      .fn()
      .mockRejectedValue(
        new AtomicCreationPendingError({ id: 'record', requestId: 'request' } as AtomicCreationRecord, {
          code: 1012,
          message: 'row document creation denied',
        })
      );

    configureRowDocumentTest({
      documentIds: { row: documentId },
      cachedDocs: new Map([[documentId, cachedDoc]]),
      loadRowDocument: jest.fn().mockRejectedValue(missingDocument),
      createRowDocument: jest.fn(),
      isEmptyDocument: true,
    });
    (prepareAtomicRowFirstBody as jest.Mock).mockResolvedValue({ createEmpty, dispose });
    render(<DatabaseRowSubDocument rowId='row' />);
    await screen.findByTestId('row-document-no-access');
    expect(screen.queryByTestId('row-document-editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'atomicCreation.retry' })).toBeNull();
    expect(createEmpty).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale recovery response after switching rows', async () => {
    const firstDocumentId = 'document-a';
    const secondDocumentId = 'document-b';
    const firstCachedDoc = new Y.Doc({ guid: firstDocumentId }) as YDoc;
    const secondCachedDoc = new Y.Doc({ guid: secondDocumentId }) as YDoc;

    Y.applyUpdate(secondCachedDoc, createRowDocumentState(secondDocumentId));
    const recovery = createDeferred<YDoc>();
    const dispose = jest.fn();
    const createRowDocument = jest.fn();

    configureRowDocumentTest({
      documentIds: { 'row-a': firstDocumentId, 'row-b': secondDocumentId },
      cachedDocs: new Map([
        [firstDocumentId, firstCachedDoc],
        [secondDocumentId, secondCachedDoc],
      ]),
      loadRowDocument: jest.fn().mockResolvedValue(secondCachedDoc),
      createRowDocument,
      isEmptyDocument: true,
    });
    (hasPendingAtomicRowFirstBody as jest.Mock).mockResolvedValueOnce(true).mockResolvedValue(false);
    (prepareAtomicRowFirstBody as jest.Mock).mockResolvedValue({ createEmpty: () => recovery.promise, dispose });
    const { rerender } = render(<DatabaseRowSubDocument rowId='row-a' />);

    await waitFor(() => expect(prepareAtomicRowFirstBody).toHaveBeenCalledTimes(1));
    rerender(<DatabaseRowSubDocument rowId='row-b' />);
    await waitFor(() =>
      expect(screen.getByTestId('row-document-editor').getAttribute('data-view-id')).toBe(secondDocumentId)
    );
    await act(async () => {
      recovery.resolve(firstCachedDoc);
      await flushAsyncWork();
    });
    expect(screen.getByTestId('row-document-editor').getAttribute('data-doc-id')).toBe(secondDocumentId);
    expect(createRowDocument).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
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

    expect(updateRowMeta).toHaveBeenCalledWith(RowMetaKey.IsDocumentEmpty, true);
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
