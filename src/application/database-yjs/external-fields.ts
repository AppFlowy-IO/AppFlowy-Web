import { FieldType } from '@/application/database-yjs/database.type';
import type { VerificationSnapshot } from '@/application/database-yjs/fields/verification';
import { YDatabaseField, YDatabaseFields, YjsDatabaseKey } from '@/application/types';

/** Read-only fields whose values are owned by an authenticated service, not the row CRDT. */
export interface ExternalDatabaseField {
  field: YDatabaseField;
  /** Undefined means unavailable/loading; an empty string is a loaded, empty cell. */
  readValue: (rowId: string) => string | undefined;
  readVerificationSnapshot?: (rowId: string) => VerificationSnapshot | undefined;
}

type Store = {
  owners: Map<symbol, ExternalDatabaseField[]>;
  listeners: Set<() => void>;
  queued: boolean;
};
const stores = new WeakMap<YDatabaseFields, Store>();
const readers = new WeakMap<YDatabaseField, Map<symbol, ExternalDatabaseField>>();

function storeFor(fields: YDatabaseFields): Store {
  let store = stores.get(fields);

  if (!store) {
    store = { owners: new Map(), listeners: new Set(), queued: false };
    stores.set(fields, store);
  }

  return store;
}

export function getExternalDatabaseFields(fields: YDatabaseFields): ExternalDatabaseField[] {
  const entries = new Map<string, ExternalDatabaseField>();

  storeFor(fields).owners.forEach((owned) =>
    owned.forEach((entry) => {
      entries.set(entry.field.get(YjsDatabaseKey.id), entry);
    })
  );
  return [...entries.values()];
}

/** Several open views may share a document; each owns only its own registration. */
export function registerExternalDatabaseFields(fields: YDatabaseFields, entries: ExternalDatabaseField[]) {
  const store = storeFor(fields);
  const owner = Symbol('external-fields');

  entries.forEach((entry) => {
    const owners = readers.get(entry.field) ?? new Map();

    owners.set(owner, entry);
    readers.set(entry.field, owners);
  });
  store.owners.set(owner, entries);
  publishExternalDatabaseFields(fields);
  return () => {
    store.owners.delete(owner);
    entries.forEach((entry) => {
      const owners = readers.get(entry.field);

      owners?.delete(owner);
      if (!owners?.size) readers.delete(entry.field);
    });
    publishExternalDatabaseFields(fields);
  };
}

export function readExternalFieldValue(field: YDatabaseField, rowId: string) {
  return readerFor(field)?.readValue(rowId);
}

export function readVerificationFieldSnapshot(field: YDatabaseField, rowId: string): VerificationSnapshot | undefined {
  if (Number(field.get(YjsDatabaseKey.type)) !== FieldType.Verification) return undefined;
  return readerFor(field)?.readVerificationSnapshot?.(rowId);
}

function readerFor(field: YDatabaseField) {
  // All linked views share the authenticated store. Removing one view must not
  // unregister another view's reader of the same native field.
  const entries = readers.get(field);

  return entries?.values().next().value as ExternalDatabaseField | undefined;
}

export function isExternalDatabaseField(field: YDatabaseField) {
  // A disconnected Verification field is still Cloud-owned. Never fall back to
  // source cells preserved by a previous type conversion.
  return Number(field.get(YjsDatabaseKey.type)) === FieldType.Verification || readers.has(field);
}

/** Batch metadata publications so a response containing many rows triggers one render. */
export function publishExternalDatabaseFields(fields: YDatabaseFields) {
  const store = storeFor(fields);

  if (store.queued) return;
  store.queued = true;
  queueMicrotask(() => {
    store.queued = false;
    store.listeners.forEach((listener) => listener());
  });
}

export function subscribeExternalDatabaseFields(fields: YDatabaseFields, listener: () => void) {
  const store = storeFor(fields);

  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}
