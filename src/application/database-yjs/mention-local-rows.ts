/**
 * The rows of one database that the tab holds in memory, for the editor @ picker's local rows lane
 * (MEN-WEB-15, `mentionLocalRows.ts` in the mention panel): each row's primary-field text, as the grid
 * shows it, and when the row was created.
 *
 * - Nothing is read until a picker subscribes, and everything is let go once the last one leaves.
 * - Rows: the database's membership, every view's live row orders (`getLiveDatabaseRowIds`), read
 *   again when row orders, views or fields change.
 * - Text: a row the tab has open (the rows a view renders, a row page, a row just created) is read
 *   from its live document, which is observed while the picker is open, so a title typed into it
 *   shows at once. Any other row is read from its committed seed, the copy the row walk downloaded,
 *   decoded into a throwaway document in short slices off the keystroke path: the index keeps
 *   titles, never documents (10,000 decoded rows would hold about 200 MB, their titles under 1 MB).
 *   A decoded seed's title is kept with the seed, so the next picker reads it without decoding.
 * - A row says where its title came from (`synced`): a live document the tab keeps in sync, or a
 *   copy that may lag behind Search (a seed, a cached document no longer synced), whose title the
 *   picker gives up for the server's when the server lists the row.
 * - The primary field is read again when what its text depends on changes (which field, its type,
 *   its type options); renaming it or changing its icon reads no title again.
 * - `complete`: the membership is loaded, every row has a title, and the tab holds every row of the
 *   database (`holdsDatabaseSourceRows`). A row whose seed waits for a slice has none yet.
 *
 * Limits: a row another user edited is read from its seed until the tab opens it, as filter and sort
 * read it; a database whose rows the tab does not hold (a row page, or a grid revisited with a cached
 * RID, which walks only the rows that changed) lists only the rows the tab has open, and is never
 * complete. Nothing here depends on React.
 */
import * as Y from 'yjs';

import { decodeCellToText } from '@/application/database-yjs/decode';
import { getLiveDatabaseRowIds } from '@/application/database-yjs/relation/row-orders';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import type {
  MentionLocalRow,
  MentionLocalRowsSnapshot,
  MentionLocalRowsSource,
} from '@/components/editor/components/panels/mention-panel/mentionLocalRows';

import type { YEvent } from 'yjs';

/** A row's committed seed: the bytes of its document, as the row walk stores them. */
export interface MentionRowSeed {
  readonly bytes: Uint8Array;
  readonly encoderVersion: number;
}

export interface DatabaseMentionRowsOptions {
  databaseDoc: YDoc;
  /** The live document of a row the tab has open, by row key (the row document cache). */
  getLiveRowDoc: (rowKey: string) => YDoc | undefined;
  /**
   * Whether the tab keeps a live row document in sync, by the document's id
   * (`hasRowDocSyncBinding`). Without it every live document counts as synced.
   */
  isRowDocSynced?: (rowDocId: string) => boolean;
  /** A row's committed seed, by row key, without consuming it (`peekDatabaseRowDocSeed`). */
  peekRowSeed: (rowKey: string) => MentionRowSeed | null;
  /** Whether the tab holds every row of the database in memory (`holdsDatabaseSourceRows`). */
  holdsRows: (databaseId: string) => boolean;
  /** Notified when a database starts or stops being resident (`subscribeToDatabaseSourceResidency`). */
  subscribeToResidency?: (listener: () => void) => () => void;
  /** Runs `task` later, off the keystroke path; returns a cancel. An idle callback by default. */
  schedule?: (task: () => void) => () => void;
  /** How long one slice of seed decoding may run, in milliseconds. */
  sliceMs?: number;
  /** A monotonic clock in milliseconds, for the slices. */
  now?: () => number;
}

/** A {@link MentionLocalRowsSource} that can be told to look again for rows the tab opened. */
export interface DatabaseMentionRowsSource extends MentionLocalRowsSource {
  /**
   * Looks again for rows that have no title or no live document, and at whether the tab holds every
   * row: after a view opened rows, or the row walk committed its seeds. Does nothing while no picker
   * subscribes.
   */
  readonly refresh: () => void;
}

/** One slice of seed decoding runs about this long, then yields. */
export const MENTION_ROWS_SLICE_MS = 8;
/** While seeds are decoded, a snapshot is published at most this often, and once they are done. */
export const MENTION_ROWS_PUBLISH_INTERVAL_MS = 100;

interface SeedTitle {
  readonly fieldKey: string;
  readonly row: MentionLocalRow | null;
}

// What a decoded seed gave, kept with the seed object: a new walk brings new seeds, and the old ones
// go with their entries. `null` is a seed without row data.
const seedTitles = new WeakMap<object, SeedTitle>();

