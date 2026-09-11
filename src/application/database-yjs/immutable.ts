import type { YDoc } from '@/application/types';

const immutableDocuments = new WeakSet<YDoc>();

/** Protect detached history documents at the shared mutation boundary. */
export function markDatabaseHistoryDocumentImmutable(doc: YDoc): void {
  immutableDocuments.add(doc);
}

export function isDatabaseHistoryDocumentImmutable(doc: YDoc): boolean {
  return immutableDocuments.has(doc);
}
