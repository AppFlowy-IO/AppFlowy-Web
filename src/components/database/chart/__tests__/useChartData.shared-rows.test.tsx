import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

// The loader's last resort for a row without a seed; no test here reaches a real IndexedDB.
jest.mock('@/application/db', () => ({
  openRowCollabDBWithProvider: jest.fn(async () => {
    throw new Error('record not found');
  }),
}));

// Everything is real (the context, the fields, the background loader) except
// the row orders: the selector applies filters and sorts, which this is not about.
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useRowOrdersSelector: jest.fn(),
}));

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});

import { DatabaseContext, DatabaseContextState, useRowOrdersSelector } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { UpdateFlags } from '@/application/services/js-services/sync-protocol';
import {
  Types,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YDatabaseRow,
  YDatabaseRowOrders,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';
import { toCategoryItems } from '@/components/database/chart/hooks/chartSeries';
import { useChartData } from '@/components/database/chart/hooks/useChartData';
import { SEED_WAIT_TIMEOUT_MS } from '@/components/database/chart/hooks/useChartRowHydration';
import { useSyncRefs } from '@/components/ws/sync/syncRefs';
import { useCollabMessageHandler } from '@/components/ws/sync/useCollabMessageHandler';

const DATABASE_ID = 'shared-rows-database';
const VIEW_ID = 'chart-view';
const STAGES = ['lead', 'won', 'lost'];

const SETTINGS: ChartLayoutSettings = {
  chartType: ChartType.Bar,
  xFieldId: 'Stage',
  yFieldId: 'Amount',
  showEmptyValues: true,
  aggregationType: ChartAggregationType.Sum,
  cumulative: false,
  dateCondition: DateGroupCondition.Month,
  extended: DEFAULT_CHART_EXTENDED_SETTINGS,
};

let fixtureCount = 0;

/** A database doc with a Stage select and an Amount number, and `rowIds` in its chart view. */
function createDatabase(rowIds: string[]) {
  // A doc per test: the loader keeps its store per database and view.
  const databaseDoc = new Y.Doc({ guid: `${DATABASE_ID}-${fixtureCount++}` }) as YDoc;
  const database = new Y.Map();
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, databaseDoc.guid);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  views.set(VIEW_ID, view);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));

  const stage = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  fields.set('Stage', stage);
  stage.set(YjsDatabaseKey.id, 'Stage');
  stage.set(YjsDatabaseKey.name, 'Stage');
  stage.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  stage.set(YjsDatabaseKey.type_option, typeOptions);
  typeOptions.set(String(FieldType.SingleSelect), typeOption);
  typeOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({ options: STAGES.map((id) => ({ id, name: id, color: 'Blue' })), disable_color: false })
  );

  const amount = new Y.Map() as YDatabaseField;

  fields.set('Amount', amount);
  amount.set(YjsDatabaseKey.id, 'Amount');
  amount.set(YjsDatabaseKey.name, 'Amount');
  amount.set(YjsDatabaseKey.type, FieldType.Number);

  return { databaseDoc, rowOrders };
}

/** Row `index` has stage `index % 3` and amount `index + 1`. */
function rowDoc(rowId: string, index: number, amount = index + 1) {
  return createRowDoc(rowId, DATABASE_ID, {
    Stage: createCell(FieldType.SingleSelect, STAGES[index % STAGES.length]),
    Amount: createCell(FieldType.Number, String(amount)),
  });
}

function rowIdsOf(count: number) {
  return Array.from({ length: count }, (_, index) => `row-${index}`);
}

/** Sum of the amounts per stage for rows `0..count-1`, in option order (the default sort, WP11 §1.7). */
function expectedSums(count: number, amountOf: (index: number) => number = (index) => index + 1) {
  const sums = new Map<string, number>();

  for (let index = 0; index < count; index += 1) {
    const stage = STAGES[index % STAGES.length];

    sums.set(stage, (sums.get(stage) ?? 0) + amountOf(index));
  }

  return [...sums.entries()].sort(([a], [b]) => STAGES.indexOf(a) - STAGES.indexOf(b));
}

