import { debounce } from 'lodash-es';
import * as Y from 'yjs';

type YjsDeepObserver = Parameters<Y.AbstractType<unknown>['observeDeep']>[0];

export interface LocalFirstObserver extends YjsDeepObserver {
  /** Drop any pending read; call from the effect cleanup. */
  cancel: () => void;
}

/**
 * Wraps a re-read callback for `observeDeep` so the user's own writes show up
 * in the same paint as the interaction that made them, while remote updates,
 * which arrive in bursts, stay debounced.
 *
 * A local transaction schedules the read in a microtask: every transaction in
 * the same call stack (a dropped bar plus the rows that follow it, say) folds
 * into one read, and React flushes the resulting state together with the
 * interaction's own updates, so nothing paints from stale data in between.
 * Local writes that land within `waitMs` of such a read (typing) fall back to
 * the trailing debounce so a burst still costs one read per window.
 */
export function createLocalFirstObserver(read: () => void, waitMs = 150): LocalFirstObserver {
  let cancelled = false;
  let queued = false;
  let lastImmediateReadAt = -Infinity;
  const debounced = debounce(read, waitMs);

  const flush = () => {
    queued = false;
    if (cancelled) return;
    lastImmediateReadAt = Date.now();
    debounced.cancel();
    read();
  };

  const observer = ((_events, transaction) => {
    if (cancelled) return;

    if (!transaction.local || Date.now() - lastImmediateReadAt < waitMs) {
      debounced();
      return;
    }

    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  }) as LocalFirstObserver;

  observer.cancel = () => {
    cancelled = true;
    debounced.cancel();
  };

  return observer;
}
