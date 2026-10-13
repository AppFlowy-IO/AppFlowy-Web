import { Types } from '@/application/types';

export type UploadPermission = 'allowed' | 'denied' | 'unknown';

const VERDICT_TTL_MS = 10_000;
// A grant used this close to expiry is re-checked in the background, so steady
// typing keeps a fresh verdict instead of waiting for a check every ten seconds.
const REFRESH_AHEAD_MS = 3_000;
const MAX_ACTIVE_PROBES = 8;
const MAX_QUEUED_PROBES = 200;
const MAX_CACHED_VERDICTS = 200;

type CacheEntry = {
  revision: number;
  expires: number;
  result: Promise<UploadPermission>;
  /** Set once `result` settles. */
  settled?: UploadPermission;
  refreshing?: boolean;
};

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
  const cache = new Map<string, CacheEntry>();
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
          let request: Promise<UploadPermission>;

          try {
            request = Promise.resolve(probe(objectId, collabType));
          } catch {
            request = Promise.resolve('unknown');
          }

          void request
            .then((verdict): UploadPermission => (verdict === 'allowed' || verdict === 'denied' ? verdict : 'unknown'))
            .catch((): UploadPermission => 'unknown')
            .then(resolve)
            .finally(() => {
              active -= 1;
              waiting.shift()?.run();
            });
        },
      };

      if (active < MAX_ACTIVE_PROBES) work.run();
      else if (waiting.length < MAX_QUEUED_PROBES) waiting.push(work);
      else resolve('unknown');
    });
  const startEntry = (objectId: string, collabType: Types): CacheEntry => {
    const entry: CacheEntry = {
      revision,
      expires: now() + VERDICT_TTL_MS,
      result: runProbe(objectId, collabType, revision),
    };

    void entry.result.then((verdict) => {
      entry.settled = verdict;
    });
    return entry;
  };

  const store = (key: string, entry: CacheEntry) => {
    if (!cache.has(key) && cache.size >= MAX_CACHED_VERDICTS) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  };

  const isFresh = (entry: CacheEntry | undefined): entry is CacheEntry =>
    Boolean(entry && entry.revision === revision && entry.expires > now());
  const check = async (objectId: string, collabType: Types): Promise<UploadPermission> => {
    if (!isCurrent()) return 'unknown';
    const requestRevision = revision;
    const key = `${collabType}:${objectId}`;
    let entry = cache.get(key);

    if (!isFresh(entry)) {
      entry = startEntry(objectId, collabType);
      store(key, entry);
    }

    const verdict = await entry.result;

    if (!isCurrent() || requestRevision !== revision) return 'unknown';
    if (verdict === 'unknown' && cache.get(key) === entry) cache.delete(key);
    return verdict;
  };

  // Synchronous read of a settled, current verdict. A grant close to expiry is
  // refreshed in the background; a failed refresh keeps it until it expires.
  const peek = (objectId: string, collabType: Types): UploadPermission | undefined => {
    if (!isCurrent()) return undefined;
    const key = `${collabType}:${objectId}`;
    const entry = cache.get(key);

    if (!isFresh(entry) || entry.settled === undefined || entry.settled === 'unknown') return undefined;
    // One background refresh per grant: a failed one is not repeated per keystroke.
    if (entry.settled === 'allowed' && !entry.refreshing && entry.expires - now() <= REFRESH_AHEAD_MS) {
      const replacement = startEntry(objectId, collabType);

      entry.refreshing = true;
      void replacement.result.then((verdict) => {
        if (verdict !== 'unknown' && replacement.revision === revision && cache.get(key) === entry) {
          store(key, replacement);
        }
      });
    }

    return entry.settled;
  };

  return {
    check,
    peek,
    /** A permission change: discard cached and in-flight results. */
    invalidate() {
      revision += 1;
      cache.clear();
      waiting.splice(0).forEach((work) => work.cancel());
    },
    /** Re-check on next use, keeping checks already in flight. */
    expire() {
      cache.clear();
    },
  };
}
