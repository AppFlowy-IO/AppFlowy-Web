import i18next from 'i18next';

import { i18nInstance, installConstantTimeListenerRemoval } from '../config';

// The app's translations load lazily; these tests only exercise the event emitter.
jest.mock('i18next-resources-to-backend', () => () => ({
  type: 'backend',
  init: () => undefined,
  read: (_language: string, _namespace: string, callback: (error: unknown, data: object) => void) => callback(null, {}),
}));

type Emitter = Parameters<typeof installConstantTimeListenerRemoval>[0];

function createEmitter(): Emitter {
  const instance = i18next.createInstance() as unknown as Emitter;

  installConstantTimeListenerRemoval(instance);
  return instance;
}

function listenerCount(emitter: Emitter, event: string) {
  const listeners = emitter.observers[event] as Map<unknown, number> | undefined;

  return listeners ? Array.from(listeners.values()).reduce((sum, times) => sum + times, 0) : 0;
}

describe('i18next listeners (W8)', () => {
  it('subscribes and unsubscribes 10,000 languageChanged listeners in under 50 ms', () => {
    const emitter = createEmitter();
    const listeners = Array.from({ length: 10_000 }, () => () => undefined);
    const startedAt = performance.now();

    listeners.forEach((listener) => emitter.on('languageChanged', listener));
    listeners.forEach((listener) => emitter.off('languageChanged', listener));

    const elapsedMs = performance.now() - startedAt;

    expect(listenerCount(emitter, 'languageChanged')).toBe(0);
    expect(elapsedMs).toBeLessThan(50);
  });

  it('is installed on the app instance, which react-i18next subscribes to', () => {
    const listener = jest.fn();
    const before = listenerCount(i18nInstance as unknown as Emitter, 'languageChanged');

    i18nInstance.on('languageChanged', listener);
    expect((i18nInstance as unknown as Emitter).observers.languageChanged).toBeInstanceOf(Map);
    expect(listenerCount(i18nInstance as unknown as Emitter, 'languageChanged')).toBe(before + 1);

    (i18nInstance as unknown as Emitter).emit('languageChanged', 'de');
    expect(listener).toHaveBeenCalledWith('de');

    i18nInstance.off('languageChanged', listener);
    expect(listenerCount(i18nInstance as unknown as Emitter, 'languageChanged')).toBe(before);
  });

  it('keeps i18next semantics: a listener added twice runs twice and is removed at once', () => {
    const emitter = createEmitter();
    const listener = jest.fn();

    emitter.on('languageChanged', listener);
    emitter.on('languageChanged', listener);
    emitter.emit('languageChanged', 'fr');
    expect(listener).toHaveBeenCalledTimes(2);

    emitter.off('languageChanged', listener);
    emitter.emit('languageChanged', 'fr');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('subscribes to several space-separated events and removes every listener of an event without one', () => {
    const emitter = createEmitter();
    const first = jest.fn();
    const second = jest.fn();

    emitter.on('loaded languageChanged', first);
    emitter.on('languageChanged', second);
    emitter.emit('loaded', true);
    expect(first).toHaveBeenCalledWith(true);

    emitter.off('languageChanged');
    emitter.emit('languageChanged', 'ja');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('calls the listeners present when an emit starts, and gives * listeners the event name first', () => {
    const emitter = createEmitter();
    const late = jest.fn();
    const removed = jest.fn();
    const wildcard = jest.fn();

    emitter.on('languageChanged', () => {
      emitter.on('languageChanged', late);
      emitter.off('languageChanged', removed);
    });
    emitter.on('languageChanged', removed);
    emitter.on('*', wildcard);
    emitter.emit('languageChanged', 'es', 'extra');

    expect(late).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith('es', 'extra');
    expect(wildcard).toHaveBeenCalledWith('languageChanged', 'es', 'extra');
  });

  it('keeps the listeners when installed twice, as a module re-run would', () => {
    const emitter = createEmitter();
    const listener = jest.fn();

    emitter.on('languageChanged', listener);
    installConstantTimeListenerRemoval(emitter);
    emitter.emit('languageChanged', 'it');
    expect(listener).toHaveBeenCalledWith('it');
  });

  it('returns the emitter from on, so subscriptions chain', () => {
    const emitter = createEmitter();

    expect(emitter.on('languageChanged', () => undefined)).toBe(emitter);
  });
});
