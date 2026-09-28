import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import type { DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { readHistoricalRelationText } from '@/application/database-yjs/relation/history';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import {
  MentionablePerson,
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { getLiveDatabaseRowIds } from '@/components/database/components/cell/relation/relationRowOrders';
import { subscribeCollabDocReset } from '@/components/ws/sync/subscribeCollabDocReset';

type Cleanup = () => void;
type RowEntry = { doc?: YDoc; cleanup?: Cleanup };
type CandidateRow = RowEntry & { inputDoc?: YDoc; revision: number; reset?: boolean };
type RelatedDatabase = RowEntry & { rows: Map<string, RowEntry>; viewId?: string };
type Loaders = Pick<
  DatabaseContextState,
  'createRow' | 'ensureRow' | 'loadView' | 'getViewIdFromDatabaseId' | 'eventEmitter'
>;

export interface FeedSearchData extends Loaders {
  /** Complete immutable snapshots need no row subscriptions or live relation loads. */
  immutable?: boolean;
  database: YDatabase;
  rows: Record<string, YDoc>;
  rowIds?: readonly string[];
  fallbackRows?: Record<string, YDoc>;
  fieldIds: string[];
  users: readonly MentionablePerson[];
}

/**
 * Data-only search reads hydrated docs immediately, then registers candidates
 * through the Database's existing sync lifecycle so offscreen remote edits
 * remain searchable. Candidate and related-title requests share a bounded
 * queue; none of this work mounts cards, covers, or comment composers.
 */
export function createFeedSearchIndex() {
  let data: FeedSearchData | undefined;
  let snapshot: ReadonlyMap<string, string> = new Map();
  const subscribers = new Set<() => void>();
  const sourceRows = new Map<string, RowEntry>();
  const candidates = new Map<string, CandidateRow>();
  const related = new Map<string, RelatedDatabase>();
  let resetCleanup: Cleanup | undefined;
  let emitter: Loaders['eventEmitter'];
  let scheduled = false;
  let running = 0;
  const jobs: Array<() => Promise<void>> = [];

  const publish = (next: Map<string, string>) => {
    if (snapshot.size === next.size && [...next].every(([id, text]) => snapshot.get(id) === text)) return;
    snapshot = next;
    subscribers.forEach((notify) => notify());
  };

  const schedule = () => {
    if (scheduled || !data) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (data) rebuild();
    });
  };

  const drain = () => {
    while (running < 8 && jobs.length > 0) {
      const job = jobs.shift()!;

      running++;
      void job()
        .catch(() => undefined)
        .finally(() => {
          running--;
          drain();
        });
    }
  };

  const enqueue = (job: () => Promise<void>, priority = false) => {
    // Search labels must not wait behind every candidate's sync handshake.
    if (priority) jobs.unshift(job);
    else jobs.push(job);
    drain();
  };

  const setDocument = (entry: RowEntry, doc: YDoc) => {
    if (entry.doc === doc) return;
    entry.cleanup?.();
    entry.doc = doc;
    entry.cleanup = subscribeSharedYjsDeep(doc.getMap(YjsEditorKey.data_section), schedule);
  };

  const ensureCandidate = (rowId: string) => {
    const inputDoc = data?.rows[rowId];
    const current = candidates.get(rowId);

    if (current) {
      if (inputDoc !== current.inputDoc) {
        current.inputDoc = inputDoc;
        current.revision++;
        if (inputDoc) setDocument(current, inputDoc);
      }

      return;
    }

    const ensureRow = data?.ensureRow;

    if (!ensureRow) return;
    const entry: CandidateRow = { inputDoc, revision: 0 };

    candidates.set(rowId, entry);
    enqueue(async () => {
      if (candidates.get(rowId) !== entry) return;
      const revision = entry.revision;
      const doc = await ensureRow(rowId);

      if (!doc || candidates.get(rowId) !== entry || entry.revision !== revision) return;
      const currentDoc = entry.doc ?? entry.inputDoc;

      setDocument(entry, doc);
      // Input documents are already observed. Completing their sync registration
      // without replacing them must not rebuild the entire index for every batch.
      if (doc !== currentDoc) schedule();
    });
  };

  const releaseDatabase = (entry: RelatedDatabase) => {
    entry.cleanup?.();
    entry.rows.forEach((row) => row.cleanup?.());
    entry.rows.clear();
  };

  const ensureDatabase = (id: string): RelatedDatabase => {
    const current = related.get(id);

    if (current) return current;
    const entry: RelatedDatabase = { rows: new Map() };
    const loaders = data;

    related.set(id, entry);
    enqueue(async () => {
      if (related.get(id) !== entry) return;
      const viewId = await loaders?.getViewIdFromDatabaseId?.(id);

      if (!viewId || related.get(id) !== entry) return;
      entry.viewId = viewId;
      const doc = await loaders?.loadView?.(viewId, false, false, { databaseId: id, databaseMetadataOnly: true });

      if (!doc || related.get(id) !== entry || entry.doc) return;
      setDocument(entry, doc);
      schedule();
    }, true);
    return entry;
  };

  const ensureRelatedRow = (databaseId: string, database: RelatedDatabase, rowId: string) => {
    const current = database.rows.get(rowId);

    if (current) return current;
    const entry: RowEntry = {};
    const createRow = data?.createRow;
    const guid = database.doc?.guid;

    database.rows.set(rowId, entry);
    if (!createRow || !guid) return entry;
    enqueue(async () => {
      if (related.get(databaseId) !== database || database.rows.get(rowId) !== entry) return;
      const doc = await createRow(getRowKey(guid, rowId));

      if (related.get(databaseId) !== database || database.rows.get(rowId) !== entry) return;
      setDocument(entry, doc);
      schedule();
    }, true);
    return entry;
  };

  function rebuild() {
    if (!data) return;
    const fields = data.database.get(YjsDatabaseKey.fields);
    const searchableFields = data.fieldIds.flatMap((id) => {
      const field = fields?.get(id);

      return field ? [[id, field] as const] : [];
    });
    const byPerson = new Map(data.users.map((user) => [user.person_id, user]));
    const byUid = new Map(data.users.map((user) => [canonicalizeUserUid(user.uid), user]));
    const personText = (user: MentionablePerson | undefined) => (user ? `${user.name} ${user.email}` : '');
    const required = new Map<string, Set<string>>();
    const projections = new Map<string, { entry: RelatedDatabase; field?: YDatabaseField; live: Set<string> | null }>();
    const next = new Map<string, string>();

    const relationText = (databaseId: string, rowIds: string[]) => {
      if (!databaseId || rowIds.length === 0) return '';
      if (data?.immutable) return readHistoricalRelationText(data.database, databaseId, rowIds, data.rows);
      let projection = projections.get(databaseId);

      if (!projection) {
        const entry = ensureDatabase(databaseId);
        const database = entry.doc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as
          | YDatabase
          | undefined;
        const targetFields = database?.get(YjsDatabaseKey.fields);
        const primaryId = [...(targetFields?.keys() ?? [])].find((id) =>
          targetFields?.get(id)?.get(YjsDatabaseKey.is_primary)
        );
        const live = database ? getLiveDatabaseRowIds(database) : null;

        projection = {
          entry,
          field: primaryId ? targetFields?.get(primaryId) : undefined,
          live: live === null ? null : new Set(live),
        };
        projections.set(databaseId, projection);
        required.set(databaseId, new Set());
      }

      const { entry, field, live } = projection;

      if (!field) return '';
      return rowIds
        .flatMap((id) => {
          if (live && !live.has(id)) return [];
          required.get(databaseId)!.add(id);
          const row = ensureRelatedRow(databaseId, entry, id)
            .doc?.getMap(YjsEditorKey.data_section)
            .get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
          const cell = row?.get(YjsDatabaseKey.cells)?.get(field.get(YjsDatabaseKey.id));

          return cell ? [decodeCellToText(cell, field)] : [];
        })
        .join(' ');
    };

    for (const rowId of data.rowIds ?? Object.keys(data.rows)) {
      const candidate = candidates.get(rowId);
      const liveDoc = candidate?.doc ?? data.rows[rowId];
      const doc = hasRowConditionData(liveDoc) || candidate?.reset ? liveDoc : data.fallbackRows?.[rowId] ?? liveDoc;
      const row = doc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
      const cells = row?.get(YjsDatabaseKey.cells);
      const text = searchableFields
        .map(([fieldId, field]) => {
          try {
            const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

            if (type === FieldType.CreatedBy || type === FieldType.LastEditedBy) {
              const uid = canonicalizeUserUid(
                row?.get(type === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by)
              );

              return uid ? personText(byUid.get(uid)) || `User ${uid}` : '';
            }

            const cell = cells?.get(fieldId);

            if (!cell) return '';
            if (type === FieldType.Person) {
              const value = parseYDatabaseCellToCell(cell, field).data;
              const ids: unknown = typeof value === 'string' ? JSON.parse(value) : [];

              return Array.isArray(ids)
                ? ids
                    .map((id) =>
                      id === '00000000-0000-0000-0000-000000000000' ? 'Anonymous' : personText(byPerson.get(id))
                    )
                    .join(' ')
                : '';
            }

            if (type === FieldType.Relation) {
              return relationText(parseRelationTypeOption(field).database_id, getRelationRowIdsFromCell(cell));
            }

            return decodeCellToText(cell, field);
          } catch {
            return '';
          }
        })
        .join(' ')
        .toLocaleLowerCase();

      next.set(rowId, text);
    }

    related.forEach((entry, id) => {
      const needed = required.get(id);

      if (!needed) {
        releaseDatabase(entry);
        related.delete(id);
      } else {
        entry.rows.forEach((row, rowId) => {
          if (needed.has(rowId)) return;
          row.cleanup?.();
          entry.rows.delete(rowId);
        });
      }
    });
    publish(next);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    configure: (next: FeedSearchData) => {
      data = next;
      if (next.immutable) {
        rebuild();
        return;
      }

      const rowIds = new Set(next.rowIds ?? Object.keys(next.rows));

      candidates.forEach((entry, id) => {
        if (rowIds.has(id)) return;
        entry.cleanup?.();
        candidates.delete(id);
      });
      rowIds.forEach(ensureCandidate);
      const observedDocs = { ...next.rows };

      Object.entries(next.rows).forEach(([id, doc]) => {
        const fallback = next.fallbackRows?.[id];

        if (fallback && fallback !== doc && !hasRowConditionData(doc)) observedDocs[`cached:${id}`] = fallback;
      });
      sourceRows.forEach((entry, id) => {
        if (entry.doc === observedDocs[id]) return;
        entry.cleanup?.();
        sourceRows.delete(id);
      });
      Object.entries(observedDocs).forEach(([id, doc]) => {
        if (sourceRows.has(id)) return;
        const entry: RowEntry = {};

        setDocument(entry, doc);
        sourceRows.set(id, entry);
      });
      if (emitter !== next.eventEmitter) {
        resetCleanup?.();
        emitter = next.eventEmitter;
        resetCleanup = emitter
          ? subscribeCollabDocReset(emitter, ({ objectId, doc }) => {
              const candidate = candidates.get(objectId);

              if (candidate) {
                candidate.revision++;
                candidate.reset = true;
                setDocument(candidate, doc);
              }

              related.forEach((entry, id) => {
                if (objectId === id || objectId === entry.viewId || objectId === entry.doc?.guid) {
                  releaseDatabase(entry);
                  setDocument(entry, doc);
                } else if (entry.rows.has(objectId)) {
                  entry.rows.get(objectId)?.cleanup?.();
                  const row: RowEntry = {};

                  entry.rows.set(objectId, row);
                  setDocument(row, doc);
                }
              });
              schedule();
            })
          : undefined;
      }

      rebuild();
    },
    dispose: () => {
      data = undefined;
      sourceRows.forEach((entry) => entry.cleanup?.());
      sourceRows.clear();
      candidates.forEach((entry) => entry.cleanup?.());
      candidates.clear();
      related.forEach(releaseDatabase);
      related.clear();
      jobs.length = 0;
      resetCleanup?.();
      resetCleanup = undefined;
      emitter = undefined;
      publish(new Map());
    },
  };
}
