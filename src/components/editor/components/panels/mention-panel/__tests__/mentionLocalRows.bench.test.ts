/**
 * MEN-WEB-15 spike: how much of a 10,000-row database the tab holds, and what the local rows lane
 * costs. Skipped unless `MENTION_ROWS_BENCH=1`. Run alone, with the garbage collector exposed for the
 * memory numbers:
 *
 *   MENTION_ROWS_BENCH=1 node --expose-gc node_modules/jest/bin/jest.js \
 *     src/components/editor/components/panels/mention-panel/__tests__/mentionLocalRows.bench.test.ts \
 *     --no-coverage --maxWorkers=1
 *
 * Each measurement prints one `MENTION_ROWS_BENCH {json}` line; `doc/MENTION_LOCAL_ROWS_SPIKE.md`
 * reports them. The row walk is the real one (`prefetchDatabaseBlobDiff`, pages of 256 rows as the
 * server sends them), with the network, IndexedDB and the outbox replaced by in-memory fakes, so its
 * times are the client's own work only. The assertions hold the facts the report relies on.
 */
import { cpus, totalmem } from 'os';

import { parse as uuidParse } from 'uuid';
import * as Y from 'yjs';

import {
  clearDatabaseRowDocSeedCache,
  getDatabaseRowDocFromSeed,
  holdsDatabaseSourceRows,
  isDatabaseSourceResident,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
} from '@/application/database-blob';
import { FieldType } from '@/application/database-yjs/database.type';
import { createDatabaseMentionRowsSource } from '@/application/database-yjs/mention-local-rows';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { openRowCollabDBWithProvider } from '@/application/db';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import {
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { database_blob } from '@/proto/database_blob';

import { mergeMentionSections } from '../mentionLocalMerge';
import { prepareMentionQuery, rankSection } from '../mentionLocalRanker';
import {
  MENTION_LOCAL_ROWS_LIMIT,
  mentionLocalRowNavKey,
  mentionLocalRowsForSections,
  MentionLocalRowsSnapshot,
  prepareMentionLocalRows,
  rankMentionLocalRows,
} from '../mentionLocalRows';

jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async (databaseId: string) => ({ databaseId, epoch: null, cacheEpoch: null })),
  rotateDatabaseStorageFence: jest.fn(),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, publish: () => void) => {
    publish();
    return true;
  }),
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  getCachedRowProvider: jest.fn(),
  hasSharedCollabData: jest.fn(async () => true),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
}));
jest.mock('@/application/services/js-services/cache', () => ({ deleteRow: jest.fn(), getCachedRowDoc: jest.fn() }));
jest.mock('@/application/services/js-services/http/http_api', () => ({ databaseBlobDiff: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn(),
  getCurrentOutboxSession: jest.fn((workspaceId: string) => ({ userId: 'user-1', workspaceId })),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const BENCH = process.env.MENTION_ROWS_BENCH === '1';
const describeBench = BENCH ? describe : describe.skip;
const mockedBlobDiff = databaseBlobDiff as jest.MockedFunction<typeof databaseBlobDiff>;
const mockedOpenRow = openRowCollabDBWithProvider as jest.MockedFunction<typeof openRowCollabDBWithProvider>;
const gc = (globalThis as { gc?: () => void }).gc;

const ROWS = 10_000;
const PAGE_ROWS = 256;
const PRIMARY = 'field-name';
const OTHER_FIELDS = ['status', 'owner', 'notes', 'due', 'tags', 'estimate'];
const WORDS = ['Road', 'trip', 'plan', 'Budget', 'Q3', 'review', 'hiring', 'launch', 'notes', 'design', '设计', '路线'];

function report(name: string, values: Record<string, unknown>) {
  process.stdout.write(`MENTION_ROWS_BENCH ${JSON.stringify({ name, ...values })}\n`);
}

function heapMb(): number | undefined {
  if (!gc) return undefined;
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1e6;
}

function percentile(samples: number[], p: number) {
  const sorted = [...samples].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function round(value: number | undefined, digits = 2) {
  return value === undefined ? undefined : Number(value.toFixed(digits));
}

function rowId(database: number, n: number) {
  return `${database.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function title(n: number) {
  return `${WORDS[n % WORDS.length]} ${WORDS[(n * 7 + 3) % WORDS.length]} ${n}`;
}

/** A row as the walk delivers it: a primary text cell and six more, created `createdAt` (Unix seconds). */
function rowDoc(id: string, databaseId: string, text: string, createdAt = 1_762_000_000) {
  const doc = new Y.Doc({ guid: id }) as YDoc;

  doc.transact(() => {
    const row = new Y.Map<unknown>();
    const cells = new Y.Map<unknown>();

    [PRIMARY, ...OTHER_FIELDS].forEach((fieldId, index) => {
      const cell = new Y.Map<unknown>();

      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      cell.set(YjsDatabaseKey.data, index === 0 ? text : `${fieldId} value ${id.slice(-6)}`);
      cells.set(fieldId, cell);
    });
    row.set(YjsDatabaseKey.id, id);
    row.set(YjsDatabaseKey.database_id, databaseId);
    row.set(YjsDatabaseKey.created_at, String(createdAt));
    row.set(YjsDatabaseKey.last_modified, String(createdAt));
    row.set(YjsDatabaseKey.cells, cells);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.meta, new Y.Map());
  });
  return doc;
}

function rowState(id: string, databaseId: string, text: string) {
  const doc = rowDoc(id, databaseId, text);
  const state = Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return state;
}

/** The database's rows as the server pages them: `PAGE_ROWS` a page, the cursor holding the next page's index. */
function servePages(databaseId: string, ids: string[]) {
  const states = ids.map((id, index) => rowState(id, databaseId, title(index)));
  const pageCount = Math.ceil(ids.length / PAGE_ROWS);
  let bytes = 0;

  states.forEach((state) => (bytes += state.length));
  mockedBlobDiff.mockImplementation(async (_workspace, requestedDatabase, request) => {
    if (requestedDatabase !== databaseId) throw new Error(`unexpected database ${requestedDatabase}`);

    const cursor = request.page?.cursor ?? new Uint8Array();
    const page = cursor.length === 0 ? 0 : (cursor[0] << 8) | cursor[1];
    const start = page * PAGE_ROWS;
    const hasMore = page + 1 < pageCount;

    return database_blob.DatabaseBlobDiffResponse.create({
      status: database_blob.DiffStatus.READY,
      creates: ids.slice(start, start + PAGE_ROWS).map((id, offset) => ({
        rowId: uuidParse(id),
        rid: { timestamp: 1_000 + start + offset, seqNo: 1 },
        docState: { docState: states[start + offset], encoderVersion: 1 },
      })),
      updates: [],
      deletes: [],
      page: {
        hasMore,
        nextCursor: hasMore ? new Uint8Array([(page + 1) >> 8, (page + 1) & 0xff]) : new Uint8Array(),
        restartRequired: false,
      },
    });
  });
  return { pageCount, seedBytes: bytes };
}

/** A database document whose inline grid lists `ids`, with the primary text field and six more. */
function databaseDoc(databaseId: string, ids: string[]) {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;

  doc.transact(() => {
    const database = new Y.Map<unknown>();
    const fields = new Y.Map<unknown>();
    const views = new Y.Map<unknown>();
    const grid = new Y.Map<unknown>();
    const rowOrders = new Y.Array<{ id: string; height: number }>();
    const metas = new Y.Map<unknown>();

    [PRIMARY, ...OTHER_FIELDS].forEach((fieldId, index) => {
      const field = new Y.Map<unknown>();

      field.set(YjsDatabaseKey.id, fieldId);
      field.set(YjsDatabaseKey.name, fieldId);
      field.set(YjsDatabaseKey.type, FieldType.RichText);
      field.set(YjsDatabaseKey.is_primary, index === 0);
      fields.set(fieldId, field);
    });
    rowOrders.push(ids.map((id) => ({ id, height: 36 })));
    grid.set(YjsDatabaseKey.row_orders, rowOrders);
    grid.set(YjsDatabaseKey.is_inline, true);
    views.set('grid', grid);
    metas.set(YjsDatabaseKey.iid, 'grid');
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    database.set(YjsDatabaseKey.metas, metas);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  });
  return doc;
}

async function walk(databaseId: string, ids: string[]) {
  const served = servePages(databaseId, ids);
  let seedsReadyMs = 0;
  let holdsAtSeedsReady = false;
  const started = performance.now();

  retainDatabaseRowDocSeedCache(databaseId);
  await prefetchDatabaseBlobDiff('workspace', databaseId, {
    onSeedsReady: () => {
      seedsReadyMs = performance.now() - started;
      holdsAtSeedsReady = holdsDatabaseSourceRows(databaseId);
    },
  });

  const readable = ids.filter((id) => peekDatabaseRowDocSeed(getRowKey(databaseId, id)) !== null).length;

  // The fakes keep every call and result; the app keeps neither.
  mockedBlobDiff.mockClear();
  mockedOpenRow.mockClear();
  return {
    ...served,
    seedsReadyMs,
    settledMs: performance.now() - started,
    holdsAtSeedsReady,
    resident: isDatabaseSourceResident(databaseId),
    readable,
  };
}

function forget(databaseId: string) {
  releaseDatabaseRowDocSeedCache(databaseId);
  clearDatabaseRowDocSeedCache(databaseId);
}

/** Builds the source's index over `doc` with slices run here, timing each. */
function buildIndex(doc: YDoc, databaseId: string, live: Map<string, YDoc>) {
  const tasks: (() => void)[] = [];
  const source = createDatabaseMentionRowsSource({
    databaseDoc: doc,
    getLiveRowDoc: (rowKey) => live.get(rowKey),
    peekRowSeed: peekDatabaseRowDocSeed,
    holdsRows: holdsDatabaseSourceRows,
    schedule: (task) => {
      tasks.push(task);
      return () => undefined;
    },
  });
  const subscribeStarted = performance.now();
  const leave = source.subscribe(() => undefined);
  const subscribeMs = performance.now() - subscribeStarted;
  const slices: number[] = [];

  while (tasks.length > 0) {
    const sliceStarted = performance.now();

    tasks.shift()?.();
    slices.push(performance.now() - sliceStarted);
  }

  const snapshot = source.getSnapshot();

  expect(snapshot.databaseId).toBe(databaseId);
  return { source, snapshot, leave, subscribeMs, slices };
}

describeBench('MEN-WEB-15 spike: the open database of 10,000 rows', () => {
  jest.setTimeout(600_000);

  const DATABASE = '0000000a-0000-4000-8000-0000000000db';
  const ids = Array.from({ length: ROWS }, (_, index) => rowId(0xa, index + 1));

  beforeAll(() => {
    mockedOpenRow.mockImplementation(
      async () =>
        ({
          doc: new Y.Doc(),
          provider: {
            destroy: jest.fn().mockResolvedValue(undefined),
            whenPersisted: jest.fn().mockResolvedValue(undefined),
          },
        } as unknown as Awaited<ReturnType<typeof openRowCollabDBWithProvider>>)
    );
    report('machine', {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: cpus()[0]?.model,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      gc: Boolean(gc),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('1. residency: a cold walk holds every row, and the database is resident once it settles', async () => {
    const heapBefore = heapMb();
    const result = await walk(DATABASE, ids);
    const heapAfter = heapMb();

    report('residency-cold-walk', {
      rows: ROWS,
      pages: result.pageCount,
      seedBytesMb: round(result.seedBytes / 1e6),
      seedsReadyMs: round(result.seedsReadyMs, 0),
      settledMs: round(result.settledMs, 0),
      holdsAtSeedsReady: result.holdsAtSeedsReady,
      resident: result.resident,
      readableSeeds: result.readable,
      heapRetainedMb: round(heapAfter !== undefined && heapBefore !== undefined ? heapAfter - heapBefore : undefined, 1),
    });
    expect(result.holdsAtSeedsReady).toBe(true);
    expect(result.resident).toBe(true);
    expect(result.readable).toBe(ROWS);
  });

  it('2. index build: titles from 10,000 seeds in idle slices, then from the kept titles, or from live rows', async () => {
    const doc = databaseDoc(DATABASE, ids);
    const heapBefore = heapMb();
    const first = buildIndex(doc, DATABASE, new Map());
    const heapAfter = heapMb();

    expect(first.snapshot.rows).toHaveLength(ROWS);
    expect(first.snapshot.complete).toBe(true);

    const sliceTotal = first.slices.reduce((sum, slice) => sum + slice, 0);

    report('index-build-from-seeds', {
      rows: first.snapshot.rows.length,
      complete: first.snapshot.complete,
      subscribeMs: round(first.subscribeMs),
      slices: first.slices.length,
      sliceTotalMs: round(sliceTotal, 0),
      sliceMaxMs: round(Math.max(...first.slices)),
      heapRetainedMb: round(heapAfter !== undefined && heapBefore !== undefined ? heapAfter - heapBefore : undefined, 1),
    });
    first.leave();

    // The next picker: every seed's title was kept with it.
    const second = buildIndex(doc, DATABASE, new Map());

    report('index-build-kept-titles', {
      rows: second.snapshot.rows.length,
      subscribeMs: round(second.subscribeMs),
      slices: second.slices.length,
      sliceTotalMs: round(second.slices.reduce((sum, slice) => sum + slice, 0)),
    });
    // No seed is decoded again: a few slices read the kept titles.
    expect(second.slices.length).toBeLessThan(first.slices.length / 10);
    expect(second.snapshot.complete).toBe(true);
    second.leave();

    // Every row open in the tab, as after scrolling the whole grid or a filtered walk opened them.
    const live = new Map(ids.map((id, index) => [getRowKey(DATABASE, id), rowDoc(id, DATABASE, title(index))]));
    const liveBuild = buildIndex(doc, DATABASE, live);

    report('index-build-from-live-rows', {
      rows: liveBuild.snapshot.rows.length,
      subscribeMs: round(liveBuild.subscribeMs),
      slices: liveBuild.slices.length,
    });
    liveBuild.leave();
    live.forEach((row) => row.destroy());

    // What reading every row through the shared seed documents (`peekRowDocFromSeed`) would keep.
    const sample = ids.slice(0, 2_000);
    const docsBefore = heapMb();
    const docs = sample.map((id) => getDatabaseRowDocFromSeed(getRowKey(DATABASE, id)));
    const docsAfter = heapMb();

    report('shared-seed-docs', {
      rows: sample.length,
      built: docs.filter(Boolean).length,
      heapMbPer10k: round(
        docsAfter !== undefined && docsBefore !== undefined
          ? ((docsAfter - docsBefore) * ROWS) / sample.length
          : undefined,
        0
      ),
    });
  });

  it('3. keystroke cost: matching 10,000 titles', () => {
    const doc = databaseDoc(DATABASE, ids);
    const { snapshot, leave } = buildIndex(doc, DATABASE, new Map());
    const queries = [
      'r',
      'ro',
      'roa',
      'road',
      'road t',
      'road trip',
      'pla',
      'budget r',
      'q3',
      'hir',
      'launch 12',
      '设计',
      '路线',
      'design 99',
      '1234',
      'zz',
      'notes 4',
      'review q',
      'trip plan',
      'x',
    ];
    const normalizeStarted = performance.now();

    prepareMentionLocalRows(snapshot);

    const normalizeMs = performance.now() - normalizeStarted;
    const nowMs = Date.now();
    const timed = (run: (query: string) => unknown, rounds: number) => {
      const samples: number[] = [];

      for (let round = 0; round < rounds; round += 1) {
        queries.forEach((query) => {
          const started = performance.now();

          run(query);
          samples.push(performance.now() - started);
        });
      }

      return samples;
    };

    const lane = (query: string) => rankMentionLocalRows({ query, snapshot, databaseViewId: 'grid', nowMs });
    const everyRow = snapshot.rows.map((row) => ({ key: mentionLocalRowNavKey(DATABASE, row.rowId), title: row.title }));
    const unfiltered = (query: string) =>
      rankSection(prepareMentionQuery(query), 'objects', everyRow, nowMs, MENTION_LOCAL_ROWS_LIMIT);

    // Warm both, then measure.
    timed(lane, 2);
    timed(unfiltered, 2);

    const laneSamples = timed(lane, 10);
    const unfilteredSamples = timed(unfiltered, 10);

    queries.forEach((query) => expect(lane(query).map((item) => item.key)).toEqual(unfiltered(query).map((c) => c.key)));
    report('keystroke-match', {
      rows: snapshot.rows.length,
      queries: queries.length,
      normalizeOnceMs: round(normalizeMs),
      laneMedianMs: round(percentile(laneSamples, 50), 3),
      laneP95Ms: round(percentile(laneSamples, 95), 3),
      laneMaxMs: round(Math.max(...laneSamples), 3),
      everyRowMedianMs: round(percentile(unfilteredSamples, 50), 3),
      everyRowP95Ms: round(percentile(unfilteredSamples, 95), 3),
      matchesFor: Object.fromEntries(['r', 'road', 'q3', 'zz'].map((query) => [query, lane(query).length])),
    });

    // The merge the picker runs per keystroke, with the views the tab holds and the matched rows.
    const views = Array.from({ length: 5_000 }, (_, index) => ({
      key: `page:${rowId(0xbbb, index)}`,
      title: title(index * 3 + 1),
      item: {
        kind: MentionTargetKind.Page,
        object_id: rowId(0xbbb, index),
        title: title(index * 3 + 1),
        mention: { type: MentionTargetKind.Page as const, page_id: rowId(0xbbb, index) },
      },
    }));
    const server: MentionSearchSection[] = [
      {
        kind: MentionSearchSectionKind.Pages,
        title: 'Pages',
        items: views.slice(0, 20).map((view) => view.item),
        has_more: false,
        status: 'ok',
      },
    ];
    // As the picker passes them: a row the server lists too, read from a seed, left to the server.
    const merge = (withRows: boolean) => (query: string) =>
      mergeMentionSections({
        request: { query, limit: 20 },
        server,
        local: withRows ? [...views, ...mentionLocalRowsForSections(lane(query), server, 20)] : views,
        nowMs,
      });

    timed(merge(true), 2);

    const mergeWithout = timed(merge(false), 5);
    const mergeWith = timed(merge(true), 5);

    report('keystroke-merge', {
      views: views.length,
      withoutRowsMedianMs: round(percentile(mergeWithout, 50), 3),
      withoutRowsP95Ms: round(percentile(mergeWithout, 95), 3),
      withRowsMedianMs: round(percentile(mergeWith, 50), 3),
      withRowsP95Ms: round(percentile(mergeWith, 95), 3),
    });
    leave();
  });

  it('5. freshness: a row created while the picker is open is listed after the transaction that adds it', async () => {
    const doc = databaseDoc(DATABASE, ids);
    const live = new Map<string, YDoc>();
    const { source, leave } = buildIndex(doc, DATABASE, live);
    const created = rowId(0xa, ROWS + 1);
    const createdDoc = rowDoc(created, DATABASE, '', Math.floor(Date.now() / 1000));
    let notified = 0;
    const stop = source.subscribe(() => (notified += 1));

    live.set(getRowKey(DATABASE, created), createdDoc);

    const addStarted = performance.now();
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    database
      .get(YjsDatabaseKey.views)
      .get('grid')
      .get(YjsDatabaseKey.row_orders)
      .push([{ id: created, height: 36 }]);

    const addMs = performance.now() - addStarted;

    await Promise.resolve();

    const listedEmpty = source.getSnapshot().rows.some((row) => row.rowId === created && row.title === '');
    const typeStarted = performance.now();
    const row = createdDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<
      Y.Map<Y.Map<unknown>>
    >;

    row.get(YjsDatabaseKey.cells)?.get(PRIMARY)?.set(YjsDatabaseKey.data, 'Zebra launch');

    const typeMs = performance.now() - typeStarted;

    await Promise.resolve();

    const snapshot: MentionLocalRowsSnapshot = source.getSnapshot();
    const found = rankMentionLocalRows({ query: 'zebra', snapshot, databaseViewId: 'grid', nowMs: Date.now() });

    report('freshness', {
      rowsBefore: ROWS,
      addRowOrderHandlerMs: round(addMs),
      listedOnceAdded: listedEmpty,
      typeTitleHandlerMs: round(typeMs, 3),
      foundByTitle: found.map((item) => item.title),
      fresh: found[0]?.changedMs !== undefined && Date.now() - found[0].changedMs <= 15 * 60_000,
      notifications: notified,
    });
    expect(listedEmpty).toBe(true);
    expect(found.map((item) => item.title)).toEqual(['Zebra launch']);
    stop();
    leave();
    createdDoc.destroy();
  });

  it('1b. residency limits: the seed lookup holds 10,000 rows across every database', async () => {
    // A 10,001-row database: the walk claims the database while a seed was dropped.
    const BIG = '0000000b-0000-4000-8000-0000000000db';
    const bigIds = Array.from({ length: ROWS + 1 }, (_, index) => rowId(0xb, index + 1));
    const big = await walk(BIG, bigIds);
    const bigIndex = buildIndex(databaseDoc(BIG, bigIds), BIG, new Map());

    report('residency-10001-rows', {
      rows: bigIds.length,
      resident: big.resident,
      readableSeeds: big.readable,
      indexRows: bigIndex.snapshot.rows.length,
      indexComplete: bigIndex.snapshot.complete,
    });
    expect(big.resident).toBe(true);
    expect(big.readable).toBe(ROWS);
    expect(bigIndex.snapshot.complete).toBe(false);
    bigIndex.leave();

    // A second database walked after the first 10,000-row one.
    const SMALL = '0000000c-0000-4000-8000-0000000000db';
    const smallIds = Array.from({ length: 1_000 }, (_, index) => rowId(0xc, index + 1));

    await walk(SMALL, smallIds);

    const firstReadable = ids.filter((id) => peekDatabaseRowDocSeed(getRowKey(DATABASE, id)) !== null).length;
    const bigReadable = bigIds.filter((id) => peekDatabaseRowDocSeed(getRowKey(BIG, id)) !== null).length;

    report('residency-second-database', {
      firstDatabaseReadableSeeds: firstReadable,
      firstDatabaseResident: isDatabaseSourceResident(DATABASE),
      bigDatabaseReadableSeeds: bigReadable,
      bigResident: isDatabaseSourceResident(BIG),
      secondDatabaseRows: smallIds.length,
    });
    forget(BIG);
    forget(SMALL);
    forget(DATABASE);
  });

  it('1c. residency after a reload: a walk of the rows changed since a cached RID holds only those', async () => {
    const RELOADED = '0000000d-0000-4000-8000-0000000000db';
    const reloadedIds = Array.from({ length: ROWS }, (_, index) => rowId(0xd, index + 1));

    localStorage.setItem(`af_database_blob_rid:${RELOADED}`, JSON.stringify({ timestamp: 50, seqNo: 1 }));

    const changed = reloadedIds.slice(0, 25);

    servePages(RELOADED, changed);
    retainDatabaseRowDocSeedCache(RELOADED);
    await prefetchDatabaseBlobDiff('workspace', RELOADED);

    // The grid renders its first 40 rows from IndexedDB: those are the live rows.
    const live = new Map(
      reloadedIds.slice(0, 40).map((id, index) => [getRowKey(RELOADED, id), rowDoc(id, RELOADED, title(index))])
    );
    const index = buildIndex(databaseDoc(RELOADED, reloadedIds), RELOADED, live);

    report('residency-after-reload', {
      rows: ROWS,
      changedRowsWalked: changed.length,
      resident: isDatabaseSourceResident(RELOADED),
      indexRows: index.snapshot.rows.length,
      indexComplete: index.snapshot.complete,
    });
    expect(isDatabaseSourceResident(RELOADED)).toBe(false);
    expect(index.snapshot.complete).toBe(false);
    index.leave();
    live.forEach((row) => row.destroy());
    forget(RELOADED);
  });
});

describe('MEN-WEB-15 spike benchmark', () => {
  it(BENCH ? 'runs the measurements above' : 'is skipped unless MENTION_ROWS_BENCH=1', () => {
    expect(typeof BENCH).toBe('boolean');
  });
});
