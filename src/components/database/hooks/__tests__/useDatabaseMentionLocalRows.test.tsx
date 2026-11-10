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
    const databaseId = '00000000-0000-4000-8000-0000000000db';
    const rowId = '00000000-0000-4000-8000-000000000001';
    const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
    const rowDoc = new Y.Doc({ guid: rowId }) as YDoc;

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
      rowOrders.push([{ id: rowId, height: 36 }]);
      grid.set(YjsDatabaseKey.row_orders, rowOrders);
      views.set('grid', grid);
      database.set(YjsDatabaseKey.id, databaseId);
      database.set(YjsDatabaseKey.fields, fields);
      database.set(YjsDatabaseKey.views, views);
      databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    });
    rowDoc.transact(() => {
      const row = new Y.Map<unknown>();
      const cells = new Y.Map<unknown>();
      const cell = new Y.Map<unknown>();

      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      cell.set(YjsDatabaseKey.data, 'Road trip');
      cells.set('name', cell);
      row.set(YjsDatabaseKey.id, rowId);
      row.set(YjsDatabaseKey.cells, cells);
      rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    });
    // In the row document cache, as a view that opened the row keeps it, but not synced yet.
    cacheCanonicalRowDoc(rowId, rowDoc);

    const source = getDatabaseMentionRowsSource(databaseDoc);
    const leave = source.subscribe(() => undefined);

    try {
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip', synced: false }]);

      retainRowDocSyncBinding(rowId);
      source.refresh();
      await Promise.resolve();
      expect(source.getSnapshot().rows).toMatchObject([{ title: 'Road trip', synced: true }]);
    } finally {
      leave();
      releaseRowDocSyncBinding(rowId, rowDoc);
      rowDoc.destroy();
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

    expect(getByTestId('probe').dataset).toMatchObject({ rowsView: 'grid', shared: 'true', contextView: 'grid' });

    rerender(
      <RichTextCellContext rowId='row' readOnly>
        <MentionRowsProbe />
      </RichTextCellContext>
    );
    expect(getByTestId('probe').dataset.rowsView).toBe('none');
  });
});
