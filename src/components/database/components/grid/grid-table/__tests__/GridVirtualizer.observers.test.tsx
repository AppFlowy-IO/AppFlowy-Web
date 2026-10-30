// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, type GridGrouping, RowMetaKey } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { GridColumnType, type RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { GridProvider } from '@/components/database/grid/GridProvider';
import { AFConfigContext } from '@/components/main/app.hooks';

import GridVirtualizer from '../GridVirtualizer';

// Exercise the real TanStack window, row components, cell readers, metadata,
// and readiness hooks. Only jsdom's missing browser geometry is supplied.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('preact', () => jest.requireActual(require.resolve('preact').replace('preact.module.js', 'preact.js')));
jest.mock('preact/hooks', () => jest.requireActual(require.resolve('preact/hooks').replace('hooks.module.js', 'hooks.js')));
jest.mock('preact/compat', () => jest.requireActual(require.resolve('preact/compat').replace('compat.module.js', 'compat.js')));
jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => true,
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const ROW_COUNT = 5000;
const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 240;
const VIEWPORT_WIDTH = 480;
const originalResizeObserver = global.ResizeObserver;
const originalIntersectionObserver = global.IntersectionObserver;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function elementHeight(element: HTMLElement) {
  if (element.matches('[data-index], .grid-cell')) return ROW_HEIGHT;
  if (element.classList.contains('appflowy-custom-scroller')) return (ROW_COUNT + 2) * ROW_HEIGHT;
  return VIEWPORT_HEIGHT;
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  };
  global.IntersectionObserver = class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  } as unknown as typeof IntersectionObserver;

  const geometry: Record<string, PropertyDescriptor> = {
    offsetWidth: { get() { return VIEWPORT_WIDTH; } },
    clientWidth: { get() { return VIEWPORT_WIDTH; } },
    scrollWidth: { get() { return VIEWPORT_WIDTH; } },
    offsetHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    clientHeight: { get(this: HTMLElement) { return elementHeight(this); } },
    scrollHeight: { get(this: HTMLElement) {
      return this.dataset.testid === 'grid-observer-viewport'
        ? (ROW_COUNT + 2) * ROW_HEIGHT
        : elementHeight(this);
    } },
    scrollTo: { value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    } },
    scroll: { value(this: HTMLElement, options: ScrollToOptions) { this.scrollTo(options); } },
  };

  for (const [name, descriptor] of Object.entries(geometry)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  const layout = {
    getBoundingClientRect(this: HTMLElement) {
      const viewport = this.closest<HTMLElement>('[data-testid="grid-observer-viewport"]');
      const top = this.classList.contains('appflowy-custom-scroller') ? -(viewport?.scrollTop ?? 0) : 0;
      const height = elementHeight(this);

      return { x: 0, y: top, left: 0, top, width: VIEWPORT_WIDTH, height, right: VIEWPORT_WIDTH,
        bottom: top + height, toJSON: () => ({}) };
    },
  };

  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(layout.getBoundingClientRect);
});

