import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  createDatabaseMentionRowsSource,
  DatabaseMentionRowsOptions,
  MENTION_ROWS_PUBLISH_INTERVAL_MS,
  MentionRowSeed,
} from '@/application/database-yjs/mention-local-rows';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';

// The real decoder, counted: a seed decoded once is never decoded again.
jest.mock('@/application/ydoc/apply', () => {
  const actual = jest.requireActual('@/application/ydoc/apply');

  return { applyYDoc: jest.fn(actual.applyYDoc) };
});

const mockedApplyYDoc = applyYDoc as jest.MockedFunction<typeof applyYDoc>;

const DATABASE = '00000000-0000-4000-8000-0000000000db';
const NAME = 'field-name';
const NOTES = 'field-notes';

function rowId(n: number) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function textField(id: string, primary: boolean) {
  const field = new Y.Map<unknown>();

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.is_primary, primary);
  return field;
}

/** A database document with a primary text field, a second one, and an inline grid listing `rowIds`. */
function databaseDoc(rowIds: string[]) {
  const doc = new Y.Doc({ guid: DATABASE }) as YDoc;

  doc.transact(() => {
    const database = new Y.Map<unknown>();
    const fields = new Y.Map<unknown>();
    const views = new Y.Map<unknown>();
    const grid = new Y.Map<unknown>();
    const rowOrders = new Y.Array<{ id: string; height: number }>();
    const metas = new Y.Map<unknown>();

    fields.set(NAME, textField(NAME, true));
    fields.set(NOTES, textField(NOTES, false));
    rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
    grid.set(YjsDatabaseKey.row_orders, rowOrders);
    grid.set(YjsDatabaseKey.is_inline, true);
    views.set('grid', grid);
    metas.set(YjsDatabaseKey.iid, 'grid');
    database.set(YjsDatabaseKey.id, DATABASE);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    database.set(YjsDatabaseKey.metas, metas);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  });
  return doc;
}

