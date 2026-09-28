import * as Y from 'yjs';

import { markDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import type { YDoc } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';

const HISTORY_ROW_DOCUMENT_CACHE_SIZE = 128;
const historyRowStores = new WeakMap<Record<string, YDoc>, DatabaseHistoryRowStore>();

/**
 * Immutable random access for the existing synchronous filter/group/chart
 * readers. Encoded rows stay session-scoped; scans retain only a bounded
 * working set of Yjs documents instead of every row's CRDT structures.
 */
export class DatabaseHistoryRowStore {
  readonly rows: Record<string, YDoc>;
  private readonly encodedRows = new Map<string, { bytes: Uint8Array; encoder: 1 | 2 }>();
  private readonly cache = new Map<string, YDoc>();
  private readonly retainedDocuments = new Map<YDoc, number>();
  private readonly retainedRows = new Map<string, Set<YDoc>>();
  private readonly documentRowIds = new WeakMap<YDoc, string>();
  private disposed = false;

  constructor(private readonly namespace: string) {
    this.rows = new Proxy(Object.create(null) as Record<string, YDoc>, {
      get: (_target, key) => typeof key === 'string' ? this.read(key) : undefined,
      has: (_target, key) => typeof key === 'string' && this.encodedRows.has(key),
      ownKeys: () => Array.from(this.encodedRows.keys()),
      getOwnPropertyDescriptor: (_target, key) => typeof key === 'string' && this.encodedRows.has(key)
        ? { configurable: true, enumerable: true }
        : undefined,
      set: () => false,
      deleteProperty: () => false,
    });
    historyRowStores.set(this.rows, this);
  }

  get rowCount() {
    return this.encodedRows.size;
  }

  get cachedDocumentCount() {
    return this.cache.size;
  }

  /** Validate every row before preview readiness, including offscreen rows. */
  add(rowId: string, bytes: Uint8Array, encoder: number): void {
    if (this.disposed) throw new Error('The database history preview is closed.');
    if (this.encodedRows.has(rowId)) throw new Error('This database version contains duplicate rows.');
    if (encoder !== 1 && encoder !== 2) throw new Error('This row uses an unsupported history encoding.');

    const validationDoc = new Y.Doc() as YDoc;

    try {
      applyYDoc(validationDoc, bytes, encoder);
    } finally {
      validationDoc.destroy();
    }

    this.encodedRows.set(rowId, { bytes: Uint8Array.from(bytes), encoder });
  }

  private read(rowId: string): YDoc | undefined {
    if (this.disposed) return undefined;
    const encoded = this.encodedRows.get(rowId);

    if (!encoded) return undefined;

    let doc = this.retainedRows.get(rowId)?.values().next().value ?? this.cache.get(rowId);

    if (doc) {
      this.cache.delete(rowId);
    } else {
      doc = new Y.Doc({ guid: `${this.namespace}:${rowId}` }) as YDoc;
      applyYDoc(doc, encoded.bytes, encoded.encoder);
      markDatabaseHistoryDocumentImmutable(doc);
      this.documentRowIds.set(doc, rowId);
    }

    this.cache.set(rowId, doc);
    if (this.cache.size > HISTORY_ROW_DOCUMENT_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value as string;

      // A render may still hold this immutable document before its effect
      // pins it. Drop ownership without destroying that surviving reader.
      // Detached Y.Docs have no transport or IndexedDB resources; unretained
      // scan documents become collectible immediately after eviction.
      this.cache.delete(oldest);
    }

    return doc;
  }

  retain(doc: YDoc): () => void {
    if (this.disposed) return () => undefined;
    const rowId = this.documentRowIds.get(doc);

    if (!rowId) return () => undefined;
    const retainedForRow = this.retainedRows.get(rowId) ?? new Set<YDoc>();

    retainedForRow.add(doc);
    this.retainedRows.set(rowId, retainedForRow);
    this.retainedDocuments.set(doc, (this.retainedDocuments.get(doc) ?? 0) + 1);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      const remaining = (this.retainedDocuments.get(doc) ?? 0) - 1;

      if (remaining > 0) this.retainedDocuments.set(doc, remaining);
      else {
        this.retainedDocuments.delete(doc);
        retainedForRow.delete(doc);
        if (retainedForRow.size === 0) this.retainedRows.delete(rowId);
      }
    };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    new Set([...this.cache.values(), ...this.retainedDocuments.keys()]).forEach((doc) => doc.destroy());
    this.cache.clear();
    this.retainedDocuments.clear();
    this.retainedRows.clear();
    this.encodedRows.clear();
  }
}

/** Pin only mounted row readers, not full-view condition scans. */
export function retainDatabaseHistoryRow(rows: Record<string, YDoc> | null, doc: YDoc | undefined): () => void {
  return rows && doc ? historyRowStores.get(rows)?.retain(doc) ?? (() => undefined) : () => undefined;
}

/** Plain snapshot maps remain supported for callers and focused render tests. */
export function markDatabaseHistoryRowsImmutable(rows: Record<string, YDoc>): void {
  if (historyRowStores.has(rows)) return;
  Object.values(rows).forEach(markDatabaseHistoryDocumentImmutable);
}