afterEach(async () => {
  await act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.IntersectionObserver = originalIntersectionObserver;
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

function fixture() {
  const databaseDoc = new Y.Doc({ guid: 'grid-observer-database' }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const rowMap: Record<string, YDoc> = {};
  const uiTargets = new Map<Y.Map<unknown>, string>();
  const rowOrders = Array.from({ length: ROW_COUNT }, (_, index) => ({ id: `row-${index + 1}`, height: ROW_HEIGHT }));
  const columns: RenderColumn[] = [
    { fieldId: 'name', fieldType: FieldType.RichText, isPrimary: true, type: GridColumnType.Field, width: 180 },
    { fieldId: 'department', fieldType: FieldType.RichText, type: GridColumnType.Field, width: 180 },
    { fieldId: 'salary', fieldType: FieldType.Number, type: GridColumnType.Field, width: 180 },
  ];

  for (const { fieldId, fieldType, isPrimary } of columns) {
    const field = new Y.Map();

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, fieldId);
    field.set(YjsDatabaseKey.type, fieldType);
    field.set(YjsDatabaseKey.is_primary, Boolean(isPrimary));
    field.set(YjsDatabaseKey.type_option, new Y.Map());
    fields.set(fieldId as string, field);
  }

  for (const { id } of rowOrders) {
    const rowDoc = createRowDoc(id, 'grid-observer-database', {
      name: createCell(FieldType.RichText, `Name ${id}`),
      department: createCell(FieldType.RichText, 'Engineering'),
      salary: createCell(FieldType.Number, '100'),
    });
    const root = rowDoc.getMap(YjsEditorKey.data_section);
    const row = root.get(YjsEditorKey.database_row) as Y.Map<unknown>;
    const cells = row.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>;
    const meta = new Y.Map<unknown>();

    meta.set(getMetaIdMap(id).get(RowMetaKey.IsDocumentEmpty) as string, true);
    root.set(YjsEditorKey.meta, meta);
    rowMap[id] = rowDoc;
    for (const target of [root, row, cells, meta, ...cells.values()]) uiTargets.set(target, id);
    if (id === 'row-2501') root.delete(YjsEditorKey.database_row);
  }

  view.set(YjsDatabaseKey.id, 'grid-observer-view');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, new Y.Array(rowOrders));
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  views.set('grid-observer-view', view);
  database.set(YjsDatabaseKey.id, 'grid-observer-database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    readOnly: true,
    databaseDoc,
    activeViewId: 'grid-observer-view',
    databasePageId: 'grid-observer-view',
    workspaceId: 'grid-observer-workspace',
    rowMap,
    seedsReady: true,
    blobPrefetchComplete: true,
  };
  const grouping: GridGrouping = {
    rowOrders, isGrouped: false, ready: true, activeGroupIds: [], groups: [], visibleGroups: [], hideEmptyGroups: false,
  };

  return { databaseDoc, rowMap, columns, context, grouping, uiTargets };
}

function trackRowUiSubscriptions(uiTargets: Map<Y.Map<unknown>, string>) {
  const methods = [
    { spy: jest.spyOn(Y.Map.prototype, 'observe'), kind: 'shallow', add: true },
    { spy: jest.spyOn(Y.Map.prototype, 'unobserve'), kind: 'shallow', add: false },
    { spy: jest.spyOn(Y.Map.prototype, 'observeDeep'), kind: 'deep', add: true },
    { spy: jest.spyOn(Y.Map.prototype, 'unobserveDeep'), kind: 'deep', add: false },
  ] as const;

  return () => {
    const events = methods.flatMap(({ spy, kind, add }) => spy.mock.calls.map(([callback], index) => ({
      target: spy.mock.contexts[index], callback, kind, add, order: spy.mock.invocationCallOrder[index],
    }))).sort((left, right) => left.order - right.order);
    const active = new Map<Y.Map<unknown>, Record<'shallow' | 'deep', unknown[]>>();

    for (const { target, callback, kind, add } of events) {
      if (!uiTargets.has(target)) continue;
      const registrations: Record<'shallow' | 'deep', unknown[]> = active.get(target) ?? { shallow: [], deep: [] };

      // Match Yjs: duplicate registrations are allowed, while unobserve removes
      // every registration of that exact callback on this target and kind.
      // An unmatched removal cannot cancel another reader's subscription.
      if (add) registrations[kind].push(callback);
      else registrations[kind] = registrations[kind].filter((registered) => registered !== callback);
      active.set(target, registrations);
    }

    const counts = new Map<string, number>();

    for (const [target, { shallow, deep }] of active) {
      const rowId = uiTargets.get(target) as string;
      const count = shallow.length + deep.length;

      if (count) counts.set(rowId, (counts.get(rowId) ?? 0) + count);
    }

    return counts;
  };
}

test('the subscription guard retains listeners removed with the wrong target, kind or callback', () => {
  const doc = new Y.Doc();
  const target = doc.getMap('row-root');
  const otherTarget = doc.getMap('row-cells');
  const subscriptions = trackRowUiSubscriptions(new Map([[target, 'row'], [otherTarget, 'row']]));
  const callback = jest.fn();
  const otherCallback = () => undefined;

  try {
    target.observe(callback);
    const expectedYjsErrors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      otherTarget.unobserve(callback);
      target.unobserve(otherCallback);
      target.unobserveDeep(callback);
      expect(expectedYjsErrors).toHaveBeenCalledTimes(3);
      expect(expectedYjsErrors).toHaveBeenCalledWith("[yjs] Tried to remove event handler that doesn't exist.");
    } finally {
      expectedYjsErrors.mockRestore();
    }

    expect(subscriptions().get('row')).toBe(1);
    target.set('value', 'still observed');
    expect(callback).toHaveBeenCalledTimes(1);
    target.unobserve(callback);
    expect(subscriptions().size).toBe(0);
    target.observe(callback);
    target.observe(callback);
    target.observeDeep(callback);
    expect(subscriptions().get('row')).toBe(3);
    target.unobserve(callback);
    expect(subscriptions().get('row')).toBe(1);
    target.unobserveDeep(callback);
    expect(subscriptions().size).toBe(0);
  } finally {
    doc.destroy();
  }
});

