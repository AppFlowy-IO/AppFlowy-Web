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
let mockRelatedDatabaseId = 'related-database';

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabaseContextOptional: () => mockDatabaseContext,
  useDatabaseIdFromField: () => mockRelatedDatabaseId,
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

function createRelatedDatabaseDoc(rowIds?: string[], viewId = RELATED_VIEW_ID, databaseId = 'related-database'): YDoc {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map();
  const primaryField = new Y.Map();

  doc.guid = viewId;
  primaryField.set(YjsDatabaseKey.id, PRIMARY_FIELD_ID);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(PRIMARY_FIELD_ID, primaryField);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  if (rowIds) {
    const rowOrders = new Y.Array();
    const view = new Y.Map();
    const views = new Y.Map();

    rowOrders.push(rowIds.map((id) => ({ id })));
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    views.set(viewId, view);
    database.set(YjsDatabaseKey.views, views);
  }

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
    mockRelatedDatabaseId = 'related-database';
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

    view.resolve(createRelatedDatabaseDoc(['row-1']));

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
    mockDatabaseContext.loadView.mockResolvedValue(createRelatedDatabaseDoc(['row-1']));
    mockDatabaseContext.createRow.mockRejectedValue(new Error('row unavailable'));

    renderItems(['row-1']);

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());
  });

  it('settles an empty row shell when authoritative row orders say the relation is deleted', async () => {
    const databaseDoc = createRelatedDatabaseDoc();
    const emptyRowDoc = new Y.Doc({ guid: 'related-database_rows_row-1' }) as YDoc;

    mockDatabaseContext.loadView.mockResolvedValue(databaseDoc);
    mockDatabaseContext.createRow.mockResolvedValue(emptyRowDoc);

    renderItems(['row-1']);

    await waitFor(() => expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    act(() => {
      const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const rowOrders = new Y.Array();
      const view = new Y.Map();
      const views = new Y.Map();

      view.set(YjsDatabaseKey.row_orders, rowOrders);
      views.set(RELATED_VIEW_ID, view);
      database.set(YjsDatabaseKey.views, views);
    });

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());
  });

  it('keeps a linked row that is live in another database view', async () => {
    const databaseDoc = createRelatedDatabaseDoc(['row-visible-in-primary']);
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const secondaryView = new Y.Map();
    const secondaryRowOrders = new Y.Array();

    secondaryRowOrders.push([{ id: 'row-1' }]);
    secondaryView.set(YjsDatabaseKey.row_orders, secondaryRowOrders);
    database.get(YjsDatabaseKey.views)?.set('secondary-view', secondaryView);

    const rowDoc = new Y.Doc({ guid: 'related-database_rows_row-1' }) as YDoc;
    const row = new Y.Map();
    const cells = new Y.Map();
    const primaryCell = new Y.Map();

    primaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    primaryCell.set(YjsDatabaseKey.data, 'Linked from another view');
    cells.set(PRIMARY_FIELD_ID, primaryCell);
    row.set(YjsDatabaseKey.cells, cells);
    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);

    mockDatabaseContext.loadView.mockResolvedValue(databaseDoc);
    mockDatabaseContext.createRow.mockResolvedValue(rowDoc);

    renderItems(['row-1']);

    await waitFor(() => expect(screen.getByText('Linked from another view')).toBeTruthy());
    expect(screen.queryByRole('status', { name: 'loading' })).toBeNull();
  });

  it('checks only the row that is still hydrating and releases observers after readiness', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createRelatedDatabaseDoc(['row-1', 'row-2']));

    const firstRowDoc = new Y.Doc({ guid: 'row-1' }) as YDoc;
    const firstData = firstRowDoc.getMap(YjsEditorKey.data_section);
    const firstRow = new Y.Map();
    const firstCells = new Y.Map();
    const firstPrimaryCell = new Y.Map();

    firstData.set(YjsEditorKey.database_row, firstRow);
    firstRow.set(YjsDatabaseKey.cells, firstCells);
    firstCells.set(PRIMARY_FIELD_ID, firstPrimaryCell);
    firstPrimaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    firstPrimaryCell.set(YjsDatabaseKey.data, 'First');

    const secondRowDoc = new Y.Doc({ guid: 'row-2' }) as YDoc;
    const secondData = secondRowDoc.getMap(YjsEditorKey.data_section);

    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      Promise.resolve(rowKey.endsWith('row-1') ? firstRowDoc : secondRowDoc)
    );

    renderItems(['row-1', 'row-2']);

    await waitFor(() => expect(screen.getByText('First')).toBeTruthy());
    expect(screen.getByRole('status', { name: 'loading' })).toBeTruthy();

    const secondDataGet = jest.spyOn(secondData, 'get');

    secondDataGet.mockClear();
    act(() => {
      firstData.set('unrelated', true);
    });
    expect(secondDataGet).not.toHaveBeenCalled();

    const secondRow = new Y.Map();
    const secondCells = new Y.Map();
    const secondPrimaryCell = new Y.Map();

    act(() => {
      secondData.set(YjsEditorKey.database_row, secondRow);
      secondRow.set(YjsDatabaseKey.cells, secondCells);
      secondCells.set(PRIMARY_FIELD_ID, secondPrimaryCell);
      secondPrimaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      secondPrimaryCell.set(YjsDatabaseKey.data, 'Second');
    });

    await waitFor(() => expect(screen.queryByRole('status', { name: 'loading' })).toBeNull());
    secondDataGet.mockClear();
    act(() => {
      firstData.set('another-unrelated-key', true);
    });
    expect(secondDataGet).not.toHaveBeenCalled();
  });

  it('isolates row membership from unrelated database and row edits', async () => {
    const databaseDoc = createRelatedDatabaseDoc(['row-1', 'row-2']);
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const rowOrders = database.get(YjsDatabaseKey.views).get(RELATED_VIEW_ID).get(YjsDatabaseKey.row_orders);
    const rowDoc = new Y.Doc({ guid: 'row-1' }) as YDoc;
    const row = new Y.Map();
    const cells = new Y.Map();
    const primaryCell = new Y.Map();

    primaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    primaryCell.set(YjsDatabaseKey.data, 'Initial title');
    cells.set(PRIMARY_FIELD_ID, primaryCell);
    row.set(YjsDatabaseKey.cells, cells);
    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    mockDatabaseContext.loadView.mockResolvedValue(databaseDoc);
    mockDatabaseContext.createRow.mockResolvedValue(rowDoc);

    renderItems(['row-1']);

    await waitFor(() => expect(screen.getByText('Initial title')).toBeTruthy());
    expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(1);

    const toArraySpy = jest.spyOn(rowOrders, 'toArray');

    toArraySpy.mockClear();
    act(() => {
      database.set('unrelated-database-key', true);
      primaryCell.set(YjsDatabaseKey.data, 'Edited title');
    });

    await waitFor(() => expect(screen.getByText('Edited title')).toBeTruthy());
    expect(toArraySpy).not.toHaveBeenCalled();
    expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(1);

    toArraySpy.mockClear();
    act(() => {
      databaseDoc.transact(() => {
        rowOrders.delete(0, rowOrders.length);
        rowOrders.push([{ id: 'row-2' }, { id: 'row-1' }]);
      });
    });

    expect(toArraySpy).toHaveBeenCalled();
    expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(1);

    act(() => {
      rowOrders.delete(1, 1);
    });

    await waitFor(() => expect(screen.queryByText('Edited title')).toBeNull());
    expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(1);

    act(() => {
      rowOrders.push([{ id: 'row-1' }]);
    });

    await waitFor(() => expect(screen.getByText('Edited title')).toBeTruthy());
    expect(mockDatabaseContext.createRow).toHaveBeenCalledTimes(2);
  });

  it('never commits a delayed row result from the previous relation target', async () => {
    const databaseADoc = createRelatedDatabaseDoc(['row-1'], 'view-a', 'database-a');
    const databaseBDoc = createRelatedDatabaseDoc(['row-1'], 'view-b', 'database-b');
    const delayedARow = deferred<YDoc>();
    const rowADoc = new Y.Doc({ guid: 'view-a_rows_row-1' }) as YDoc;
    const rowBDoc = new Y.Doc({ guid: 'view-b_rows_row-1' }) as YDoc;

    const hydrateRow = (doc: YDoc, title: string) => {
      const row = new Y.Map();
      const cells = new Y.Map();
      const primaryCell = new Y.Map();

      primaryCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      primaryCell.set(YjsDatabaseKey.data, title);
      cells.set(PRIMARY_FIELD_ID, primaryCell);
      row.set(YjsDatabaseKey.cells, cells);
      doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    };

    hydrateRow(rowADoc, 'Database A row');
    hydrateRow(rowBDoc, 'Database B row');
    mockRelatedDatabaseId = 'database-a';
    mockDatabaseContext.getViewIdFromDatabaseId.mockImplementation((databaseId: string) =>
      Promise.resolve(databaseId === 'database-a' ? 'view-a' : 'view-b')
    );
    mockDatabaseContext.loadView.mockImplementation((viewId: string) =>
      Promise.resolve(viewId === 'view-a' ? databaseADoc : databaseBDoc)
    );
    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      rowKey.startsWith('view-a_rows_') ? delayedARow.promise : Promise.resolve(rowBDoc)
    );

    const cell = createRelationCell(['row-1']);
    const rendered = render(<RelationItems cell={cell} fieldId='relation-field' wrap={false} />);

    await waitFor(() => expect(mockDatabaseContext.createRow).toHaveBeenCalledWith('view-a_rows_row-1'));

    mockRelatedDatabaseId = 'database-b';
    rendered.rerender(<RelationItems cell={cell} fieldId='relation-field' wrap={false} />);

    await waitFor(() => expect(screen.getByText('Database B row')).toBeTruthy());

    await act(async () => {
      delayedARow.resolve(rowADoc);
      await delayedARow.promise;
    });

    expect(screen.queryByText('Database A row')).toBeNull();
    expect(screen.getByText('Database B row')).toBeTruthy();
  });
});
