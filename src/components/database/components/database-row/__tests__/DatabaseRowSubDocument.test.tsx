import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import {
  useDatabase,
  useDatabaseContextOptional,
  useRowData,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { openCollabDB } from '@/application/db';
import { getCachedRowSubDoc, getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { YDatabase, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
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
  EditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));

jest.mock('@/components/editor', () => ({
  Editor: () => <div data-testid="row-document-editor" />,
}));

const mockUseDatabase = useDatabase as jest.MockedFunction<typeof useDatabase>;
const mockUseDatabaseContextOptional = useDatabaseContextOptional as jest.MockedFunction<
  typeof useDatabaseContextOptional
>;
const mockUseRowData = useRowData as jest.MockedFunction<typeof useRowData>;
const mockUseRowMetaSelector = useRowMetaSelector as jest.MockedFunction<typeof useRowMetaSelector>;
const mockUseUpdateRowMetaDispatch = useUpdateRowMetaDispatch as jest.MockedFunction<
  typeof useUpdateRowMetaDispatch
>;
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

describe('DatabaseRowSubDocument', () => {
  it('repairs and opens an existing row document immediately after one failed page fetch', async () => {
    const rowId = 'row-id';
    const documentId = 'document-id';
    const databaseDoc = new Y.Doc({ guid: 'database-id' }) as YDoc;
    const database = databaseDoc.getMap('database') as YDatabase;
    const fields = new Y.Map();
    const rowDoc = new Y.Doc({ guid: rowId });
    const row = rowDoc.getMap('row') as YDatabaseRow;
    const cachedDoc = new Y.Doc({ guid: documentId }) as YDoc;
    const loadRowDocument = jest.fn().mockResolvedValue(cachedDoc);
    const createRowDocument = jest.fn().mockResolvedValue(createRowDocumentState(documentId));
    const checkIfRowDocumentExists = jest.fn().mockResolvedValue(true);

    database.set(YjsDatabaseKey.id, 'database-id');
    database.set(YjsDatabaseKey.fields, fields);
    row.set(YjsDatabaseKey.cells, new Y.Map());

    mockUseDatabase.mockReturnValue(database);
    mockUseRowData.mockReturnValue(row);
    mockUseRowMetaSelector.mockReturnValue({
      documentId,
      isEmptyDocument: false,
    });
    mockUseUpdateRowMetaDispatch.mockReturnValue(jest.fn());
    mockUseCurrentWorkspaceIdOptional.mockReturnValue('workspace-id');
    mockUseCurrentUserOptional.mockReturnValue(undefined);
    mockGetCachedRowSubDoc.mockReturnValue(cachedDoc);
    mockGetOrCreateRowSubDoc.mockResolvedValue(cachedDoc);
    mockOpenCollabDB.mockResolvedValue(cachedDoc);
    mockUseDatabaseContextOptional.mockReturnValue({
      activeViewId: 'database-view-id',
      databaseDoc,
      databasePageId: 'database-page-id',
      loadRowDocument,
      createRowDocument,
      checkIfRowDocumentExists,
      readOnly: false,
      rowMap: null,
      workspaceId: 'workspace-id',
    });

    render(<DatabaseRowSubDocument rowId={rowId} />);

    expect(await screen.findByTestId('row-document-editor')).not.toBeNull();
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
});
