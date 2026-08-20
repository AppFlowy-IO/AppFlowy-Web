import { render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs';
import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { View, YDatabase, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import RelationCellMenuContent from '@/components/database/components/cell/relation/RelationCellMenuContent';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockDatabaseContext = {
  navigateToView: jest.fn(),
  navigateToRow: jest.fn(),
  bindViewSync: jest.fn(),
  loadView: jest.fn(),
  createRow: jest.fn(),
};

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useDatabaseContext: () => mockDatabaseContext,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DATABASE_ID = 'db-1';
const VIEW_ID = 'view-1';
const PRIMARY_FIELD_ID = 'primary-field';

const UNTITLED = 'menuAppHeader.defaultNewPageName';
const DELETED = 'document.mention.deletedPage';
const NO_RESULT = 'findAndReplace.noResult';
const ROWS_LOADING = 'grid.row.loading';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/** A target database doc shaped the way the picker reads it: primary field + view row orders. */
function createTargetDoc(rowIds: string[]): YDoc {
  const doc = new Y.Doc() as YDoc;

  doc.guid = VIEW_ID;

  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map();
  const primaryField = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, PRIMARY_FIELD_ID);
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(PRIMARY_FIELD_ID, primaryField);

  const rowOrders = new Y.Array();

  rowOrders.push(rowIds.map((id) => ({ id })));

  const view = new Y.Map();

  view.set(YjsDatabaseKey.row_orders, rowOrders);

  const views = new Y.Map();

  views.set(VIEW_ID, view);

  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return doc;
}

/** A doc handed back by `loadView` before its first server sync has landed. */
function createEmptyDoc(): YDoc {
  const doc = new Y.Doc() as YDoc;

  doc.guid = VIEW_ID;
  doc.getMap(YjsEditorKey.data_section);

  return doc;
}

/** Fills an empty doc in the way a late sync would: database map, primary field, row orders. */
function syncDatabaseInto(doc: YDoc, rowIds: string[]) {
  const target = createTargetDoc(rowIds);
  const source = target.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  doc.transact(() => {
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, source.clone() as YDatabase);
  });
}

function createTitledRowDoc(rowId: string, title: string): YDoc {
  return createRowDoc(rowId, DATABASE_ID, {
    [PRIMARY_FIELD_ID]: { fieldType: FieldType.RichText, data: title },
  });
}

/** `createRow` is handed `${guid}_rows_${rowId}`; tests only care about the row id. */
function rowIdFromKey(rowKey: string): string {
  return rowKey.split('_rows_')[1];
}

function renderPicker(relationRowIds: string[] = []) {
  return render(
    <RelationCellMenuContent
      relationRowIds={relationRowIds}
      selectedView={{ view_id: VIEW_ID, name: 'Tasks' } as View}
      relatedDatabaseId={DATABASE_ID}
      onAddRelationRowId={jest.fn()}
      onRemoveRelationRowId={jest.fn()}
    />
  );
}

function skeletons() {
  return screen.queryAllByTestId('relation-row-skeleton');
}

