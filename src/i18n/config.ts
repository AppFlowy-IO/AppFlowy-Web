import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';

type I18nListener = (...args: unknown[]) => void;

/** Marks an emitter whose listeners are already kept in maps: installing twice would drop them. */
const CONSTANT_TIME_LISTENERS = Symbol.for('appflowy.i18n.constantTimeListeners');

/** What an i18next instance exposes of its event emitter. */
interface I18nEmitter {
  [CONSTANT_TIME_LISTENERS]?: true;
  observers: Record<string, unknown>;
  on: (events: string, listener: I18nListener) => unknown;
  off: (event: string, listener?: I18nListener) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

/**
 * Makes removing an i18next listener O(1), as i18next 23.8 does.
 *
 * Every `useTranslation` subscribes to `languageChanged` on mount and
 * unsubscribes on unmount. i18next 22 removes a listener by filtering the
 * event's whole array, so unmounting a view with thousands of cells and rows
 * costs O(n^2): 352 ms on a dashboard's cold open, 229 ms on a return, with
 * 3,908 listeners (W8). The upgrade to i18next 23.8 or later, whose `off` is a
 * `Map.delete`, also changes its TypeScript types, which the repository does
 * not compile against yet; this keeps i18next 22 and stores the listeners the
 * way i18next 23 does: one `Map` per event, from listener to how many times
 * it was added. The behaviour is i18next's: a listener added twice is called
 * twice and removed at once, `off(event)` removes every listener of the event,
 * an emit calls the listeners present when it started, and `*` listeners
 * receive the event name first.
 */
export function installConstantTimeListenerRemoval(emitter: I18nEmitter) {
  if (emitter[CONSTANT_TIME_LISTENERS]) return;
  const observers: Record<string, Map<I18nListener, number>> = {};

  emitter[CONSTANT_TIME_LISTENERS] = true;
  emitter.observers = observers;
  emitter.on = (events, listener) => {
    events.split(' ').forEach((event) => {
      const listeners = observers[event] ?? (observers[event] = new Map());

      listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
    });
    return emitter;
  };

  emitter.off = (event, listener) => {
    if (!observers[event]) return;
    if (!listener) {
      delete observers[event];
      return;
    }

    observers[event].delete(listener);
  };

  emitter.emit = (event, ...args) => {
    const listeners = observers[event];

    if (listeners) {
      Array.from(listeners.entries()).forEach(([listener, times]) => {
        for (let call = 0; call < times; call += 1) listener(...args);
      });
    }

    const wildcard = observers['*'];

    if (wildcard) {
      Array.from(wildcard.entries()).forEach(([listener, times]) => {
        for (let call = 0; call < times; call += 1) listener.apply(listener, [event, ...args]);
      });
    }
  };
}

installConstantTimeListenerRemoval(i18next as unknown as I18nEmitter);

void i18next
  .use(resourcesToBackend((language: string) => import(`../@types/translations/${language}.json`)))
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: 'en',
    defaultNS: 'translation',
    debug: false,
    fallbackLng: 'en',
    cache: {
      enabled: true,
      prefix: `i18next_translation_`,
    },
  });

export const i18nInstance = i18next;
