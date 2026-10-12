import { Types } from '@/application/types';

export type UploadPermission = 'allowed' | 'denied' | 'unknown';

/**
 * A permission hint invalidates in-flight positives before it starts another
 * request. Each authenticated mount owns this cache; it is never shared across
 * server/account/workspace changes or reused after logout/login.
 */
export function createUploadPermissionGate(
  probe: (objectId: string, collabType: Types) => Promise<UploadPermission>,
  isCurrent: () => boolean,
  now: () => number = Date.now
) {
  let revision = 0;
  const cache = new Map<string, { revision: number; expires: number; result: Promise<UploadPermission> }>();
  let active = 0;
  const waiting: Array<{ run: () => void; cancel: () => void }> = [];
  const runProbe = (objectId: string, collabType: Types, requestRevision: number): Promise<UploadPermission> =>
    new Promise((resolve) => {
      const work = {
        cancel: () => resolve('unknown'),
        run: () => {
          if (!isCurrent() || requestRevision !== revision) {
            resolve('unknown');
            waiting.shift()?.run();
            return;
          }

          active += 1;
          void probe(objectId, collabType).catch((): UploadPermission => 'unknown').then(resolve).finally(() => {
            active -= 1;
            waiting.shift()?.run();
          });
        },
      };

      if (active < 8) work.run();
      else if (waiting.length < 200) waiting.push(work);
      else resolve('unknown');
    });
  const check = async (objectId: string, collabType: Types): Promise<UploadPermission> => {
    if (!isCurrent()) return 'unknown';
    const requestRevision = revision;
    const key = `${collabType}:${objectId}`;
    let entry = cache.get(key);

    if (!entry || entry.revision !== revision || entry.expires <= now()) {
      const result = runProbe(objectId, collabType, revision);

      entry = { revision, expires: now() + 10_000, result };
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, entry);
    }

    const verdict = await entry.result;

    if (!isCurrent() || requestRevision !== revision) return 'unknown';
    if (verdict === 'unknown' && cache.get(key) === entry) cache.delete(key);
    return verdict;
  };

  return {
    check,
    invalidate() {
      revision += 1;
      cache.clear();
      waiting.splice(0).forEach((work) => work.cancel());
    },
  };
}
