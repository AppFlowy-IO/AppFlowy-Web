import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import * as Y from 'yjs';

import { copyDatabaseViewConfiguration } from '@/application/database-yjs/database-view-doc-ops';
import { atomicRead } from '@/application/atomic-creation';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { useDuplicateDatabaseView } from '@/application/database-yjs/dispatch';
import {
  DatabaseViewLayout,
  type View,
  ViewLayout,
  type YDatabaseView,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';

jest.mock('@/application/atomic-creation', () => ({
  atomicRead: jest.fn(),
  captureAtomicCreationOwner: (_workspace: string, check: () => void) => ({ assertCurrent: check }),
}));
jest.mock('@/application/database-yjs/creation/create-default-view', () => ({ createDefaultDatabaseView: jest.fn() }));

const disposeFixtures: (() => void)[] = [];

function fixture(layout = DatabaseViewLayout.Gallery, name = 'Gallery') {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const database = new Y.Map();
  const views = new Y.Map<YDatabaseView>();
  const source = new Y.Map() as YDatabaseView;

  source.set(YjsDatabaseKey.id, 'source-view-id');
  source.set(YjsDatabaseKey.name, name);
  source.set(YjsDatabaseKey.layout, layout);
  views.set('source-view-id', source);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const folderSource: View = {
    view_id: 'source-view-id',
    parent_view_id: 'container',
    name,
    layout: layout === DatabaseViewLayout.Form ? ViewLayout.Form : ViewLayout.Gallery,
    icon: null,
    extra: {},
    children: [],
    is_private: false,
    is_published: false,
  };
  const container: View = {
    ...folderSource,
    view_id: 'container',
    parent_view_id: 'space',
    extra: { is_database_container: true },
    children: [folderSource],
  };

  jest.mocked(atomicRead).mockImplementation(async (_owner, url) => {
    if (url.endsWith('/source-view-id')) return folderSource as never;
    if (url.endsWith('/container')) return container as never;
    throw new Error('Unexpected metadata read');
  });
  const ensureVisible = jest.fn(async () => ['space', 'container']);
  const context: DatabaseContextState = {
    databaseDoc: doc,
    databasePageId: 'container',
    activeViewId: 'source-view-id',
    workspaceId: 'workspace',
    rowMap: {},
    readOnly: false,
    canWrite: true,
  };
  const hook = renderHook(() => useDuplicateDatabaseView(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        AppOutlineContext.Provider,
        { value: { outline: [container], ensureViewVisibleInOutline: ensureVisible } },
        createElement(DatabaseContext.Provider, { value: context }, children)
      ),
  });
  const updates = jest.fn();

  doc.on('update', updates);
  disposeFixtures.push(() => {
    hook.unmount();
    doc.destroy();
  });
  return { ...hook, doc, database, views, source, updates, ensureVisible };
}

afterEach(() => {
  disposeFixtures.splice(0).forEach((dispose) => dispose());
});

beforeEach(() => {
  jest.mocked(atomicRead).mockReset();
  jest.mocked(createDefaultDatabaseView).mockReset().mockResolvedValue('server-created-view');
});