interface RowEntry {
  /** `null` until the row has a title source. */
  row: MentionLocalRow | null;
  /** The live document the title comes from, observed while active. */
  live?: { doc: YDoc; stop: () => void };
}

const EMPTY_ROWS: readonly MentionLocalRow[] = Object.freeze([]);
// Unix seconds reach this in the year 5138; epoch milliseconds passed it in 1973.
const MILLISECONDS_THRESHOLD = 1e11;

function defaultSchedule(task: () => void): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 200 });

    return () => window.cancelIdleCallback(handle);
  }

  const timer = setTimeout(task, 0);

  return () => clearTimeout(timer);
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function readDatabase(databaseDoc: YDoc): YDatabase | undefined {
  return databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
}

/**
 * The database's live row ids, or `null` while its membership is still loading: a linked view can
 * hydrate before the inline view, whose missing orders prove nothing (as `relation/cache.ts` reads it).
 */
function readMembership(database: YDatabase | undefined): string[] | null {
  if (!database) return null;

  const views = database.get(YjsDatabaseKey.views);
  const inlineId = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid);

  if (inlineId && !views?.get(inlineId)?.get(YjsDatabaseKey.row_orders)) return null;
  if (
    !inlineId &&
    Array.from(views?.values() ?? []).some(
      (view) => view.get(YjsDatabaseKey.is_inline) && !view.get(YjsDatabaseKey.row_orders)
    )
  ) {
    return null;
  }

  return getLiveDatabaseRowIds(database);
}

/**
 * A key of what the text of a primary field's cells depends on: which field, its type and its type
 * options (`decodeCellToText` reads a converted cell by its own type's options). Its name, its icon
 * and `last_modified`, which a rename or an icon change bumps, change no title.
 */
function primaryFieldKey(id: string, field: YDatabaseField): string {
  const type = field.get(YjsDatabaseKey.type) ?? null;

  try {
    const typeOptions = field.get(YjsDatabaseKey.type_option) as YDatabaseFieldTypeOption | undefined;

    return JSON.stringify([id, type, typeOptions?.toJSON?.() ?? null]);
  } catch {
    // Options that do not serialize: any change of the field reads the titles again.
    return JSON.stringify([id, type, String(field.get(YjsDatabaseKey.last_modified) ?? '')]);
  }
}

function readPrimaryField(database: YDatabase | undefined): { id?: string; field?: YDatabaseField; key: string } {
  const fields = database?.get(YjsDatabaseKey.fields);
  let found: { id: string; field: YDatabaseField } | undefined;

  fields?.forEach((field, id) => {
    if (!found && field?.get(YjsDatabaseKey.is_primary)) found = { id, field };
  });

  if (!found) return { key: '' };

  return { ...found, key: primaryFieldKey(found.id, found.field) };
}

/** Whether a deep change of the database document can change its membership or its primary field. */
function changesRowsOrFields(event: YEvent): boolean {
  const [databaseKey, branch, viewId, property] = event.path;

  if (databaseKey === undefined) return event.changes.keys.has(YjsEditorKey.database);
  if (databaseKey !== YjsEditorKey.database) return false;
  if (branch === undefined) {
    return (
      event.changes.keys.has(YjsDatabaseKey.views) ||
      event.changes.keys.has(YjsDatabaseKey.metas) ||
      event.changes.keys.has(YjsDatabaseKey.fields)
    );
  }

  if (branch === YjsDatabaseKey.fields) return true;
  if (branch === YjsDatabaseKey.metas) return event.changes.keys.has(YjsDatabaseKey.iid);
  if (branch !== YjsDatabaseKey.views) return false;
  if (viewId === undefined) return true;
  if (property === undefined) {
    return event.changes.keys.has(YjsDatabaseKey.row_orders) || event.changes.keys.has(YjsDatabaseKey.is_inline);
  }

  return property === YjsDatabaseKey.row_orders;
}

/**
 * A row's `created_at` in epoch milliseconds. Clients write Unix seconds, as a string or a number; a
 * value too large for seconds is taken as milliseconds already.
 */
function createdAtMs(value: unknown): number | undefined {
  const time = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;

  if (!Number.isFinite(time)) return undefined;
  return time > MILLISECONDS_THRESHOLD ? time : time * 1000;
}

/**
 * The rows the tab holds of the database in `databaseDoc` (see the module header). One source per
 * database document is enough: every picker in it shares the snapshot.
 */