function sums(chartData: { label: string; value: number }[]) {
  return chartData.map((item) => [item.label, item.value]);
}

/**
 * Renders `useChartData` inside a real `DatabaseContext`. `update` changes the
 * context (the row map, the seed flags) the way `Database` would.
 */
function renderChart(initial: Partial<DatabaseContextState> & Pick<DatabaseContextState, 'databaseDoc'>, rowIds: string[]) {
  let context: DatabaseContextState = {
    readOnly: false,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: {},
    workspaceId: 'workspace-id',
    ...initial,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  (useRowOrdersSelector as jest.Mock).mockReturnValue(rowIds.map((id) => ({ id })));
  const hook = renderHook(() => useChartData({ settings: SETTINGS }), { wrapper });

  return {
    ...hook,
    update: (changes: Partial<DatabaseContextState>) => {
      context = { ...context, ...changes };
      hook.rerender();
    },
    getContext: () => context,
  };
}

function renderSyncHandler() {
  const events = new EventEmitter();

  return renderHook(() => {
    const refs = useSyncRefs();
    const handler = useCollabMessageHandler(refs, undefined, undefined, events, jest.fn(), jest.fn());

    return { refs, ...handler };
  });
}

describe('useChartData over shared row docs', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('charts N seeded rows before the completed walk starts realtime binding', async () => {
    // More than one hydration batch of the loader (128 docs per frame).
    const count = 300;
    const rowIds = rowIdsOf(count);
    const seeds = Object.fromEntries(rowIds.map((rowId, index) => [rowId, rowDoc(rowId, index)]));
    const ensureRow = jest.fn(async () => undefined);
    const { databaseDoc } = createDatabase(rowIds);
    const shared = renderChart(
      {
        databaseDoc,
        ensureRow,
        peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null,
        seedsReady: true,
        blobPrefetchComplete: false,
      },
      rowIds
    );

    await waitFor(() => expect(shared.result.current.isLoading).toBe(false));
    expect(ensureRow).not.toHaveBeenCalled();
    expect(shared.result.current.loadError).toBe(false);
    expect(sums(toCategoryItems(shared.result.current.seriesData))).toEqual(expectedSums(count));
    expect(toCategoryItems(shared.result.current.seriesData).reduce((total, item) => total + item.rowIds.length, 0)).toBe(count);
    const sharedData = shared.result.current.seriesData;

    shared.unmount();

    // The path every row took before: a context without seeds opens each row with `ensureRow`.
    const live: Record<string, YDoc> = {};
    const { databaseDoc: liveDatabaseDoc } = createDatabase(rowIds);
    const ensureLiveRow = jest.fn(async (rowId: string) => {
      live[rowId] = rowDoc(rowId, rowIds.indexOf(rowId));
      return live[rowId];
    });
    const perRow = renderChart({ databaseDoc: liveDatabaseDoc, ensureRow: ensureLiveRow }, rowIds);

    await waitFor(() => expect(ensureLiveRow).toHaveBeenCalledTimes(count));
    perRow.update({ rowMap: { ...live } });
    await waitFor(() => expect(perRow.result.current.isLoading).toBe(false));
    expect(perRow.result.current.seriesData).toEqual(sharedData);
  });

  it('connects seeded chart rows in bounded batches and applies remote collab updates to their aggregates', async () => {
    const rowIds = rowIdsOf(30);
    const seeds = Object.fromEntries(rowIds.map((rowId, index) => [rowId, rowDoc(rowId, index)]));
    const live: Record<string, YDoc> = {};
    const sync = renderSyncHandler();
    let releaseSync: () => void = () => undefined;
    const syncReady = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let pending = 0;
    let maxPending = 0;
    // Model Database.ensureRow: acquire a sync context for the canonical doc;
    // the detached seed itself never receives remote transport messages.
    const ensureRow = jest.fn(async (rowId: string) => {
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      await syncReady;
      const doc = new Y.Doc({ guid: rowId }) as YDoc;

      Y.applyUpdate(doc, Y.encodeStateAsUpdate(seeds[rowId]));
      sync.result.current.refs.registeredContexts.current.set(rowId, {
        doc,
        collabType: Types.DatabaseRow,
        emit: jest.fn(),
      });
      live[rowId] = doc;
      pending -= 1;
      return doc;
    });
    const { databaseDoc } = createDatabase(rowIds);
    const chart = renderChart(
      {
        databaseDoc,
        ensureRow,
        peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null,
        seedsReady: true,
        blobPrefetchComplete: false,
      },
      rowIds
    );

    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(30));
    expect(ensureRow).not.toHaveBeenCalled();

    chart.update({ blobPrefetchComplete: true });
    await waitFor(() => expect(ensureRow).toHaveBeenCalled());
    expect(pending).toBeGreaterThan(0);
    expect(pending).toBeLessThan(rowIds.length);
    expect(chart.result.current.isLoading).toBe(false);
    await act(async () => releaseSync());
    await waitFor(() => expect(sync.result.current.refs.registeredContexts.current.size).toBe(rowIds.length));
    expect(maxPending).toBeLessThan(rowIds.length);
    expect(ensureRow).toHaveBeenCalledTimes(rowIds.length);
    // Database publishes the canonical docs in its live row map.
    chart.update({ rowMap: { ...live } });

    const remote = new Y.Doc();

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live['row-0']));
    const remoteRow = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    remoteRow.get(YjsDatabaseKey.cells).get('Amount').set(YjsDatabaseKey.data, '900');
    await act(async () => {
      await expect(sync.result.current.enqueueIncomingCollabMessage({
        objectId: 'row-0',
        collabType: Types.DatabaseRow,
        update: { flags: UpdateFlags.Lib0v1, payload: Y.encodeStateAsUpdate(remote) },
      }, { requireActiveContext: true })).resolves.toBe(true);
    });

    await waitFor(() =>
      expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(30, (index) => (index === 0 ? 900 : index + 1)))
    );
    const seededRow = seeds['row-0'].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    expect(seededRow.get(YjsDatabaseKey.cells).get('Amount').get(YjsDatabaseKey.data)).toBe('1');
    chart.unmount();
    sync.unmount();
    remote.destroy();
    Object.values(live).forEach((doc) => doc.destroy());
  });

  it('keeps its own realtime owner after another chart of the same view unmounts', async () => {
    const rowIds = ['row-0'];
    const { databaseDoc } = createDatabase(rowIds);
    const seed = rowDoc('row-0', 0);
    const live = new Y.Doc({ guid: 'row-0' }) as YDoc;
    const owners = new Set<string>();
    const sync = renderSyncHandler();

    Y.applyUpdate(live, Y.encodeStateAsUpdate(seed));
    const ensureFor = (owner: string) => jest.fn(async () => {
      owners.add(owner);
      sync.result.current.refs.registeredContexts.current.set('row-0', {
        doc: live,
        collabType: Types.DatabaseRow,
        emit: jest.fn(),
      });
      return live;
    });
    const ensureFirst = ensureFor('first');
    const ensureSecond = ensureFor('second');
    const context = {
      databaseDoc,
      peekRowDocFromSeed: () => seed,
      seedsReady: true,
      blobPrefetchComplete: true,
    };
    const first = renderChart({ ...context, ensureRow: ensureFirst }, rowIds);
    const second = renderChart({ ...context, ensureRow: ensureSecond }, rowIds);

    await waitFor(() => expect(owners).toEqual(new Set(['first', 'second'])));
    first.update({ rowMap: { 'row-0': live } });
    second.update({ rowMap: { 'row-0': live } });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    first.unmount();
    // Each Database releases its own registration when it unmounts; the
    // canonical context is removed only when no Database still owns it.
    owners.delete('first');
    if (owners.size === 0) sync.result.current.refs.registeredContexts.current.delete('row-0');

    const remote = new Y.Doc();

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(live));
    const remoteRow = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    remoteRow.get(YjsDatabaseKey.cells).get('Amount').set(YjsDatabaseKey.data, '700');
    await act(async () => {
      await expect(sync.result.current.enqueueIncomingCollabMessage({
        objectId: 'row-0',
        collabType: Types.DatabaseRow,
        update: { flags: UpdateFlags.Lib0v1, payload: Y.encodeStateAsUpdate(remote) },
      }, { requireActiveContext: true })).resolves.toBe(true);
    });
    await waitFor(() => expect(sums(toCategoryItems(second.result.current.seriesData))).toEqual([['lead', 700]]));
    expect(ensureFirst).toHaveBeenCalledTimes(1);
    expect(ensureSecond).toHaveBeenCalledTimes(1);
    second.unmount();
    sync.unmount();
    remote.destroy();
    live.destroy();
  });

  it('reacquires realtime ownership when a same-guid database document replaces its lifecycle', async () => {
    const rowIds = ['row-0'];
    const { databaseDoc } = createDatabase(rowIds);
    const seed = rowDoc('row-0', 0);
    const ensureRow = jest.fn(async () => seed);
    const chart = renderChart({
      databaseDoc,
      ensureRow,
      peekRowDocFromSeed: () => seed,
      seedsReady: true,
      blobPrefetchComplete: true,
    }, rowIds);

    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(1));
    const replacement = new Y.Doc({ guid: databaseDoc.guid }) as YDoc;
    const ensureReplacement = jest.fn(async () => seed);

    Y.applyUpdate(replacement, Y.encodeStateAsUpdate(databaseDoc));
    chart.update({ databaseDoc: replacement, ensureRow: ensureReplacement, rowMap: {} });

    await waitFor(() => expect(ensureReplacement).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual([['lead', 1]]);
    chart.unmount();
    replacement.destroy();
  });

  it('keeps reading the live doc of a row that is open in a widget', async () => {
    const rowIds = rowIdsOf(3);
    const seeds = Object.fromEntries(rowIds.map((rowId, index) => [rowId, rowDoc(rowId, index)]));
    // Row 0 is live (a grid next to the chart shows it) and was edited after the walk.
    const liveRow = rowDoc('row-0', 0, 500);
    const ensureRow = jest.fn(async () => undefined);
    const { databaseDoc } = createDatabase(rowIds);
    const { result } = renderChart(
      {
        databaseDoc,
        ensureRow,
        rowMap: { 'row-0': liveRow },
        peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null,
        seedsReady: true,
      },
      rowIds
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ensureRow).not.toHaveBeenCalled();
    expect(sums(toCategoryItems(result.current.seriesData))).toEqual(expectedSums(3, (index) => (index === 0 ? 500 : index + 1)));

    // A realtime edit of the live row reaches the chart.
    act(() => {
      const row = liveRow.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get('Amount').set(YjsDatabaseKey.data, '900');
    });
    await waitFor(() =>
      expect(sums(toCategoryItems(result.current.seriesData))).toEqual(expectedSums(3, (index) => (index === 0 ? 900 : index + 1)))
    );
  });

  it('falls back to ensureRow only for a row without a seed', async () => {
    const rowIds = rowIdsOf(4);
    // `row-3` was created after the walk: it has no seed.
    const seeds = Object.fromEntries(rowIds.slice(0, 3).map((rowId, index) => [rowId, rowDoc(rowId, index)]));
    const unseeded = rowDoc('row-3', 3);
    const { databaseDoc } = createDatabase(rowIds);
    const ensureRow = jest.fn(async (rowId: string) => (rowId === 'row-3' ? unseeded : undefined));
    const chart = renderChart(
      {
        databaseDoc,
        ensureRow,
        peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null,
        // The seeds are cached; the walk's IndexedDB writes are still running,
        // so the loader's own recovery of rows without a seed has not started.
        seedsReady: true,
        blobPrefetchComplete: false,
      },
      rowIds
    );

    await waitFor(() => expect(ensureRow).toHaveBeenCalledTimes(1));
    expect(ensureRow).toHaveBeenCalledWith('row-3');
    // `Database` adds the row it opened to the row map.
    chart.update({ rowMap: { 'row-3': unseeded } });

    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(4));
    expect(ensureRow).toHaveBeenCalledTimes(1);
  });

  it('waits for the walk instead of opening every row while the seeds are on their way', async () => {
    const rowIds = rowIdsOf(40);
    const seeds: Record<string, YDoc> = {};
    const ensureRow = jest.fn(async () => undefined);
    const { databaseDoc } = createDatabase(rowIds);
    const chart = renderChart(
      { databaseDoc, ensureRow, peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null, seedsReady: false },
      rowIds
    );

    // Long enough for a worker pool to have started.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(chart.result.current.isLoading).toBe(true);
    expect(ensureRow).not.toHaveBeenCalled();

    rowIds.forEach((rowId, index) => {
      seeds[rowId] = rowDoc(rowId, index);
    });
    chart.update({ seedsReady: true });

    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(ensureRow).not.toHaveBeenCalled();
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(40));
  });

  it('refreshes a mounted chart when the loader publishes a new row or a shared doc changes', async () => {
    const rowIds = rowIdsOf(3);
    const seeds = Object.fromEntries(rowIds.map((rowId, index) => [rowId, rowDoc(rowId, index)]));
    const ensureRow = jest.fn(async () => undefined);
    const { databaseDoc, rowOrders } = createDatabase(rowIds);
    const chart = renderChart(
      { databaseDoc, ensureRow, peekRowDocFromSeed: (rowId) => seeds[rowId] ?? null, seedsReady: true },
      rowIds
    );

    await waitFor(() => expect(chart.result.current.isLoading).toBe(false));
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(3));

    // A row the walk delivered later: the loader publishes its seed.
    seeds['row-3'] = rowDoc('row-3', 3);
    (useRowOrdersSelector as jest.Mock).mockReturnValue([...rowIds, 'row-3'].map((id) => ({ id })));
    act(() => {
      rowOrders.push([{ id: 'row-3', height: 36 }]);
    });
    chart.rerender();

    await waitFor(() => expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(4)));
    // The chart stayed mounted while the row arrived.
    expect(chart.result.current.isLoading).toBe(false);

    // The walk's next page applies a newer seed to the same shared doc.
    act(() => {
      const row = seeds['row-1'].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      row.get(YjsDatabaseKey.cells).get('Amount').set(YjsDatabaseKey.data, '70');
    });
    await waitFor(() =>
      expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(4, (index) => (index === 1 ? 70 : index + 1)))
    );
    expect(ensureRow).not.toHaveBeenCalled();
  });

  it('loads the rows one by one when the walk goes quiet, and not while it still delivers pages', async () => {
    jest.useFakeTimers();
    const rowIds = rowIdsOf(5);
    const live: Record<string, YDoc> = {};
    const { databaseDoc } = createDatabase(rowIds);
    const ensureRow = jest.fn(async (rowId: string) => {
      live[rowId] = rowDoc(rowId, rowIds.indexOf(rowId));
      return live[rowId];
    });
    let seedsRevision = 0;
    const progressListeners = new Set<() => void>();
    const chart = renderChart(
      {
        databaseDoc,
        ensureRow,
        peekRowDocFromSeed: () => null,
        seedsReady: false,
        getSeedsRevision: () => seedsRevision,
        subscribeToSeedsProgress: (listener) => {
          progressListeners.add(listener);
          return () => {
            progressListeners.delete(listener);
          };
        },
      },
      rowIds
    );
    const advance = (ms: number) =>
      act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });

    await advance(SEED_WAIT_TIMEOUT_MS - 1000);
    // A page of the walk: the wait starts over.
    act(() => {
      seedsRevision += 1;
      progressListeners.forEach((listener) => listener());
    });
    await advance(SEED_WAIT_TIMEOUT_MS - 1000);
    expect(ensureRow).not.toHaveBeenCalled();
    expect(chart.result.current.isLoading).toBe(true);

    // No page for the whole timeout: stop waiting.
    await advance(1001);
    expect(ensureRow.mock.calls.map(([rowId]) => rowId).sort()).toEqual([...rowIds].sort());
    chart.update({ rowMap: { ...live } });
    await advance(0);

    expect(chart.result.current.isLoading).toBe(false);
    expect(sums(toCategoryItems(chart.result.current.seriesData))).toEqual(expectedSums(5));
  });
});