describe('RelationCellMenuContent loading states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('holds a placeholder per row until its title arrives, rather than reading "Untitled"', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-1', 'row-2']));

    const first = deferred<YDoc>();
    const second = deferred<YDoc>();

    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      rowIdFromKey(rowKey) === 'row-1' ? first.promise : second.promise
    );

    renderPicker();

    await waitFor(() => {
      expect(mockDatabaseContext.loadView).toHaveBeenCalledWith(VIEW_ID, false, false, {
        databaseId: DATABASE_ID,
        databaseMetadataOnly: true,
      });
    });

    // Both rows are known the moment the row list lands; neither title has been fetched.
    await waitFor(() => expect(skeletons()).toHaveLength(2));
    expect(screen.queryByText(UNTITLED)).toBeNull();

    first.resolve(createTitledRowDoc('row-1', 'TSK-001'));

    await waitFor(() => expect(screen.getByText('TSK-001')).toBeTruthy());
    expect(skeletons()).toHaveLength(1);

    second.resolve(createTitledRowDoc('row-2', 'TSK-002'));

    await waitFor(() => expect(screen.getByText('TSK-002')).toBeTruthy());
    expect(skeletons()).toHaveLength(0);
  });

  it('settles an unreadable row on the empty-name wording instead of pulsing forever', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-1', 'row-2']));
    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      rowIdFromKey(rowKey) === 'row-1'
        ? Promise.reject(new Error('row unavailable'))
        : Promise.resolve(createTitledRowDoc('row-2', 'TSK-002'))
    );

    renderPicker();

    // The failure must not strand the rows queued behind it either.
    await waitFor(() => expect(screen.getByText('TSK-002')).toBeTruthy());
    expect(screen.getByText(UNTITLED)).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
  });

  it('places an already-linked row under a placeholder too, until its title arrives', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-1']));

    const linked = deferred<YDoc>();

    mockDatabaseContext.createRow.mockReturnValue(linked.promise);

    renderPicker(['row-1']);

    await waitFor(() => expect(skeletons()).toHaveLength(1));

    linked.resolve(createTitledRowDoc('row-1', 'TSK-001'));

    await waitFor(() => expect(screen.getByText('TSK-001')).toBeTruthy());
    expect(skeletons()).toHaveLength(0);
  });

  it('never places a deleted row under a placeholder — its wording is already final', async () => {
    // row-1 is linked by the cell but gone from the target database, so no doc will ever arrive.
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-2']));
    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      Promise.resolve(createTitledRowDoc(rowIdFromKey(rowKey), 'TSK-002'))
    );

    renderPicker(['row-1']);

    await waitFor(() => expect(screen.getByText(DELETED)).toBeTruthy());
    expect(skeletons()).toHaveLength(0);
  });

  it('picks up the row list when the target database syncs in after loadView resolves', async () => {
    // `loadView` hands back the doc as soon as it exists locally — reading it once left the
    // picker stuck on "no result" until it was closed and reopened.
    const doc = createEmptyDoc();

    mockDatabaseContext.loadView.mockResolvedValue(doc);
    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      Promise.resolve(createTitledRowDoc(rowIdFromKey(rowKey), 'TSK-001'))
    );

    renderPicker();

    await waitFor(() => expect(mockDatabaseContext.loadView).toHaveBeenCalled());
    // Nothing has synced yet, so the picker may not conclude the database is empty.
    expect(screen.queryByText(NO_RESULT)).toBeNull();

    syncDatabaseInto(doc, ['row-1']);

    await waitFor(() => expect(screen.getByText('TSK-001')).toBeTruthy());
    expect(screen.queryByText(NO_RESULT)).toBeNull();
  });

  it('refreshes a row title that syncs in after its row doc resolves', async () => {
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-1']));

    const rowDoc = createTitledRowDoc('row-1', '');

    mockDatabaseContext.createRow.mockResolvedValue(rowDoc);

    renderPicker();

    await waitFor(() => expect(screen.getByText(UNTITLED)).toBeTruthy());

    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    rowDoc.transact(() => {
      row.get(YjsDatabaseKey.cells)?.get(PRIMARY_FIELD_ID)?.set(YjsDatabaseKey.data, 'TSK-001');
    });

    await waitFor(() => expect(screen.getByText('TSK-001')).toBeTruthy());
  });

  it('lists the database rows when the relation points at a view the database does not register', async () => {
    // A relation can name the database's container page rather than one of its inner views. Rows
    // belong to the database, so keying strictly off the named view rendered an empty panel with
    // no explanation.
    mockDatabaseContext.loadView.mockResolvedValue(createTargetDoc(['row-1']));
    mockDatabaseContext.createRow.mockImplementation((rowKey: string) =>
      Promise.resolve(createTitledRowDoc(rowIdFromKey(rowKey), 'TSK-001'))
    );

    render(
      <RelationCellMenuContent
        relationRowIds={[]}
        selectedView={{ view_id: 'container-view', name: 'Tasks' } as View}
        relatedDatabaseId={DATABASE_ID}
        onAddRelationRowId={jest.fn()}
        onRemoveRelationRowId={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('TSK-001')).toBeTruthy());
  });

  it('does not claim "no result" while the row list is still in flight', async () => {
    const view = deferred<YDoc>();

    mockDatabaseContext.loadView.mockReturnValue(view.promise);
    mockDatabaseContext.createRow.mockImplementation(() => new Promise<YDoc>(() => undefined));

    renderPicker();

    // An empty picker mid-load is "nothing yet", not "nothing matched".
    await waitFor(() => expect(mockDatabaseContext.loadView).toHaveBeenCalled());
    expect(screen.queryByText(NO_RESULT)).toBeNull();

    view.resolve(createTargetDoc([]));

    await waitFor(() => expect(screen.getByText(NO_RESULT)).toBeTruthy());
  });

  it('shows a centered loading indicator while the relation row list is in flight', async () => {
    const view = deferred<YDoc>();

    mockDatabaseContext.loadView.mockReturnValue(view.promise);

    renderPicker();

    await waitFor(() => expect(mockDatabaseContext.loadView).toHaveBeenCalled());

    expect(screen.getByRole('status', { name: ROWS_LOADING })).toBeTruthy();

    view.resolve(createTargetDoc([]));

    await waitFor(() => expect(screen.queryByRole('status', { name: ROWS_LOADING })).toBeNull());
    expect(screen.getByText(NO_RESULT)).toBeTruthy();
  });
});
