/**
 * The mention modules that hold the signed-in account's pages, people and texts (the local index,
 * the search cache, the local lane's picks and the ranker's prepared texts) forget them when the
 * session ends (`SESSION_INVALID`, which sign-out emits too), all through one listener: the session
 * emitter warns once an event has more than ten (`events`), and the app's other caches hold most
 * of `SESSION_INVALID`'s.
 */
import { EventType, on } from '@/application/session/event';

const clears: (() => void)[] = [];

/** Calls `clear` whenever the session ends, after the clears added before it. */
export function onMentionSessionInvalid(clear: () => void) {
  clears.push(clear);
}

on(EventType.SESSION_INVALID, () => {
  clears.forEach((clear) => clear());
});
