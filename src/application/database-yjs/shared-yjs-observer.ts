import * as Y from 'yjs';

type YjsDeepObservable = Pick<Y.AbstractType<unknown>, 'observeDeep' | 'unobserveDeep'>;
type YjsDeepObserver = Parameters<YjsDeepObservable['observeDeep']>[0];

type SharedObserverEntry = {
  observer: YjsDeepObserver;
  subscribers: Set<() => void>;
};

const sharedObserverEntries = new WeakMap<YjsDeepObservable, SharedObserverEntry>();

/**
 * Shares one underlying Yjs deep observer across all consumers of the same
 * collaborative type. Each subscriber still receives every change and can
 * unsubscribe independently.
 */
export function subscribeSharedYjsDeep(target: YjsDeepObservable, subscriber: () => void): () => void {
  let entry = sharedObserverEntries.get(target);

  if (!entry) {
    const subscribers = new Set<() => void>();
    const observer: YjsDeepObserver = () => {
      Array.from(subscribers).forEach((notify) => notify());
    };

    entry = { observer, subscribers };
    sharedObserverEntries.set(target, entry);
    target.observeDeep(observer);
  }

  // Wrap the callback so subscribing the same function more than once still
  // produces independent subscriptions and cleanups.
  const notify = () => subscriber();

  entry.subscribers.add(notify);

  let active = true;

  return () => {
    if (!active) return;
    active = false;

    entry?.subscribers.delete(notify);
    if (entry && entry.subscribers.size === 0) {
      target.unobserveDeep(entry.observer);
      sharedObserverEntries.delete(target);
    }
  };
}
