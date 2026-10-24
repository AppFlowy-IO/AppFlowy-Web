import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import * as Y from 'yjs';

import { DatabaseContextState } from '@/application/database-yjs/context';
import { nextViewName } from '@/application/database-yjs/dashboard-owned-views';
import type { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import * as history from '@/application/database-yjs/history';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useSaveDrillAsView } from '../useSaveDrillAsView';

import {
  CHART_VIEW_ID,
  contextOf,
  createDrillFixture,
  DatabaseWrapper,
  selectFilterPlain,
  toYFilter,
} from './drillTestFixture';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const NEW_VIEW_ID = 'open-blockers';

const GLOBAL: DashboardExtraFilter = {
  id: 'gf1',
  filter_type: FilterType.Data,
  field_id: 'component',
  ty: FieldType.SingleSelect,
  condition: 0,
  content: 'o_mobile',
};
const CATEGORY: DashboardExtraFilter = {
  id: 'drill:x:0',
  filter_type: FilterType.Data,
  field_id: 'severity',
  ty: FieldType.SingleSelect,
  condition: 0,
  content: 'o_blocker',
};

/** What the server returns for the new tab: a Grid view of the database, as an update. */
function createViewUpdate(databaseDoc: YDoc, viewId: string): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const stateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const view = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push([{ id: 'name' }]);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  database.get(YjsDatabaseKey.views).set(viewId, view as unknown as YDatabaseView);
  return Array.from(Y.encodeStateAsUpdate(serverDoc, stateVector));
}