function databaseOf(doc: YDoc) {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

function rowOrdersOf(doc: YDoc) {
  return databaseOf(doc).get(YjsDatabaseKey.views).get('grid').get(YjsDatabaseKey.row_orders);
}

/** A row document with `title` in the primary field, as the row walk and the row cache hold it. */
function rowDoc(id: string, title: string, createdAt = '1762862400', notes = 'notes') {
  const doc = new Y.Doc({ guid: id }) as YDoc;

  doc.transact(() => {
    const row = new Y.Map<unknown>();
    const cells = new Y.Map<unknown>();
    const nameCell = new Y.Map<unknown>();
    const notesCell = new Y.Map<unknown>();

    nameCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    nameCell.set(YjsDatabaseKey.data, title);
    notesCell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    notesCell.set(YjsDatabaseKey.data, notes);
    cells.set(NAME, nameCell);
    cells.set(NOTES, notesCell);
    row.set(YjsDatabaseKey.id, id);
    row.set(YjsDatabaseKey.database_id, DATABASE);
    row.set(YjsDatabaseKey.created_at, createdAt);
    row.set(YjsDatabaseKey.cells, cells);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
  });
  return doc;
}

function seedOf(id: string, title: string, createdAt?: string): MentionRowSeed {
  const doc = rowDoc(id, title, createdAt);
  const seed = { bytes: Y.encodeStateAsUpdate(doc), encoderVersion: 1 };

  doc.destroy();
  return seed;
}

function setTitle(doc: YDoc, title: string) {
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<Y.Map<Y.Map<unknown>>>;

  row.get(YjsDatabaseKey.cells)?.get(NAME)?.set(YjsDatabaseKey.data, title);
}

/** The source over `doc` with the tab's live rows, seeds and residency under the test's control. */
function harness(doc: YDoc, options: Partial<DatabaseMentionRowsOptions> = {}) {
  const live = new Map<string, YDoc>();
  const seeds = new Map<string, MentionRowSeed>();
  const residency = new Set<() => void>();
  const tasks: (() => void)[] = [];
  const state = { holds: true, clock: 0 };
  const getLiveRowDoc = jest.fn((rowKey: string) => live.get(rowKey));
  const peekRowSeed = jest.fn((rowKey: string) => seeds.get(rowKey) ?? null);
  const source = createDatabaseMentionRowsSource({
    databaseDoc: doc,
    getLiveRowDoc,
    peekRowSeed,
    holdsRows: (databaseId) => state.holds && databaseId === DATABASE,
    subscribeToResidency: (listener) => {
      residency.add(listener);
      return () => residency.delete(listener);
    },
    schedule: (task) => {
      tasks.push(task);
      return () => tasks.splice(tasks.indexOf(task) >>> 0, 1);
    },
    now: () => state.clock,
    ...options,
  });
  const onChange = jest.fn();

  return {
    source,
    live,
    seeds,
    residency,
    tasks,
    state,
    getLiveRowDoc,
    peekRowSeed,
    onChange,
    open: (id: string, title: string, createdAt?: string) => {
      const row = rowDoc(id, title, createdAt);

      live.set(getRowKey(DATABASE, id), row);
      return row;
    },
    seed: (id: string, title: string, createdAt?: string) =>
      seeds.set(getRowKey(DATABASE, id), seedOf(id, title, createdAt)),
    subscribe: () => source.subscribe(onChange),
    /** Runs the slices queued so far, and those they queue, until none is left. */
    runSlices: () => {
      for (let guard = 0; tasks.length > 0 && guard < 1_000; guard += 1) tasks.shift()?.();
    },
    titles: () => source.getSnapshot().rows.map((row) => row.title),
  };
}

async function microtasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('database mention rows source (MEN-WEB-15)', () => {
  const ids = [rowId(1), rowId(2), rowId(3)];

  it('reads nothing until a picker subscribes, and lists nothing', () => {
    const test = harness(databaseDoc(ids));

    test.open(ids[0], 'Road trip');
    expect(test.source.getSnapshot()).toEqual({ databaseId: DATABASE, rows: [], complete: false });
    test.source.refresh();
    expect(test.getLiveRowDoc).not.toHaveBeenCalled();
    expect(test.peekRowSeed).not.toHaveBeenCalled();
  });

  it('reads open rows at once and seed rows in a slice, and is complete once every row has a title', () => {
    const test = harness(databaseDoc(ids));

    test.open(ids[0], 'Road trip', '1762862400');
    test.seed(ids[1], 'Budget review');
    test.seed(ids[2], 'Hiring plan');
    test.subscribe();

    expect(test.titles()).toEqual(['Road trip']);
    expect(test.source.getSnapshot().complete).toBe(false);
    expect(test.tasks).toHaveLength(1);

    test.runSlices();
    expect(test.titles().sort()).toEqual(['Budget review', 'Hiring plan', 'Road trip']);
    expect(test.source.getSnapshot()).toMatchObject({ databaseId: DATABASE, complete: true });
    expect(test.source.getSnapshot().rows.find((row) => row.rowId === ids[0])?.createdAtMs).toBe(1762862400 * 1000);
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });

  it('is not complete while a row has neither a live document nor a seed, as while a walk is in flight', () => {
    const test = harness(databaseDoc(ids));

    test.open(ids[0], 'Road trip');
    test.seed(ids[1], 'Budget review');
    test.subscribe();
    test.runSlices();

    expect(test.titles().sort()).toEqual(['Budget review', 'Road trip']);
    expect(test.source.getSnapshot().complete).toBe(false);
  });

  it('is complete only while the tab holds every row of the database, and hears when it starts to', async () => {
    const test = harness(databaseDoc(ids));

    ids.forEach((id, index) => test.open(id, `Row ${index}`));
    test.state.holds = false;
    test.subscribe();
    expect(test.titles()).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(test.source.getSnapshot().complete).toBe(false);

    test.state.holds = true;
    test.residency.forEach((listener) => listener());
    await microtasks();
    expect(test.source.getSnapshot().complete).toBe(true);
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });

  it('looks again on refresh: a row the walk seeded since, or a row the view opened since', async () => {
    const test = harness(databaseDoc(ids));

    test.open(ids[0], 'Road trip');
    test.subscribe();
    expect(test.titles()).toEqual(['Road trip']);

    test.seed(ids[1], 'Budget review');
    const opened = test.open(ids[2], 'Hiring plan');

    test.source.refresh();
    await microtasks();
    test.runSlices();
    expect(test.titles().sort()).toEqual(['Budget review', 'Hiring plan', 'Road trip']);
    expect(test.source.getSnapshot().complete).toBe(true);

    // The row read on refresh is observed like the others.
    setTitle(opened, 'Hiring plan 2027');
    await microtasks();
    expect(test.titles()).toContain('Hiring plan 2027');
  });

  it('stays complete while a refresh reads the seeds of rows that have a title again', async () => {
    const test = harness(databaseDoc(ids));

    ids.forEach((id, index) => test.seed(id, `Row ${index}`));
    test.subscribe();
    test.runSlices();
    expect(test.source.getSnapshot().complete).toBe(true);

    // Another database became resident: every listener looks again, which queues the seed rows.
    test.residency.forEach((listener) => listener());
    await microtasks();
    expect(test.tasks).toHaveLength(1);
    expect(test.source.getSnapshot().complete).toBe(true);
    test.runSlices();
    expect(test.source.getSnapshot().complete).toBe(true);
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });

  it('lists a row created while the picker is open as soon as its row order is added', async () => {
    const doc = databaseDoc(ids.slice(0, 2));
    const test = harness(doc);

    test.open(ids[0], 'Road trip');
    test.open(ids[1], 'Budget review');
    test.subscribe();

    // The created row's document is in the row cache before its row order reaches the database.
    test.open(ids[2], 'Zebra launch', String(Math.floor(Date.now() / 1000)));
    rowOrdersOf(doc).push([{ id: ids[2], height: 36 }]);
    await microtasks();

    expect(test.titles()).toEqual(['Road trip', 'Budget review', 'Zebra launch']);
    expect(test.source.getSnapshot().complete).toBe(true);
  });

  it('shows a title as it is typed into an open row, and keeps the other rows as they were', async () => {
    const test = harness(databaseDoc(ids));
    const first = test.open(ids[0], '');

    test.open(ids[1], 'Budget review');
    test.open(ids[2], 'Hiring plan');
    test.subscribe();

    const before = test.source.getSnapshot();

    setTitle(first, 'Z');
    setTitle(first, 'Ze');
    setTitle(first, 'Zebra');
    await microtasks();

    const after = test.source.getSnapshot();

    expect(test.titles()).toEqual(['Zebra', 'Budget review', 'Hiring plan']);
    expect(after.rows[1]).toBe(before.rows[1]);
    expect(after.rows[2]).toBe(before.rows[2]);
    // The three edits of one task publish once.
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores an edit of another cell of an open row', async () => {
    const test = harness(databaseDoc(ids));
    const first = test.open(ids[0], 'Road trip');

    test.open(ids[1], 'Budget review');
    test.open(ids[2], 'Hiring plan');
    test.subscribe();

    const row = first.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<Y.Map<Y.Map<unknown>>>;

    row.get(YjsDatabaseKey.cells)?.get(NOTES)?.set(YjsDatabaseKey.data, 'changed');
    await microtasks();
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it('drops a deleted row', async () => {
    const doc = databaseDoc(ids);
    const test = harness(doc);

    ids.forEach((id, index) => test.open(id, `Row ${index}`));
    test.subscribe();
    rowOrdersOf(doc).delete(1, 1);
    await microtasks();

    expect(test.titles()).toEqual(['Row 0', 'Row 2']);
  });

  it('reads no title again when the primary field is renamed or its icon changes', async () => {
    const doc = databaseDoc(ids);
    const test = harness(doc);

    ids.forEach((id, index) => test.seed(id, `Row ${index}`));
    test.subscribe();
    test.runSlices();

    const before = test.source.getSnapshot();

    expect(before.complete).toBe(true);
    expect(test.onChange).toHaveBeenCalledTimes(1);

    // As `useUpdatePropertyNameDispatch` and `useUpdatePropertyIconDispatch` write them.
    doc.transact(() => {
      const field = databaseOf(doc).get(YjsDatabaseKey.fields).get(NAME);

      field.set(YjsDatabaseKey.last_modified, '1762862500');
      field.set(YjsDatabaseKey.name, 'Task');
    });
    doc.transact(() => {
      const field = databaseOf(doc).get(YjsDatabaseKey.fields).get(NAME);

      field.set(YjsDatabaseKey.last_modified, '1762862600');
      field.set(YjsDatabaseKey.icon, 'emoji:🚀');
    });
    await microtasks();

    expect(test.tasks).toHaveLength(0);
    expect(test.source.getSnapshot()).toBe(before);
    expect(test.onChange).toHaveBeenCalledTimes(1);
  });

  it("reads every title again when the primary field's type options change", async () => {
    const doc = databaseDoc(ids);
    const test = harness(doc);

    ids.forEach((id, index) => test.seed(id, `Row ${index}`));
    test.subscribe();
    test.runSlices();
    mockedApplyYDoc.mockClear();

    doc.transact(() => {
      const typeOptions = new Y.Map<unknown>();
      const richText = new Y.Map<unknown>();

      richText.set(YjsDatabaseKey.content, 'changed');
      typeOptions.set(String(FieldType.RichText), richText);
      databaseOf(doc).get(YjsDatabaseKey.fields).get(NAME).set(YjsDatabaseKey.type_option, typeOptions);
    });
    await microtasks();
    test.runSlices();

    // Each seed is decoded again: its kept title was read with the options before.
    expect(mockedApplyYDoc).toHaveBeenCalledTimes(3);
    expect(test.titles().sort()).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(test.source.getSnapshot().complete).toBe(true);
  });

  it('says where each title came from, and hears when a live document starts to sync', async () => {
    const synced = new Set([ids[0]]);
    const test = harness(databaseDoc(ids), { isRowDocSynced: (rowDocId) => synced.has(rowDocId) });

    test.open(ids[0], 'Road trip');
    test.open(ids[1], 'Budget review');
    test.seed(ids[2], 'Hiring plan');
    test.subscribe();
    test.runSlices();

    const syncedOf = () => Object.fromEntries(test.source.getSnapshot().rows.map((row) => [row.title, row.synced]));

    expect(syncedOf()).toEqual({ 'Road trip': true, 'Budget review': false, 'Hiring plan': false });

    // A refresh with nothing changed keeps the snapshot.
    const before = test.source.getSnapshot();

    test.source.refresh();
    await microtasks();
    test.runSlices();
    expect(test.source.getSnapshot()).toBe(before);

    // The view registered the row's sync since: the next look reads it as synced.
    synced.add(ids[1]);
    test.source.refresh();
    await microtasks();
    test.runSlices();
    expect(syncedOf()).toEqual({ 'Road trip': true, 'Budget review': true, 'Hiring plan': false });
  });

  it('follows the document the row cache holds now when it replaces the synced one it read', async () => {
    // Every live document reads as synced: the sync binding is keyed by the row id, which the old
    // and the new document share.
    const test = harness(databaseDoc(ids), { isRowDocSynced: () => true });
    const old = test.open(ids[0], 'Budget review');

    test.open(ids[1], 'Road trip');
    test.open(ids[2], 'Hiring plan');
    test.subscribe();
    expect(test.titles()).toEqual(['Budget review', 'Road trip', 'Hiring plan']);

    // A version reset or a restore caches another document under the row's id (a reset also
    // destroys the old one), and the view's row map takes it, so the editor tells the source.
    const replacement = test.open(ids[0], 'Budget review Q3');

    test.source.refresh();
    await microtasks();
    expect(test.titles()).toEqual(['Budget review Q3', 'Road trip', 'Hiring plan']);
    expect(test.source.getSnapshot().rows[0].synced).toBe(true);
    expect(test.onChange).toHaveBeenCalledTimes(1);

    // The new document is observed, and the old one no longer is.
    setTitle(old, 'Budget review (old copy)');
    await microtasks();
    expect(test.titles()).toEqual(['Budget review Q3', 'Road trip', 'Hiring plan']);
    expect(test.onChange).toHaveBeenCalledTimes(1);
    setTitle(replacement, 'Budget review Q4');
    await microtasks();
    expect(test.titles()).toEqual(['Budget review Q4', 'Road trip', 'Hiring plan']);
    expect(test.onChange).toHaveBeenCalledTimes(2);

    // A refresh with the same documents cached keeps the snapshot.
    const before = test.source.getSnapshot();

    test.source.refresh();
    await microtasks();
    expect(test.source.getSnapshot()).toBe(before);
    expect(test.onChange).toHaveBeenCalledTimes(2);
  });

  it('reads every title again when another field becomes the primary one', async () => {
    const doc = databaseDoc(ids);
    const test = harness(doc);

    ids.forEach((id, index) => test.open(id, `Row ${index}`));
    test.subscribe();
    doc.transact(() => {
      const fields = databaseOf(doc).get(YjsDatabaseKey.fields);

      fields.get(NAME).set(YjsDatabaseKey.is_primary, false);
      fields.get(NOTES).set(YjsDatabaseKey.is_primary, true);
    });
    await microtasks();

    expect(test.titles()).toEqual(['notes', 'notes', 'notes']);
  });

  it('decodes a seed once: the next picker reads its kept title in one slice, a new seed is decoded again', async () => {
    const test = harness(databaseDoc(ids));

    ids.forEach((id, index) => test.seed(id, `Row ${index}`));
    mockedApplyYDoc.mockClear();

    const leave = test.subscribe();

    test.runSlices();
    expect(test.source.getSnapshot().complete).toBe(true);
    expect(mockedApplyYDoc).toHaveBeenCalledTimes(3);
    leave();

    // Seeds are read in a slice, off the subscribe: their kept titles need no decoding.
    test.subscribe();
    expect(test.titles()).toEqual([]);
    expect(test.tasks).toHaveLength(1);
    test.runSlices();
    expect(test.titles().sort()).toEqual(['Row 0', 'Row 1', 'Row 2']);
    expect(test.source.getSnapshot().complete).toBe(true);
    expect(mockedApplyYDoc).toHaveBeenCalledTimes(3);

    // A later walk committed a new seed for a row: it is decoded on the next look.
    test.seed(ids[0], 'Row 0 renamed');
    test.source.refresh();
    await microtasks();
    expect(test.tasks).toHaveLength(1);
    test.runSlices();
    expect(test.titles().sort()).toEqual(['Row 0 renamed', 'Row 1', 'Row 2']);
    expect(mockedApplyYDoc).toHaveBeenCalledTimes(4);
  });

  it('yields between slices, and publishes at most every 100 ms until the last one', () => {
    const many = Array.from({ length: 40 }, (_, index) => rowId(index + 10));
    let clock = 0;
    // Each read of the clock passes 3 ms, so an 8 ms slice decodes two seeds.
    const test = harness(databaseDoc(many), { sliceMs: 8, now: () => (clock += 3) });

    many.forEach((id, index) => test.seed(id, `Row ${index}`));
    test.subscribe();

    let slices = 0;

    while (test.tasks.length > 0) {
      const rowsBefore = test.source.getSnapshot().rows.length;

      test.tasks.shift()?.();
      slices += 1;
      expect(test.source.getSnapshot().rows.length).toBeGreaterThanOrEqual(rowsBefore);
    }

    expect(slices).toBe(20);
    expect(test.source.getSnapshot().rows).toHaveLength(40);
    expect(test.source.getSnapshot().complete).toBe(true);
    // About 16 ms pass per slice: a publish every six or seven slices, and the last one.
    expect(test.onChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(test.onChange.mock.calls.length).toBeLessThanOrEqual(5);
    expect(MENTION_ROWS_PUBLISH_INTERVAL_MS).toBe(100);
  });

  it('lets go of everything after the last picker leaves', async () => {
    const test = harness(databaseDoc(ids));
    const first = test.open(ids[0], 'Road trip');

    test.seed(ids[1], 'Budget review');
    test.seed(ids[2], 'Hiring plan');

    const leaveFirst = test.subscribe();
    const second = jest.fn();
    const leaveSecond = test.source.subscribe(second);

    leaveFirst();
    expect(test.titles()).toEqual(['Road trip']);
    leaveSecond();

    expect(test.source.getSnapshot()).toEqual({ databaseId: DATABASE, rows: [], complete: false });
    expect(test.residency.size).toBe(0);
    // No slice runs, no edit or refresh is heard.
    test.runSlices();
    setTitle(first, 'Road trip 2');
    test.source.refresh();
    await microtasks();
    expect(test.source.getSnapshot().rows).toEqual([]);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('waits for the membership while the inline view has not loaded its row orders', () => {
    const doc = databaseDoc(ids);

    databaseOf(doc).get(YjsDatabaseKey.views).get('grid').delete(YjsDatabaseKey.row_orders);

    const test = harness(doc);

    ids.forEach((id, index) => test.open(id, `Row ${index}`));
    test.subscribe();
    expect(test.source.getSnapshot()).toEqual({ databaseId: DATABASE, rows: [], complete: false });
  });

  it('reads a creation time in seconds, as a string or a number, and one in milliseconds as it is', () => {
    const test = harness(databaseDoc(ids));

    test.open(ids[0], 'A', '1762862400');
    test.open(ids[1], 'B', '1762862400000');
    test.open(ids[2], 'C', 'not a time');
    test.subscribe();

    expect(test.source.getSnapshot().rows.map((row) => row.createdAtMs)).toEqual([
      1762862400000,
      1762862400000,
      undefined,
    ]);
  });

  it('keeps the title a live row had while its document reloads without row data', async () => {
    const test = harness(databaseDoc(ids));
    const first = test.open(ids[0], 'Road trip');

    test.open(ids[1], 'Budget review');
    test.open(ids[2], 'Hiring plan');
    test.subscribe();
    first.getMap(YjsEditorKey.data_section).delete(YjsEditorKey.database_row);
    await microtasks();

    expect(test.titles()).toEqual(['Road trip', 'Budget review', 'Hiring plan']);
  });
});
