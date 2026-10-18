import type { AtomicCreationOwner } from '@/application/atomic-creation';
import type { YDoc } from '@/application/types';

// This is only a one-open data-fetch hint. Navigation still performs its usual
// permission checks; no durable cache or authorization decision is stored here.
const justHydrated = new WeakMap<YDoc, { owner: AtomicCreationOwner; viewId: string; version?: string }>();

export function rememberCreatedDocument(doc: YDoc, owner: AtomicCreationOwner, viewId: string): void {
  justHydrated.set(doc, { owner, viewId, version: doc.version });
}

export function consumeCreatedDocument(doc: YDoc, workspaceId: string, viewId: string): boolean {
  const witness = justHydrated.get(doc);

  justHydrated.delete(doc);
  if (!witness || witness.owner.workspaceId !== workspaceId || witness.viewId !== viewId || witness.version !== doc.version) return false;
  witness.owner.assertCurrent();
  return true;
}