test('5000 live rows keep UI observers within the real viewport and late rows read current state', async () => {
  const data = fixture();
  // Watch only row UI targets in this component harness. Database-wide data,
  // history and collaboration transport subscriptions have different owners.
  const subscriptions = trackRowUiSubscriptions(data.uiTargets);

  const rendered = render(
    <AFConfigContext.Provider value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <DatabaseContext.Provider value={data.context}>
        <div className='appflowy-scroll-container' data-testid='grid-observer-viewport'>
          <GridProvider grouping={data.grouping}><GridVirtualizer columns={data.columns} /></GridProvider>
        </div>
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
  const viewport = screen.getByTestId('grid-observer-viewport');
  const assertBounded = () => {
    const mountedIds = new Set(Array.from(viewport.querySelectorAll<HTMLElement>('[data-row-id]'))
      .map((element) => element.dataset.rowId as string));
    const active = subscriptions();

    expect(mountedIds.size).toBeGreaterThan(0);
    expect(mountedIds.size).toBeLessThan(40);
    expect(new Set(active.keys())).toEqual(mountedIds);
    // Three mounted cells plus the primary metadata/readiness readers must
    // remain a viewport cost, rather than allocate observers for all 5000 rows.
    expect([...active.values()].reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(mountedIds.size * 32);
  };

  let remainingSubscriptions = 0;

  try {
    await waitFor(() => expect(screen.getByText('Name row-1')).toBeVisible());
    expect(screen.queryByTestId('grid-row-row-2500')).not.toBeInTheDocument();
    expect(subscriptions().has('row-2500')).toBe(false);
    assertBounded();

    const rowDoc = data.rowMap['row-2500'];
    const root = rowDoc.getMap(YjsEditorKey.data_section);
    const row = root.get(YjsEditorKey.database_row) as Y.Map<unknown>;
    const cells = row.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>;
    const meta = root.get(YjsEditorKey.meta) as Y.Map<unknown>;
    const pendingRoot = data.rowMap['row-2501'].getMap(YjsEditorKey.data_section);

    expect(pendingRoot.has(YjsEditorKey.database_row)).toBe(false);
    expect(subscriptions().has('row-2501')).toBe(false);
    act(() => {
      cells.get('name')?.set(YjsDatabaseKey.data, 'Updated while offscreen');
      meta.set(getMetaIdMap('row-2500').get(RowMetaKey.IsDocumentEmpty) as string, false);
      // A different hidden row finishes loading before any UI hook mounts.
      // Its late readiness reader must see the payload, not a stale loading bit.
      const hydratedDoc = createRowDoc('row-2501', 'grid-observer-database', {
        name: createCell(FieldType.RichText, 'Loaded while offscreen'),
        department: createCell(FieldType.RichText, 'Engineering'),
        salary: createCell(FieldType.Number, '100'),
      });
      const replacement = (hydratedDoc.getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row) as Y.Map<unknown>).clone();

      pendingRoot.set(YjsEditorKey.database_row, replacement);
      data.uiTargets.set(replacement, 'row-2501');
      const replacementCells = replacement.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>;

      for (const target of [replacementCells, ...replacementCells.values()]) data.uiTargets.set(target, 'row-2501');
      hydratedDoc.destroy();
    });
    expect(subscriptions().has('row-2500')).toBe(false);
    fireEvent.scroll(viewport, { target: { scrollTop: 2500 * ROW_HEIGHT } });

    await waitFor(() => expect(screen.getByText('Updated while offscreen')).toBeVisible());
    const lateRow = screen.getByTestId('grid-row-row-2500');

    expect(within(lateRow).getByTestId('row-document-icon-row-2500')).toBeVisible();
    expect(within(lateRow).queryByTestId('primary-cell-loading-row-2500')).not.toBeInTheDocument();
    expect(screen.getByText('Loaded while offscreen')).toBeVisible();
    expect(screen.queryByTestId('primary-cell-loading-row-2501')).not.toBeInTheDocument();
    expect(screen.queryByText('Name row-1')).not.toBeInTheDocument();
    expect(subscriptions().has('row-1')).toBe(false);
    assertBounded();
  } finally {
    rendered.unmount();
    remainingSubscriptions = subscriptions().size;
    data.databaseDoc.destroy();
    Object.values(data.rowMap).forEach((row) => row.destroy());
  }

  expect(remainingSubscriptions).toBe(0);
});
