import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import { RelationCell } from '@/application/database-yjs/cell.type';
import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import RelationItems from '@/components/database/components/cell/relation/RelationItems';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockDatabaseContext = {
  databasePageId: 'source-view',
  createRow: jest.fn(),
  getViewIdFromDatabaseId: jest.fn(),
  loadView: jest.fn(),
  navigateToRow: jest.fn(),
  navigateToView: jest.fn(),
};

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabaseContextOptional: () => mockDatabaseContext,
  useDatabaseIdFromField: () => 'related-database',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const RELATED_VIEW_ID = 'related-view';
const PRIMARY_FIELD_ID = 'primary-field';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createRelationCell(rowIds: string[]): RelationCell {
  const doc = new Y.Doc();
  const data = doc.getArray<string>('relation');

  data.push(rowIds);

  return {
    createdAt: 0,
    data,
    fieldType: FieldType.Relation,
    lastModified: 0,
  };
}

function createRelatedDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map();
  const primaryField = new Y.Map();

  doc.guid = RELATED_VIEW_ID;
  primaryField.set(YjsDatabaseKey.id, PRIMARY_FIELD_ID);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(PRIMARY_FIELD_ID, primaryField);
  database.set(YjsDatabaseKey.id, 'related-database');
  database.set(YjsDatabaseKey.fields, fields);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return doc;
}

function renderItems(rowIds: string[]) {
  return render(<RelationItems cell={createRelationCell(rowIds)} fieldId='relation-field' wrap={false} />);
}

describe('RelationItems loading state', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDatabaseContext.getViewIdFromDatabaseId.mockResolvedValue(RELATED_VIEW_ID);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('shows an indicator until the related database and linked row are loaded', async () => {
    const view = deferred<YDoc>();
    const rowDoc = deferred<YDoc>();

    mockDatabaseContext.loadView.mockReturnValue(view.promise);
    mockDatabaseContext.createRow.mockReturnValue(rowDoc.promise);

    renderItems(['row-1']);

    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    view.resolve(createRelatedDatabaseDoc());

    await waitFor(() => expect(mockDatabaseContext.createRow).toHaveBeenCalled());
    expect(mockDatabaseContext.loadView).toHaveBeenCalledWith(RELATED_VIEW_ID, false, false, {
      databaseId: 'related-database',
      databaseMetadataOnly: true,
    });
    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    const emptyRowDoc = new Y.Doc({ guid: 'row-1' }) as YDoc;

    emptyRowDoc.getMap(YjsEditorKey.data_section);
    await act(async () => {
      rowDoc.resolve(emptyRowDoc);
      await rowDoc.promise;
    });

    // Registering realtime sync does not mean its initial row payload has
    // arrived, so the cell must keep its indicator through this empty shell.
    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    const row = new Y.Map();

    act(() => {
      emptyRowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    });
    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    const cells = new Y.Map();

    act(() => {
      row.set(YjsDatabaseKey.cells, cells);
    });

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());

    const primaryCell = new Y.Map();

    act(() => {
      cells.set(PRIMARY_FIELD_ID, primaryCell);
      primaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      primaryCell.set(YjsDatabaseKey.data, 'Design system');
    });

    await waitFor(() => expect(screen.getByText('Design system')).toBeTruthy());
  });

  it('does not load the related database for an empty relation cell', async () => {
    renderItems([]);

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());
    expect(mockDatabaseContext.getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(mockDatabaseContext.loadView).not.toHaveBeenCalled();
  });

  it('stops the indicator when a linked row cannot be read', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createRelatedDatabaseDoc());
    mockDatabaseContext.createRow.mockRejectedValue(new Error('row unavailable'));

    renderItems(['row-1']);

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());
  });
});