function setup(drillFilters: Record<string, unknown>[], containerViewId: string | null = 'container') {
  const fixture = createDrillFixture();
  const fieldSettings = fixture.view.get(YjsDatabaseKey.field_settings) as unknown as Y.Map<Y.Map<unknown>>;
  const setting = new Y.Map<unknown>();

  setting.set(YjsDatabaseKey.width, 220);
  fieldSettings.set('name', setting);
  const drill = createViewConditionsOverlay(fixture.view);
  const sort = new Y.Map<unknown>();

  sort.set(YjsDatabaseKey.id, 's1');
  sort.set(YjsDatabaseKey.field_id, 'name');
  sort.set(YjsDatabaseKey.condition, 0);
  (drill.view.get(YjsDatabaseKey.filters) as unknown as Y.Array<unknown>).push(
    drillFilters.map((filter) =>
      filter.children
        ? (() => {
            const map = toYFilter({ ...filter, children: undefined });
            const children = new Y.Array<unknown>();

            children.push((filter.children as Record<string, unknown>[]).map(toYFilter));
            map.set(YjsDatabaseKey.children, children);
            return map;
          })()
        : toYFilter(filter)
    )
  );
  (drill.view.get(YjsDatabaseKey.sorts) as unknown as Y.Array<unknown>).push([sort]);

  const createDatabaseView = jest.fn().mockImplementation(async () => ({
    view_id: NEW_VIEW_ID,
    database_id: 'bug-tracker',
    database_update: createViewUpdate(fixture.doc, NEW_VIEW_ID),
  }));
  const deletePage = jest.fn().mockResolvedValue(undefined);
  const navigateToView = jest.fn().mockResolvedValue(undefined);
  const loadViewMeta = jest.fn().mockImplementation(async (viewId: string) => ({
    view_id: viewId,
    name: 'Bug Tracker',
    extra: { is_database_container: true },
    children: [],
  }));
  const onClose = jest.fn();
  const context: DatabaseContextState = contextOf(fixture, {
    createDatabaseView,
    deletePage,
    navigateToView,
    loadViewMeta,
    isDashboardWidget: true,
    isDocumentBlock: true,
  });
  const { result } = renderHook(
    () =>
      useSaveDrillAsView({
        drillView: drill.view,
        globals: [GLOBAL],
        categoryNodes: [CATEGORY],
        containerViewId,
        onClose,
      }),
    { wrapper: ({ children }) => <DatabaseWrapper value={context}>{children}</DatabaseWrapper> }
  );

  const savedView = () =>
    (fixture.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
      .get(YjsDatabaseKey.views)
      .get(NEW_VIEW_ID);

  return { fixture, result, createDatabaseView, deletePage, navigateToView, onClose, savedView };
}

const plain = (view: YDatabaseView | undefined, key: string) =>
  ((view as unknown as Y.Map<unknown>)?.get(key) as Y.Array<unknown> | Y.Map<unknown>).toJSON();

describe('useSaveDrillAsView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a non-owned Grid tab under the container with the merged filters, the sorts and the field layout', async () => {
    const { result, createDatabaseView, navigateToView, onClose, savedView, fixture } = setup([
      selectFilterPlain('f-status', 'status', 'o_new'),
    ]);
    let viewId: string | null = null;

    await act(async () => {
      viewId = await result.current('Open blockers');
    });

    expect(viewId).toBe(NEW_VIEW_ID);
    expect(createDatabaseView).toHaveBeenCalledWith(
      'container',
      expect.objectContaining({
        layout: expect.anything(),
        name: 'Open blockers',
        database_id: 'bug-tracker',
        embedded: false,
      })
    );
    const filters = plain(savedView(), YjsDatabaseKey.filters) as Record<string, unknown>[];

    expect(
      filters.map(({ field_id, condition, content, filter_type }) => ({ field_id, condition, content, filter_type }))
    ).toEqual([
      { field_id: 'status', condition: 0, content: 'o_new', filter_type: FilterType.Data },
      { field_id: 'component', condition: 0, content: 'o_mobile', filter_type: FilterType.Data },
      { field_id: 'severity', condition: 0, content: 'o_blocker', filter_type: FilterType.Data },
    ]);
    // The drill's own filter keeps its id; the global and category filters get fresh ones.
    expect(filters[0].id).toBe('f-status');
    expect(filters[1].id).not.toBe('gf1');
    expect(filters[2].id).not.toBe('drill:x:0');
    expect(new Set(filters.map((filter) => filter.id)).size).toBe(3);
    expect(plain(savedView(), YjsDatabaseKey.sorts)).toEqual([{ id: 's1', field_id: 'name', condition: 0 }]);
    expect(plain(savedView(), YjsDatabaseKey.field_orders)).toEqual(plain(fixture.view, YjsDatabaseKey.field_orders));
    expect(plain(savedView(), YjsDatabaseKey.field_settings)).toEqual({ name: { width: 220 } });
    expect(savedView()?.get(YjsDatabaseKey.field_settings)).not.toBe(fixture.view.get(YjsDatabaseKey.field_settings));
    expect(savedView()?.get(YjsDatabaseKey.dashboard_owner)).toBeUndefined();
    // The chart view itself is unchanged.
    expect(plain(fixture.view, YjsDatabaseKey.filters)).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateToView).toHaveBeenCalledWith(NEW_VIEW_ID);
  });

  it('appends the global and category filters to an And root', async () => {
    const { result, savedView } = setup([
      { id: 'root', filter_type: FilterType.And, children: [selectFilterPlain('f-status', 'status', 'o_new')] },
    ]);

    await act(async () => {
      await result.current('Open blockers');
    });

    const [root] = plain(savedView(), YjsDatabaseKey.filters) as Array<{
      id: string;
      children: Array<{ field_id: string }>;
    }>;

    expect(root.id).toBe('root');
    expect(root.children.map((child) => child.field_id)).toEqual(['status', 'component', 'severity']);
  });

  it('names the view after the drill title, suffixed when the name is taken', () => {
    expect(nextViewName('Blocker', ['Blocker'])).toBe('Blocker (1)');
    expect(nextViewName('Blocker', ['By severity'])).toBe('Blocker');
  });

  it('removes the created view and shows the error toast when the conditions write fails', async () => {
    const { result, deletePage, navigateToView, onClose, savedView } = setup([]);
    const spy = jest.spyOn(history, 'executeDatabaseOperations').mockImplementation((_root, _ops, name) => {
      if (name === 'saveDrillAsView') throw new Error('write failed');
    });
    let viewId: string | null = 'unset';

    try {
      await act(async () => {
        viewId = await result.current('Open blockers');
      });
    } finally {
      spy.mockRestore();
    }

    expect(viewId).toBeNull();
    expect(savedView()).toBeUndefined();
    expect(deletePage).toHaveBeenCalledWith(NEW_VIEW_ID);
    expect(toast.error).toHaveBeenCalledWith('Could not create the view');
    expect(onClose).not.toHaveBeenCalled();
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it('anchors at the widget view while the container is unknown (the container lookup decides the tab parent)', async () => {
    const { result, createDatabaseView } = setup([], null);

    await act(async () => {
      await result.current('Open blockers');
    });

    expect(createDatabaseView).toHaveBeenCalledWith(CHART_VIEW_ID, expect.objectContaining({ embedded: false }));
  });
});
