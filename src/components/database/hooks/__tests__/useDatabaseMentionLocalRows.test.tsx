import { render, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { releaseRowDocSyncBinding, retainRowDocSyncBinding } from '@/application/database-blob/row-doc-retention';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { cacheCanonicalRowDoc } from '@/application/services/js-services/cache';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { RichTextCellContext } from '@/components/database/components/cell/text/rich-text/RichTextCellContext';
import { useEditorContext } from '@/components/editor/EditorContext';

import { getDatabaseMentionRowsSource, useDatabaseMentionLocalRows } from '../useDatabaseMentionLocalRows';

let mockContext: Partial<DatabaseContextState> | undefined;

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabaseContextOptional: () => mockContext,
}));

type Context = Parameters<typeof useDatabaseMentionLocalRows>[0];

function databaseContext(doc: YDoc, fields: Partial<DatabaseContextState> = {}): Context {
  return { databaseDoc: doc, rowMap: {}, ...fields };
}

const DATABASE_ID = '00000000-0000-4000-8000-0000000000db';
const ROW_ID = '00000000-0000-4000-8000-000000000001';

/** A database document with a primary text field, `name`, and a grid listing {@link ROW_ID}. */
function databaseWithRow() {
  const databaseDoc = new Y.Doc({ guid: DATABASE_ID }) as YDoc;

  databaseDoc.transact(() => {
    const database = new Y.Map<unknown>();
    const fields = new Y.Map<unknown>();
    const field = new Y.Map<unknown>();
    const views = new Y.Map<unknown>();
    const grid = new Y.Map<unknown>();
    const rowOrders = new Y.Array<{ id: string; height: number }>();

    field.set(YjsDatabaseKey.id, 'name');
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, true);
    fields.set('name', field);
    rowOrders.push([{ id: ROW_ID, height: 36 }]);
    grid.set(YjsDatabaseKey.row_orders, rowOrders);
    views.set('grid', grid);
    database.set(YjsDatabaseKey.id, DATABASE_ID);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  });
  return databaseDoc;
}

/** A document of {@link ROW_ID} titled `title`, as the row document cache holds it. */
function rowDocTitled(title: string) {
  const rowDoc = new Y.Doc({ guid: ROW_ID }) as YDoc;

  rowDoc.transact(() => {
    const row = new Y.Map<unknown>();
    const cells = new Y.Map<unknown>();
    const cell = new Y.Map<unknown>();

    cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    cell.set(YjsDatabaseKey.data, title);
    cells.set('name', cell);
    row.set(YjsDatabaseKey.id, ROW_ID);
    row.set(YjsDatabaseKey.cells, cells);
    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
  });
  return rowDoc;
}

function setRowTitle(rowDoc: YDoc, title: string) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<Y.Map<Y.Map<unknown>>>;

  row.get(YjsDatabaseKey.cells)?.get('name')?.set(YjsDatabaseKey.data, title);
}