describe('server-owned database view duplication', () => {
  it('keeps nested settings untouched while the atomic duplicate is pending', async () => {
    const f = fixture();
    const filters = new Y.Array();
    const filter = new Y.Map();
    const children = new Y.Array();
    const childFilter = new Y.Map();
    const layoutSettings = new Y.Map();
    const gallerySettings = new Y.Map();
    const groups = new Y.Array();
    const group = new Y.Map();
    const columns = new Y.Array();
    const column = new Y.Map();
    const fieldOrders = new Y.Array();

    childFilter.set('content', 'source-filter');
    children.push([childFilter]);
    filter.set('children', children);
    filters.push([filter]);
    gallerySettings.set('card_width', 320);
    layoutSettings.set(String(DatabaseViewLayout.Gallery), gallerySettings);
    column.set('visible', true);
    columns.push([column]);
    group.set('groups', columns);
    groups.push([group]);
    fieldOrders.push([{ id: 'field-id' }]);
    act(() => {
      f.source.set(YjsDatabaseKey.filters, filters as never);
      f.source.set(YjsDatabaseKey.layout_settings, layoutSettings as never);
      f.source.set(YjsDatabaseKey.groups, groups as never);
      f.source.set(YjsDatabaseKey.field_orders, fieldOrders as never);
    });
    const before = Y.encodeStateAsUpdate(f.doc);

    f.updates.mockClear();
    let finish!: (viewId: string) => void;
    let entered!: () => void;
    const submitted = new Promise<void>((resolve) => {
      entered = resolve;
    });

    jest.mocked(createDefaultDatabaseView).mockImplementation(() => {
      entered();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const pending = f.result.current('source-view-id', 'Gallery (Copy)');

    await submitted;
    expect(createDefaultDatabaseView).toHaveBeenCalledTimes(1);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceViewId: 'source-view-id',
        databaseId: 'database-id',
        parentViewId: 'container',
        layout: DatabaseViewLayout.Gallery,
        name: 'Gallery (Copy)',
        position: { kind: 'index', index: 0 },
      })
    );
    expect([...f.views.keys()]).toEqual(['source-view-id']);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(f.updates).not.toHaveBeenCalled();
    expect(f.ensureVisible).not.toHaveBeenCalled();
    finish('server-created-view');
    await expect(pending).resolves.toBe('server-created-view');
    expect(f.source.get(YjsDatabaseKey.filters)).toBe(filters);
    expect(childFilter.get('content')).toBe('source-filter');
    expect(gallerySettings.get('card_width')).toBe(320);
    expect(column.get('visible')).toBe(true);
    expect(fieldOrders.toJSON()).toEqual([{ id: 'field-id' }]);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  });

  it('leaves canonical deletion and restoration decisions to the server instead of rewriting source rows', async () => {
    const f = fixture();
    const rows = new Y.Array();
    const canonicalRows = new Y.Array();
    const internal = new Y.Map() as YDatabaseView;
    const metas = new Y.Map();

    rows.push([
      { id: 'visible-first', height: 10 },
      { id: 'canonical-deleted', height: 20 },
      { id: 'canonical-restored', height: 30, is_deleted: true },
      { id: 'raw-deleted', height: 40, is_deleted: true },
      { id: 'visible-last', height: 50 },
    ]);
    canonicalRows.push([
      { id: 'visible-first', height: 10, is_deleted: false },
      { id: 'canonical-deleted', height: 20, is_deleted: true },
      { id: 'canonical-restored', height: 30, is_deleted: false },
      { id: 'visible-last', height: 50, is_deleted: false },
    ]);
    internal.set(YjsDatabaseKey.id, 'inline-view-id');
    internal.set(YjsDatabaseKey.is_inline, true);
    internal.set(YjsDatabaseKey.row_orders, canonicalRows as never);
    metas.set(YjsDatabaseKey.iid, 'inline-view-id');
    act(() => {
      f.source.set(YjsDatabaseKey.row_orders, rows as never);
      f.views.set('inline-view-id', internal);
      f.database.set(YjsDatabaseKey.metas, metas);
    });
    const before = Y.encodeStateAsUpdate(f.doc);

    f.updates.mockClear();
    await expect(f.result.current('source-view-id')).resolves.toBe('server-created-view');
    expect(createDefaultDatabaseView).toHaveBeenCalledTimes(1);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ sourceViewId: 'source-view-id' }));
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(f.updates).not.toHaveBeenCalled();
    expect([...f.views.keys()]).toEqual(['source-view-id', 'inline-view-id']);
  });

  it('keeps Form questions intact when atomic duplication fails without exposing a local copy', async () => {
    const f = fixture(DatabaseViewLayout.Form, 'Form');
    const settings = new Y.Map();
    const question = new Y.Map();
    const decided = new Y.Map();

    question.set('included', true);
    question.set('required', true);
    question.set('description', 'Source description');
    decided.set('included', false);
    settings.set('field-id', question);
    settings.set('__form_decided__', decided);
    act(() => {
      f.source.set(YjsDatabaseKey.form_field_settings, settings as never);
    });
    const before = Y.encodeStateAsUpdate(f.doc);
    const offline = new Error('Network unavailable');

    f.updates.mockClear();
    jest.mocked(createDefaultDatabaseView).mockRejectedValue(offline);
    await expect(f.result.current('source-view-id')).rejects.toBe(offline);
    expect(createDefaultDatabaseView).toHaveBeenCalledTimes(1);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceViewId: 'source-view-id',
        layout: DatabaseViewLayout.Form,
        name: 'Form (Copy)',
      })
    );
    expect(f.source.get(YjsDatabaseKey.form_field_settings)).toBe(settings);
    expect(question.toJSON()).toEqual({ included: true, required: true, description: 'Source description' });
    expect(decided.get('included')).toBe(false);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(f.updates).not.toHaveBeenCalled();
    expect(f.ensureVisible).not.toHaveBeenCalled();
    expect([...f.views.keys()]).toEqual(['source-view-id']);
  });

  it('copies how the view opens records (open_pages_in, WP13 §3.8), and clears a stale one', () => {
    const doc = new Y.Doc();
    const views = doc.getMap<YDatabaseView>('views');
    const source = createView('source-view-id', 'Grid');
    const target = createView('target-view-id', 'Grid (Copy)');

    views.set('source-view-id', source);
    views.set('target-view-id', target);
    source.set(YjsDatabaseKey.open_pages_in, 'full_page');

    copyDatabaseViewConfiguration(source, target);
    expect(target.get(YjsDatabaseKey.open_pages_in)).toBe('full_page');

    source.delete(YjsDatabaseKey.open_pages_in);
    copyDatabaseViewConfiguration(source, target);
    expect(target.get(YjsDatabaseKey.open_pages_in)).toBeUndefined();
  });
});

function createView(id: string, name: string): YDatabaseView {
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.id, id);
  view.set(YjsDatabaseKey.name, name);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Gallery);
  return view;
}
