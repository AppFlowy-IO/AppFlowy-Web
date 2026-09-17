import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { useSourceDocRegistry } from '../hooks/useSourceDocRegistry';
import { sameExtraFilters, useWidgetExtraFilters } from '../hooks/useWidgetExtraFilters';
import { useDelayedFlag, useWidgetViewSnapshot } from '../hooks/useWidgetViewSnapshot';

function globalFilter(id: string, targets: Record<string, string>, content = 'done'): DashboardGlobalFilter {
  return { id, name: id, fieldType: FieldType.RichText, condition: 0, content, targets };
}

function createDoc() {
  return new Y.Doc() as unknown as YDoc;
}

function addDatabase(doc: YDoc) {
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map() as unknown as YDatabaseViews;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views as never);
  return views;
}

function addView(views: YDatabaseViews, viewId: string, name: string, layout: DatabaseViewLayout) {
  const view = new Y.Map() as YDatabaseView;

  views.set(viewId, view);
  view.set(YjsDatabaseKey.name, name);
  view.set(YjsDatabaseKey.layout, layout);
  return view;
}

describe('useSourceDocRegistry', () => {
  it('registers a source doc once and releases it with the last widget', () => {
    const register = jest.fn();
    const doc = createDoc();
    const { result } = renderHook(() => useSourceDocRegistry(register, 'host'));

    const releaseFirst = result.current('other', doc);
    const releaseSecond = result.current('other', doc);

    expect(register.mock.calls).toEqual([['other', doc]]);
    releaseFirst();
    releaseFirst();
    expect(register).toHaveBeenCalledTimes(1);
    releaseSecond();
    expect(register.mock.calls).toEqual([
      ['other', doc],
      ['other', null],
    ]);
  });

  it('re-registers when a widget brings a newer doc of the same database', () => {
    const register = jest.fn();
    const first = createDoc();
    const second = createDoc();
    const { result } = renderHook(() => useSourceDocRegistry(register, 'host'));

    result.current('other', first);
    result.current('other', second);

    expect(register.mock.calls).toEqual([
      ['other', first],
      ['other', second],
    ]);
  });

  it('never touches the host database or empty ids', () => {
    const register = jest.fn();
    const { result } = renderHook(() => useSourceDocRegistry(register, 'host'));

    result.current('host', createDoc())();
    result.current('', createDoc())();

    expect(register).not.toHaveBeenCalled();
  });
});

describe('useWidgetExtraFilters', () => {
  it('resolves the filters mapped to the widget database', () => {
    const filters = [globalFilter('a', { db1: 'f1', db2: 'f2' }), globalFilter('b', { db2: 'f3' })];
    const { result } = renderHook(() => useWidgetExtraFilters(filters, 'db1'));

    expect(result.current).toEqual([
      { id: 'a', filter_type: FilterType.Data, field_id: 'f1', ty: FieldType.RichText, condition: 0, content: 'done' },
    ]);
  });

  it('returns undefined when no filter targets the database', () => {
    const { result } = renderHook(() => useWidgetExtraFilters([globalFilter('a', { db2: 'f2' })], 'db1'));

    expect(result.current).toBeUndefined();
  });

  it('keeps the same array while the resolved filters are unchanged', () => {
    let filters = [globalFilter('a', { db1: 'f1' }), globalFilter('b', { db2: 'f2' })];
    const { result, rerender } = renderHook(() => useWidgetExtraFilters(filters, 'db1'));
    const first = result.current;

    // Another database's filter changes: this widget keeps its array.
    filters = [globalFilter('a', { db1: 'f1' }), globalFilter('b', { db2: 'f2' }, 'changed')];
    rerender();
    expect(result.current).toBe(first);

    filters = [globalFilter('a', { db1: 'f1' }, 'changed')];
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current?.[0].content).toBe('changed');
  });

  it('compares resolved filters by value', () => {
    const a = [
      {
        id: 'a',
        filter_type: FilterType.Data as const,
        field_id: 'f',
        ty: FieldType.Number,
        condition: 1,
        content: '2',
      },
    ];

    expect(sameExtraFilters(a, [{ ...a[0] }])).toBe(true);
    expect(sameExtraFilters(a, [{ ...a[0], condition: 2 }])).toBe(false);
    expect(sameExtraFilters(a, [])).toBe(false);
    expect(sameExtraFilters(undefined, undefined)).toBe(true);
    expect(sameExtraFilters(a, undefined)).toBe(false);
  });
});

describe('useWidgetViewSnapshot', () => {
  it('reports nothing without a doc', () => {
    const { result } = renderHook(() => useWidgetViewSnapshot(null, 'view'));

    expect(result.current).toEqual({ hasDatabase: false, exists: false, name: '', layout: null });
  });

  it('follows the database arriving and the view changing', () => {
    const doc = createDoc();
    const { result } = renderHook(() => useWidgetViewSnapshot(doc, 'view'));

    expect(result.current.hasDatabase).toBe(false);

    let views!: YDatabaseViews;

    act(() => {
      views = addDatabase(doc);
    });
    expect(result.current).toEqual({ hasDatabase: true, exists: false, name: '', layout: null });

    let view!: YDatabaseView;

    act(() => {
      view = addView(views, 'view', 'Tasks', DatabaseViewLayout.Board);
    });
    expect(result.current).toEqual({
      hasDatabase: true,
      exists: true,
      name: 'Tasks',
      layout: DatabaseViewLayout.Board,
    });

    act(() => {
      view.set(YjsDatabaseKey.name, 'Renamed');
    });
    expect(result.current.name).toBe('Renamed');

    act(() => {
      views.delete('view');
    });
    expect(result.current.exists).toBe(false);
  });

  it('keeps its snapshot identity across unrelated edits', () => {
    const doc = createDoc();
    const views = addDatabase(doc);

    addView(views, 'view', 'Tasks', DatabaseViewLayout.Grid);
    const other = addView(views, 'other', 'Other', DatabaseViewLayout.Grid);
    const { result } = renderHook(() => useWidgetViewSnapshot(doc, 'view'));
    const before = result.current;

    act(() => {
      other.set(YjsDatabaseKey.name, 'Changed');
    });
    expect(result.current).toBe(before);
  });

  it('normalizes non-number layout values (Rust-backed docs may not store plain numbers)', () => {
    const doc = createDoc();
    const views = addDatabase(doc);
    const view = addView(views, 'view', 'Chart', DatabaseViewLayout.Grid);

    view.set(YjsDatabaseKey.layout, String(DatabaseViewLayout.Chart) as unknown as DatabaseViewLayout);
    const { result } = renderHook(() => useWidgetViewSnapshot(doc, 'view'));

    expect(result.current.layout).toBe(DatabaseViewLayout.Chart);
  });
});

describe('useDelayedFlag', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns true only after the flag stayed active for the delay', () => {
    let active = true;
    const { result, rerender } = renderHook(() => useDelayedFlag(active, 1000));

    expect(result.current).toBe(false);
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(result.current).toBe(false);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);

    active = false;
    rerender();
    expect(result.current).toBe(false);

    active = true;
    rerender();
    expect(result.current).toBe(false);
  });

  it('restarts the delay when the flag flickers', () => {
    let active = true;
    const { result, rerender } = renderHook(() => useDelayedFlag(active, 1000));

    act(() => {
      jest.advanceTimersByTime(600);
    });
    active = false;
    rerender();
    active = true;
    rerender();
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current).toBe(false);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(result.current).toBe(true);
  });
});