describe('useDatabaseMentionLocalRows (MEN-WEB-15)', () => {
  afterEach(() => {
    mockContext = undefined;
    jest.restoreAllMocks();
  });

  it("gives an editable editor the database's rows source, shared by every editor of the database", () => {
    const doc = new Y.Doc({ guid: 'database' }) as YDoc;
    const first = renderHook(() => useDatabaseMentionLocalRows(databaseContext(doc), 'grid', true));
    const second = renderHook(() => useDatabaseMentionLocalRows(databaseContext(doc), 'board', true));

    expect(first.result.current?.databaseViewId).toBe('grid');
    expect(second.result.current?.databaseViewId).toBe('board');
    expect(first.result.current?.source).toBe(second.result.current?.source);
    expect(first.result.current?.source).toBe(getDatabaseMentionRowsSource(doc));
    expect(getDatabaseMentionRowsSource(new Y.Doc() as YDoc)).not.toBe(getDatabaseMentionRowsSource(doc));
  });

  it('gives nothing where the picker cannot open, outside a database, without a view, or in a history preview', () => {
    const doc = new Y.Doc() as YDoc;

    expect(renderHook(() => useDatabaseMentionLocalRows(databaseContext(doc), 'grid', false)).result.current).toBe(
      undefined
    );
    expect(renderHook(() => useDatabaseMentionLocalRows(undefined, 'grid', true)).result.current).toBe(undefined);
    expect(renderHook(() => useDatabaseMentionLocalRows(databaseContext(doc), undefined, true)).result.current).toBe(
      undefined
    );
    expect(
      renderHook(() =>
        useDatabaseMentionLocalRows(databaseContext(doc, { dataSource: { type: 'history', id: 'h1' } }), 'grid', true)
      ).result.current
    ).toBe(undefined);
  });

  it('tells the source to look again when the view opens rows and when the row walk commits its seeds', () => {
    const doc = new Y.Doc() as YDoc;
    const source = getDatabaseMentionRowsSource(doc);
    const refresh = jest.spyOn(source, 'refresh');
    const rowPassListeners = new Set<() => void>();
    const subscribeToRowPassState = (listener: () => void) => {
      rowPassListeners.add(listener);
      return () => {
        rowPassListeners.delete(listener);
      };
    };

    const { rerender, unmount } = renderHook(
      ({ rowMap }) =>
        useDatabaseMentionLocalRows(databaseContext(doc, { rowMap, subscribeToRowPassState }), 'grid', true),
      { initialProps: { rowMap: {} as Record<string, YDoc> } }
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ rowMap: { row: new Y.Doc() as YDoc } });
    expect(refresh).toHaveBeenCalledTimes(2);

    rowPassListeners.forEach((listener) => listener());
    expect(refresh).toHaveBeenCalledTimes(3);

    unmount();
    expect(rowPassListeners.size).toBe(0);
  });

  it('keeps telling the source when the walk commits its seeds after another editor of the database unmounts', () => {
    const doc = new Y.Doc() as YDoc;
    const source = getDatabaseMentionRowsSource(doc);
    const refresh = jest.spyOn(source, 'refresh');
    // The row-pass store keeps its listeners in a set, as `createRowPassStore` does.
    const rowPassListeners = new Set<() => void>();
    const subscribeToRowPassState = (listener: () => void) => {
      rowPassListeners.add(listener);
      return () => {
        rowPassListeners.delete(listener);
      };
    };

    const context = databaseContext(doc, { subscribeToRowPassState });
    // A row page and a Text cell of the same database, the cell's editor closed first.
    const rowPage = renderHook(() => useDatabaseMentionLocalRows(context, 'grid', true));
    const textCell = renderHook(() => useDatabaseMentionLocalRows(context, 'grid', true));

    expect(rowPassListeners.size).toBe(2);
    textCell.unmount();
    expect(rowPassListeners.size).toBe(1);

    refresh.mockClear();
    rowPassListeners.forEach((listener) => listener());
    expect(refresh).toHaveBeenCalledTimes(1);

    rowPage.unmount();
    expect(rowPassListeners.size).toBe(0);
  });

  it('reads a live row as synced only while the tab keeps its document in sync', async () => {
    const databaseDoc = databaseWithRow();
    const rowDoc = rowDocTitled('Road trip');

    // In the row document cache, as a view that opened the row keeps it, but not synced yet.
    cacheCanonicalRowDoc(ROW_ID, rowDoc);

    const source = getDatabaseMentionRowsSource(databaseDoc);
    const leave = source.subscribe(() => undefined);

    try {
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip', synced: false }]);

      retainRowDocSyncBinding(ROW_ID);
      source.refresh();
      await Promise.resolve();
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip', synced: true }]);
    } finally {
      leave();
      releaseRowDocSyncBinding(ROW_ID, rowDoc);
      rowDoc.destroy();
    }
  });

  it('follows the document a version reset caches for a row once the view takes it', async () => {
    const databaseDoc = databaseWithRow();
    const first = rowDocTitled('Road trip');
    let current = first;

    cacheCanonicalRowDoc(ROW_ID, first);
    retainRowDocSyncBinding(ROW_ID);

    const { rerender } = renderHook(
      ({ rowMap }) => useDatabaseMentionLocalRows(databaseContext(databaseDoc, { rowMap }), 'grid', true),
      { initialProps: { rowMap: { [ROW_ID]: first } as Record<string, YDoc> } }
    );
    const source = getDatabaseMentionRowsSource(databaseDoc);
    const leave = source.subscribe(() => undefined);

    try {
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip', synced: true }]);

      // As `useCollabMessageHandler` resets a row: the old document is destroyed, which drops it
      // from the cache, the canonical one is cached under the same id, and `Database` puts it in
      // the row map, which tells the source to look again.
      const next = rowDocTitled('Road trip 2027');

      first.destroy();
      cacheCanonicalRowDoc(ROW_ID, next);
      current = next;
      rerender({ rowMap: { [ROW_ID]: next } });
      await Promise.resolve();
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip 2027', synced: true }]);

      setRowTitle(next, 'Road trip 2028');
      await Promise.resolve();
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip 2028', synced: true }]);
    } finally {
      leave();
      releaseRowDocSyncBinding(ROW_ID, current);
      current.destroy();
    }
  });

  function MentionRowsProbe() {
    const { mentionLocalRows, mentionContext } = useEditorContext();

    return (
      <div
        data-testid='probe'
        data-rows-view={mentionLocalRows?.databaseViewId ?? 'none'}
        data-shared={String(
          Boolean(
            mentionLocalRows &&
              mentionLocalRows.source === getDatabaseMentionRowsSource(mockContext?.databaseDoc as YDoc)
          )
        )}
        data-context-view={mentionContext?.database_view_id}
        data-context-row={mentionContext?.row_id}
      />
    );
  }

  it("gives an editable Text cell's picker the rows of its database, in the view the cell is edited in", () => {
    const doc = new Y.Doc() as YDoc;

    mockContext = { databaseDoc: doc, rowMap: {}, activeViewId: 'grid', databasePageId: 'page', workspaceId: 'w' };

    const { getByTestId, rerender } = render(
      <RichTextCellContext rowId='row' readOnly={false}>
        <MentionRowsProbe />
      </RichTextCellContext>
    );

    // The context names the cell's row, which the picker's rows lane leaves out.
    expect(getByTestId('probe').dataset).toMatchObject({
      rowsView: 'grid',
      shared: 'true',
      contextView: 'grid',
      contextRow: 'row',
    });

    rerender(
      <RichTextCellContext rowId='row' readOnly>
        <MentionRowsProbe />
      </RichTextCellContext>
    );
    expect(getByTestId('probe').dataset.rowsView).toBe('none');
  });
});
