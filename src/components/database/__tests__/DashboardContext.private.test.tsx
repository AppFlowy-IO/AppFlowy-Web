import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { UIVariant, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { FILTER_INPUT_DEBOUNCE_MS } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { FilterTextValueInput } from '@/components/database/components/filters/value-controls/FilterTextValueInput';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardPrivateSummary,
} from '@/components/database/dashboard/DashboardContext';
import { useGlobalFilterActions } from '@/components/database/dashboard/global-filters/useGlobalFilterActions';
import { removePrivatePayloadsForUser } from '@/components/database/dashboard/private/private-storage';
import { PRIVATE_PERSIST_DEBOUNCE_MS } from '@/components/database/dashboard/private/usePrivatePersistence';

// The repository's manual mock runs debounce immediately, hiding unmount races.
jest.mock('lodash-es', () => jest.requireActual('lodash'));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockUser: { current: { uid: string } | undefined } = { current: { uid: '42' } };

jest.mock('@/components/main/app.hooks', () => ({
  ...jest.requireActual('@/components/main/app.hooks'),
  useCurrentUserOptional: () => mockUser.current,
}));

jest.mock('sonner', () => ({ toast: { custom: jest.fn(), dismiss: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockToast = (jest.requireMock('sonner') as { toast: { custom: jest.Mock; dismiss: jest.Mock } }).toast;

const DATABASE_ID = 'host-database';
const DASHBOARD_VIEW_ID = 'dashboard-view';
const STORAGE_KEY = `af.dashboard.private.v1:workspace-id:42:${DASHBOARD_VIEW_ID}`;
const W1 = { id: 'w1', viewId: 'grid-view', databaseId: DATABASE_ID };
const W2 = { id: 'w2', viewId: 'board-view', databaseId: DATABASE_ID };
const ROWS: DashboardRow[] = [
  {
    id: 'r1',
    height: 480,
    widgets: [
      { ...W1, width: 6 },
      { ...W2, width: 6 },
    ],
  },
];

const STATUS: DashboardGlobalFilter = {
  id: 'gf:status',
  name: 'Status',
  fieldType: FieldType.RichText,
  condition: 2,
  content: 'done',
  targets: { [DATABASE_ID]: 'status' },
};
const OWNER: DashboardGlobalFilter = { ...STATUS, id: 'gf:owner', name: 'Owner', content: '' };

function createDatabaseDoc() {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const dashboard = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  const fields = new Y.Map<Y.Map<unknown>>();
  const points = new Y.Map<unknown>();

  points.set(YjsDatabaseKey.type, FieldType.Number);
  fields.set('points', points);
  database.set(YjsDatabaseKey.fields, fields as never);
  views.set(DASHBOARD_VIEW_ID, dashboard);
  for (const id of [W1.viewId, W2.viewId]) {
    const view = new Y.Map() as YDatabaseView;

    views.set(id, view);
    view.set(YjsDatabaseKey.filters, new Y.Array() as never);
    view.set(YjsDatabaseKey.sorts, new Y.Array() as never);
  }

  doc.transact(() => updateDashboardLayoutSetting(dashboard, { rows: ROWS, globalFilters: [STATUS, OWNER] }));
  getOrCreateDatabaseHistoryManager(doc);
  return { doc, database, dashboard, view: (id: string) => views.get(id) as YDatabaseView };
}

function PrivateGlobalFilterInput() {
  const { filters, setFilterValue } = useGlobalFilterActions();
  const filter = filters.find((item) => item.id === STATUS.id) as DashboardGlobalFilter;

  return (
    <FilterTextValueInput
      content={filter.content}
      data-testid='private-global-filter-input'
      fieldId='content'
      filterId={filter.id}
      onChange={(content) => setFilterValue(filter.id, (current) => ({ ...current, content }))}
    />
  );
}

function renderDashboard(
  doc: YDoc,
  { readOnly = false, variant, input = false }: { readOnly?: boolean; variant?: UIVariant; input?: boolean } = {}
) {
  let activeViewId = DASHBOARD_VIEW_ID;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: DatabaseContextState = {
      readOnly,
      databaseDoc: doc,
      databasePageId: DASHBOARD_VIEW_ID,
      activeViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      variant,
    };

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider>
          {children}
          {input && <PrivateGlobalFilterInput key={activeViewId} />}
        </DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  const rendered = renderHook(
    () => ({ ...useDashboardContext(), ...useDashboardFilters(), summary: useDashboardPrivateSummary() }),
    { wrapper }
  );

  return {
    ...rendered,
    switchDashboard: (viewId: string) => {
      activeViewId = viewId;
      rendered.rerender();
    },
  };
}

type Result = ReturnType<typeof renderDashboard>['result'];

function privateSort(result: Result, view: YDatabaseView, widget = W1) {
  const overlay = result.current.getViewOverlay(widget, view) as YDatabaseView;

  act(() => {
    (overlay.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([
      { id: `${widget.id}-sort`, field_id: 'points', condition: 1 },
    ]);
  });
  return overlay;
}

function stored() {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  window.localStorage.clear();
  mockUser.current = { uid: '42' };
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DashboardProvider private state (WP07)', () => {
  it('View-mode value edits are private and pruned when equal', () => {
    const { doc, database } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    expect(result.current.effectiveGlobalFilters[0].content).toBe('todo');
    expect(result.current.summary).toMatchObject({ hasChanges: true, canSave: true, dirtyGlobalCount: 1 });
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[0].content).toBe('done');

    // Back to the saved value: nothing is private any more.
    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'done' }));
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.summary.hasChanges).toBe(false);
  });

  it('Edit mode shows saved values and no dirty ids, and private values return after Done', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    privateSort(result, view(W1.viewId));
    act(() => result.current.setEditing(true));
    expect(result.current.effectiveGlobalFilters[0].content).toBe('done');
    expect(result.current.dirtyGlobalFilterIds.size).toBe(0);
    expect(result.current.summary.hasChanges).toBe(false);
    // Kept, not lost.
    expect(result.current.privateGlobalValues[STATUS.id]).toBeDefined();

    act(() => result.current.setEditing(false));
    expect(result.current.effectiveGlobalFilters[0].content).toBe('todo');
    expect(result.current.summary).toMatchObject({ hasChanges: true, dirtyGlobalCount: 1, dirtyWidgetCount: 1 });
  });

  it('a concurrent saved change equal to the private value drops it', () => {
    const { doc, dashboard } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    act(() => {
      doc.transact(() =>
        updateDashboardLayoutSetting(dashboard, { globalFilters: [{ ...STATUS, content: 'todo' }, OWNER] })
      );
    });
    expect(result.current.privateGlobalValues).toEqual({});
  });

  it('a deleted global filter drops its private value', () => {
    const { doc } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(OWNER.id, { condition: 2, content: 'ana' }));
    act(() => result.current.updateSetting({ globalFilters: [STATUS] }));
    expect(result.current.privateGlobalValues).toEqual({});
  });

  it('saveForEveryone(all) merges values into the latest saved list and commits writable widgets in one group', () => {
    const { doc, database, dashboard, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);
    const history = getOrCreateDatabaseHistoryManager(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    privateSort(result, view(W1.viewId), W1);
    privateSort(result, view(W2.viewId), W2);
    act(() => {
      result.current.setViewOverlayWritable(W1, true);
      result.current.setViewOverlayWritable(W2, false);
    });
    // A collaborator renames the other filter meanwhile: the save merges, key by key.
    act(() => {
      doc.transact(() =>
        updateDashboardLayoutSetting(dashboard, { globalFilters: [STATUS, { ...OWNER, name: 'Assignee' }] })
      );
    });

    let group: object | null = null;

    act(() => {
      group = result.current.saveForEveryone();
    });

    const saved = readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters;

    expect(saved.map((filter) => [filter.name, filter.content])).toEqual([
      ['Status', 'todo'],
      ['Assignee', ''],
    ]);
    expect(view(W1.viewId).get(YjsDatabaseKey.sorts).length).toBe(1);
    expect(view(W2.viewId).get(YjsDatabaseKey.sorts).length).toBe(0);
    expect(group).not.toBeNull();
    expect(history.latestUndoGroup()).toBe(group);
    expect(mockToast.custom).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ duration: 5000 }));
    // The read-only widget stays private.
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.summary).toMatchObject({ hasChanges: true, dirtyWidgetCount: 1, savableWidgetCount: 0 });

    // One step undoes everything that was saved.
    act(() => {
      expect(history.undoIfLatest(group as unknown as object)).toBe(true);
    });
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[0].content).toBe('done');
    expect(view(W1.viewId).get(YjsDatabaseKey.sorts).length).toBe(0);
  });

  it('saveForEveryone({widget}) commits only that widget', () => {
    const { doc, database, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    privateSort(result, view(W1.viewId), W1);
    privateSort(result, view(W2.viewId), W2);
    act(() => {
      result.current.setViewOverlayWritable(W1, true);
      result.current.setViewOverlayWritable(W2, true);
    });
    act(() => {
      result.current.saveForEveryone({ widget: W1 });
    });

    expect(view(W1.viewId).get(YjsDatabaseKey.sorts).length).toBe(1);
    expect(view(W2.viewId).get(YjsDatabaseKey.sorts).length).toBe(0);
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[0].content).toBe('done');
    expect(result.current.privateGlobalValues[STATUS.id]).toBeDefined();
  });

  it('readers cannot save for everyone', () => {
    const { doc, database } = createDatabaseDoc();
    const { result } = renderDashboard(doc, { readOnly: true });

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    expect(result.current.summary).toMatchObject({ hasChanges: true, canSave: false });
    act(() => {
      expect(result.current.saveForEveryone()).toBeNull();
    });
    expect(readDashboardLayoutSetting(database, DASHBOARD_VIEW_ID).globalFilters[0].content).toBe('done');
  });

  it('resetPrivateChanges({widget}) keeps other widgets and global values', () => {
    const { doc, view } = createDatabaseDoc();
    const { result } = renderDashboard(doc);

    act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
    const first = privateSort(result, view(W1.viewId), W1);
    const second = privateSort(result, view(W2.viewId), W2);

    act(() => result.current.resetPrivateChanges({ widget: W1 }));
    expect(first.get(YjsDatabaseKey.sorts).length).toBe(0);
    expect(second.get(YjsDatabaseKey.sorts).length).toBe(1);
    expect(result.current.privateGlobalValues[STATUS.id]).toBeDefined();

    act(() => result.current.resetPrivateChanges());
    expect(second.get(YjsDatabaseKey.sorts).length).toBe(0);
    expect(result.current.privateGlobalValues).toEqual({});
    expect(result.current.summary.hasChanges).toBe(false);
  });

  describe('persistence', () => {
    it('restores global values and widget parts from this device', () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          saved_at: 1,
          global_filters: {
            [STATUS.id]: { condition: 2, content: 'todo' },
            'gf:deleted': { condition: 0, content: 'x' },
          },
          widgets: {
            [W1.viewId]: {
              sorts: [
                { id: 's1', field_id: 'points', condition: 1 },
                { id: 's2', field_id: 'gone', condition: 0 },
              ],
            },
          },
        })
      );
      const { doc, view } = createDatabaseDoc();
      const { result } = renderDashboard(doc);

      expect(result.current.privateGlobalValues).toEqual({ [STATUS.id]: { condition: 2, content: 'todo' } });
      // The sort on a field the source no longer has is dropped; the other one is restored.
      expect(result.current.getViewOverlay(W1, view(W1.viewId))?.get(YjsDatabaseKey.sorts).toJSON()).toEqual([
        { id: 's1', field_id: 'points', condition: 1 },
      ]);
    });

    it('debounces writes by 300ms, flushes on reset and save, and removes the key when clean', () => {
      jest.useFakeTimers();
      const { doc } = createDatabaseDoc();
      const { result } = renderDashboard(doc);

      act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
      expect(stored()).toBeNull();
      act(() => {
        jest.advanceTimersByTime(PRIVATE_PERSIST_DEBOUNCE_MS - 1);
      });
      expect(stored()).toBeNull();
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(stored()).toMatchObject({ v: 1, global_filters: { [STATUS.id]: { condition: 2, content: 'todo' } } });

      // Reset writes at once, and nothing left removes the key.
      act(() => result.current.resetPrivateChanges());
      expect(stored()).toBeNull();

      act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'again' }));
      act(() => {
        result.current.saveForEveryone();
      });
      expect(stored()).toBeNull();
    });

    it('discards corrupt JSON and another version', () => {
      for (const raw of ['{not json', JSON.stringify({ v: 2, global_filters: {}, widgets: {} })]) {
        window.localStorage.setItem(STORAGE_KEY, raw);
        const { doc } = createDatabaseDoc();
        const { result, unmount } = renderDashboard(doc);

        expect(result.current.privateGlobalValues).toEqual({});
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        unmount();
      }
    });

    it('writes a pending change on unmount', () => {
      jest.useFakeTimers();
      const { doc } = createDatabaseDoc();
      const { result, unmount } = renderDashboard(doc);

      act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
      unmount();
      expect(stored()).toMatchObject({ global_filters: { [STATUS.id]: { content: 'todo' } } });
    });

    it('keeps a pending text edit when navigation unmounts the dashboard before the input debounce', async () => {
      jest.useFakeTimers();
      const { doc } = createDatabaseDoc();
      const { result, unmount } = renderDashboard(doc, { input: true });

      fireEvent.change(screen.getByTestId('private-global-filter-input'), { target: { value: 'todo' } });
      act(() => {
        jest.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS - 1);
      });
      expect(result.current.effectiveGlobalFilters[0].content).toBe(STATUS.content);
      expect(stored()).toBeNull();

      await act(async () => unmount());

      expect(stored()).toMatchObject({ global_filters: { [STATUS.id]: { content: 'todo' } } });
      const reopened = renderDashboard(doc);

      expect(reopened.result.current.effectiveGlobalFilters[0].content).toBe('todo');
      reopened.unmount();
    });

    it('flushes a pending input to its own dashboard when switching dashboard tabs', async () => {
      jest.useFakeTimers();
      const { doc, database } = createDatabaseDoc();
      const secondViewId = 'second-dashboard-view';
      const secondDashboard = new Y.Map() as YDatabaseView;

      database.get(YjsDatabaseKey.views).set(secondViewId, secondDashboard);
      updateDashboardLayoutSetting(secondDashboard, {
        rows: ROWS,
        globalFilters: [{ ...STATUS, content: 'second saved value' }],
      });
      const { result, switchDashboard, unmount } = renderDashboard(doc, { input: true });

      fireEvent.change(screen.getByTestId('private-global-filter-input'), { target: { value: 'first private value' } });
      expect(result.current.effectiveGlobalFilters[0].content).toBe(STATUS.content);

      await act(async () => switchDashboard(secondViewId));

      expect(stored()).toMatchObject({ global_filters: { [STATUS.id]: { content: 'first private value' } } });
      expect(result.current.effectiveGlobalFilters[0].content).toBe('second saved value');
      expect(window.localStorage.getItem(`af.dashboard.private.v1:workspace-id:42:${secondViewId}`)).toBeNull();

      await act(async () => switchDashboard(DASHBOARD_VIEW_ID));

      expect(result.current.effectiveGlobalFilters[0].content).toBe('first private value');
      unmount();
    });

    it('does not recreate signed-out private state when navigation flushes a pending write', async () => {
      jest.useFakeTimers();
      const { doc } = createDatabaseDoc();
      const { result, unmount } = renderDashboard(doc, { input: true });

      fireEvent.change(screen.getByTestId('private-global-filter-input'), { target: { value: 'todo' } });
      act(() => {
        jest.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS);
      });
      expect(result.current.effectiveGlobalFilters[0].content).toBe('todo');
      expect(stored()).toBeNull();

      const otherUserKey = STORAGE_KEY.replace(':42:', ':77:');
      const otherUserPayload = JSON.stringify({
        v: 1,
        saved_at: 1,
        global_filters: { [STATUS.id]: { condition: 2, content: 'another user' } },
        widgets: {},
      });

      window.localStorage.setItem(otherUserKey, otherUserPayload);

      // The explicit sign-out (`signOutCurrentUser`) clears this user's data before it navigates away.
      removePrivatePayloadsForUser(mockUser.current?.uid);
      await act(async () => unmount());
      expect(stored()).toBeNull();
      act(() => {
        jest.advanceTimersByTime(PRIVATE_PERSIST_DEBOUNCE_MS);
      });
      expect(stored()).toBeNull();
      expect(window.localStorage.getItem(otherUserKey)).toBe(otherUserPayload);

      // Signing in again creates a fresh writer for the same user and dashboard.
      const reopened = renderDashboard(doc);

      act(() => reopened.result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'after sign-in' }));
      act(() => {
        jest.advanceTimersByTime(PRIVATE_PERSIST_DEBOUNCE_MS);
      });
      expect(stored()).toMatchObject({ global_filters: { [STATUS.id]: { content: 'after sign-in' } } });
      reopened.unmount();
    });

    it('does nothing without a user or in publish', () => {
      jest.useFakeTimers();
      for (const setup of [() => (mockUser.current = undefined), () => undefined]) {
        setup();
        const { doc } = createDatabaseDoc();
        const { result, unmount } = renderDashboard(doc, {
          variant: mockUser.current ? UIVariant.Publish : undefined,
        });

        act(() => result.current.setPrivateGlobalValue(STATUS.id, { condition: 2, content: 'todo' }));
        act(() => {
          jest.advanceTimersByTime(PRIVATE_PERSIST_DEBOUNCE_MS * 2);
        });
        unmount();
        expect(window.localStorage.length).toBe(0);
        mockUser.current = { uid: '42' };
      }
    });
  });
});
