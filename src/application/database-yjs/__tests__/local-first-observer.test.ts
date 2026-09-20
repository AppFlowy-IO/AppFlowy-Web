import * as Y from 'yjs';

import { createLocalFirstObserver } from '../local-first-observer';

// The global lodash-es mock makes debounce synchronous; these tests are about timing.
jest.mock('lodash-es', () => jest.requireActual('lodash'));

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function localTransaction(observer: ReturnType<typeof createLocalFirstObserver>, local = true) {
  observer([], { local } as Y.Transaction);
}

describe('createLocalFirstObserver', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a local transaction reads in a microtask and folds the same call stack into one read', async () => {
    const read = jest.fn();
    const observer = createLocalFirstObserver(read, 150);

    localTransaction(observer);
    localTransaction(observer);
    localTransaction(observer);
    expect(read).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('remote transactions stay on the trailing debounce', async () => {
    const read = jest.fn();
    const observer = createLocalFirstObserver(read, 150);

    localTransaction(observer, false);
    await flushMicrotasks();
    expect(read).not.toHaveBeenCalled();

    jest.advanceTimersByTime(149);
    expect(read).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('an immediate read supersedes a pending debounced one', async () => {
    const read = jest.fn();
    const observer = createLocalFirstObserver(read, 150);

    localTransaction(observer, false);
    localTransaction(observer);
    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(300);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('local writes right after an immediate read are debounced so a burst costs one read', async () => {
    const read = jest.fn();
    const observer = createLocalFirstObserver(read, 150);

    localTransaction(observer);
    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);
    localTransaction(observer);
    localTransaction(observer);
    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(150);
    expect(read).toHaveBeenCalledTimes(2);

    // Once the window has passed, the next local write is immediate again.
    jest.advanceTimersByTime(200);
    localTransaction(observer);
    await flushMicrotasks();
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('cancel drops both the queued microtask and the debounced read', async () => {
    const read = jest.fn();
    const observer = createLocalFirstObserver(read, 150);

    localTransaction(observer);
    localTransaction(observer, false);
    observer.cancel();
    await flushMicrotasks();
    jest.advanceTimersByTime(300);
    expect(read).not.toHaveBeenCalled();
  });
});
