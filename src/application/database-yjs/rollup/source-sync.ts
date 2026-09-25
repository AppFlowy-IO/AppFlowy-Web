import { BindViewSync, YDoc } from '@/application/types';

export interface RollupSourceSync {
  bindViewSync?: BindViewSync;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

/** Metadata loads are snapshots until an observer owns their realtime sync. */
export function retainRollupSource(context: RollupSourceSync, doc: YDoc): () => void {
  const release = context.scheduleDeferredCleanup;

  if (!context.bindViewSync || !release) return () => undefined;
  const sync = context.bindViewSync(doc, { retain: true });

  // A missing/invalid sync binding acquired no ownership to release.
  if (!sync) return () => undefined;
  const objectId = sync.doc.guid;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    release(objectId);
  };
}
