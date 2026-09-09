import EventEmitter from 'events';

import { APP_EVENTS } from '@/application/constants';

import { CollabDocResetPayload } from './types';

type ResetCallback = (payload: CollabDocResetPayload) => void;
type ResetSubscriptionEntry = {
  callbacks: Set<ResetCallback>;
  handler: (payload: CollabDocResetPayload) => void;
};

const resetSubscriptions = new WeakMap<EventEmitter, ResetSubscriptionEntry>();

/** Share one reset listener across mounted editors and Feed previews. */
export function subscribeCollabDocReset(eventEmitter: EventEmitter, callback: ResetCallback) {
  let entry = resetSubscriptions.get(eventEmitter);

  if (!entry) {
    entry = {
      callbacks: new Set(),
      handler: (payload) => {
        entry?.callbacks.forEach((cb) => cb(payload));
      },
    };
    resetSubscriptions.set(eventEmitter, entry);
    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, entry.handler);
  }

  entry.callbacks.add(callback);

  return () => {
    const current = resetSubscriptions.get(eventEmitter);

    if (!current) return;

    current.callbacks.delete(callback);

    if (current.callbacks.size === 0) {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, current.handler);
      resetSubscriptions.delete(eventEmitter);
    }
  };
}
