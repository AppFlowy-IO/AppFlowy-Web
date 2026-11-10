import { render, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import type { DatabaseContextState } from '@/application/database-yjs/context';
import type { YDoc } from '@/application/types';
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