export function createDatabaseMentionRowsSource({
  databaseDoc,
  getLiveRowDoc,
  isRowDocSynced,
  peekRowSeed,
  holdsRows,
  subscribeToResidency,
  schedule = defaultSchedule,
  sliceMs = MENTION_ROWS_SLICE_MS,
  now = defaultNow,
}: DatabaseMentionRowsOptions): DatabaseMentionRowsSource {
  const listeners = new Set<() => void>();
  const entries = new Map<string, RowEntry>();
  // Rows whose seed waits to be decoded.
  const pending = new Set<string>();
  const emptySnapshot = (id: string): MentionLocalRowsSnapshot => ({
    databaseId: id,
    rows: EMPTY_ROWS,
    complete: false,
  });
  let snapshot = emptySnapshot(databaseDoc.guid);
  let active = false;
  let databaseId = databaseDoc.guid;
  let membership: string[] | null = null;
  let primary = readPrimaryField(undefined);
  let cancelSlice: (() => void) | undefined;
  let publishQueued = false;
  let refreshQueued = false;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  let stopDatabase: (() => void) | undefined;
  let stopResidency: (() => void) | undefined;

  const rowKeyOf = (rowId: string) => getRowKey(databaseId, rowId);

  /** The row in `doc`; `synced` when `doc` is a live document the tab keeps in sync. */
  function readRow(doc: YDoc, rowId: string, synced: boolean): MentionLocalRow | null {
    const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

    if (!row) return null;

    const cell = primary.id ? row.get(YjsDatabaseKey.cells)?.get(primary.id) : undefined;
    let title = '';

    try {
      title = cell && primary.field ? decodeCellToText(cell, primary.field).trim() : '';
    } catch {
      title = '';
    }

    return { rowId, title, createdAtMs: createdAtMs(row.get(YjsDatabaseKey.created_at)), synced };
  }

  function readLiveRow(doc: YDoc, rowId: string): MentionLocalRow | null {
    return readRow(doc, rowId, isRowDocSynced ? isRowDocSynced(doc.guid) : true);
  }

  function sameRow(left: MentionLocalRow | null, right: MentionLocalRow | null) {
    return (
      left === right ||
      (!!left &&
        !!right &&
        left.title === right.title &&
        left.createdAtMs === right.createdAtMs &&
        left.synced === right.synced)
    );
  }

  /** What the seed gave when it was decoded for the current primary field; `undefined` if it was not. */
  function cachedSeedRow(seed: MentionRowSeed): MentionLocalRow | null | undefined {
    const cached = seedTitles.get(seed);

    return cached && cached.fieldKey === primary.key ? cached.row : undefined;
  }

  function decodeSeedRow(rowId: string, seed: MentionRowSeed): MentionLocalRow | null {
    const doc = new Y.Doc({ guid: rowKeyOf(rowId) }) as YDoc;
    let row: MentionLocalRow | null = null;

    try {
      applyYDoc(doc, seed.bytes, seed.encoderVersion);
      row = readRow(doc, rowId, false);
    } catch {
      row = null;
    } finally {
      doc.destroy();
    }

    seedTitles.set(seed, { fieldKey: primary.key, row });
    return row;
  }

  function attachLive(rowId: string, entry: RowEntry, doc: YDoc) {
    const dataSection = doc.getMap(YjsEditorKey.data_section);
    const onChange = () => {
      if (!active || entries.get(rowId) !== entry) return;

      const next = readLiveRow(doc, rowId);

      // A live document that lost its row data, as while it reloads, keeps the title it had.
      if (next === null || sameRow(entry.row, next)) return;
      entry.row = next;
      pending.delete(rowId);
      queuePublish();
    };

    dataSection.observeDeep(onChange);
    entry.live = {
      doc,
      stop: () => {
        try {
          dataSection.unobserveDeep(onChange);
        } catch {
          // The document may already be destroyed.
        }
      },
    };
  }

  /**
   * Gives the row its title from its live document, which is then observed; else queues it for a
   * slice, which reads its seed. A row without either keeps what it had, and so does one whose
   * title and source did not change.
   */
  function resolve(rowId: string, entry: RowEntry) {
    if (!entry.live) {
      const doc = getLiveRowDoc(rowKeyOf(rowId));

      if (doc) attachLive(rowId, entry, doc);
    }

    const live = entry.live ? readLiveRow(entry.live.doc, rowId) : null;

    if (live) {
      if (!sameRow(entry.row, live)) entry.row = live;
      pending.delete(rowId);
      return;
    }

    pending.add(rowId);
  }

  function dropEntry(rowId: string, entry: RowEntry) {
    entry.live?.stop();
    entries.delete(rowId);
    pending.delete(rowId);
  }

  /**
   * Reads the membership and the primary field again. New rows are resolved; so is every row when
   * `rereadTitles` is set or the primary field changed, since each title then changes.
   */
  function readAll(rereadTitles: boolean) {
    const database = readDatabase(databaseDoc);
    const nextPrimary = readPrimaryField(database);
    const reread = rereadTitles || nextPrimary.key !== primary.key;

    databaseId = database?.get(YjsDatabaseKey.id) || databaseDoc.guid;
    primary = nextPrimary;
    membership = readMembership(database);

    const members = new Set(membership ?? []);

    entries.forEach((entry, rowId) => {
      if (!members.has(rowId)) dropEntry(rowId, entry);
    });
    members.forEach((rowId) => {
      let entry = entries.get(rowId);

      if (!entry) {
        entry = { row: null };
        entries.set(rowId, entry);
      } else if (!reread) {
        return;
      } else {
        entry.row = null;
      }

      resolve(rowId, entry);
    });
    scheduleSlice();
  }

  function runSlice() {
    cancelSlice = undefined;
    if (!active) return;

    const started = now();

    // Reading the clock costs more than reading a seed whose title was kept, so it is read once per
    // decode, and once per 64 rows otherwise.
    let reads = 0;

    for (const rowId of pending) {
      if (reads % 64 === 0 && now() - started >= sliceMs) break;
      reads += 1;
      pending.delete(rowId);

      const entry = entries.get(rowId);
      const seed = entry && !(entry.live && entry.row) ? peekRowSeed(rowKeyOf(rowId)) : null;

      if (!entry || !seed) continue;

      const cached = cachedSeedRow(seed);

      if (cached !== undefined) {
        entry.row = cached;
        continue;
      }

      entry.row = decodeSeedRow(rowId, seed);
      reads = 0;
    }

    if (pending.size > 0) {
      scheduleSlice();
      if (now() - lastPublishedAt >= MENTION_ROWS_PUBLISH_INTERVAL_MS) publish();
      return;
    }

    publish();
  }

  function scheduleSlice() {
    if (!active || cancelSlice || pending.size === 0) return;
    cancelSlice = schedule(runSlice);
  }

  function buildSnapshot(): MentionLocalRowsSnapshot {
    if (!membership) return emptySnapshot(databaseId);

    const rows: MentionLocalRow[] = [];
    let titled = true;

    membership.forEach((rowId) => {
      const row = entries.get(rowId)?.row;

      if (row) rows.push(row);
      else titled = false;
    });

    return {
      databaseId,
      rows: rows.length > 0 ? rows : EMPTY_ROWS,
      // A titled row waiting for a newer seed still has a title: a refresh never makes it incomplete.
      complete: titled && holdsRows(databaseId),
    };
  }

  function publish() {
    publishQueued = false;
    if (!active) return;

    const next = buildSnapshot();

    lastPublishedAt = now();
    if (
      next.complete === snapshot.complete &&
      next.databaseId === snapshot.databaseId &&
      next.rows.length === snapshot.rows.length &&
      next.rows.every((row, index) => row === snapshot.rows[index])
    ) {
      return;
    }

    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function queuePublish() {
    if (publishQueued) return;
    publishQueued = true;
    queueMicrotask(publish);
  }

  // Rows the tab opened since, and seeds a walk committed since: a row without a live document is
  // resolved again, and so is one whose live document was not synced (a synced one is kept current
  // by its observer).
  function runRefresh() {
    refreshQueued = false;
    if (!active) return;

    entries.forEach((entry, rowId) => {
      if (!entry.live || !entry.row?.synced) resolve(rowId, entry);
    });
    scheduleSlice();
    publish();
  }

  function refresh() {
    if (!active || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(runRefresh);
  }

  function activate() {
    const dataSection = databaseDoc.getMap(YjsEditorKey.data_section);
    const onDatabaseChange = (events: YEvent[]) => {
      if (!events.some(changesRowsOrFields)) return;
      readAll(false);
      queuePublish();
    };

    active = true;
    dataSection.observeDeep(onDatabaseChange);
    stopDatabase = () => dataSection.unobserveDeep(onDatabaseChange);
    stopResidency = subscribeToResidency?.(refresh);
    readAll(true);
    snapshot = buildSnapshot();
    lastPublishedAt = now();
  }

  function deactivate() {
    active = false;
    stopDatabase?.();
    stopDatabase = undefined;
    stopResidency?.();
    stopResidency = undefined;
    entries.forEach((entry) => entry.live?.stop());
    entries.clear();
    pending.clear();
    cancelSlice?.();
    cancelSlice = undefined;
    membership = null;
    publishQueued = false;
    refreshQueued = false;
    snapshot = emptySnapshot(databaseId);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (onChange) => {
      listeners.add(onChange);
      if (!active) activate();

      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && active) deactivate();
      };
    },
    refresh,
  };
}
