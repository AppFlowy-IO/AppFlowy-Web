import { createCoalescedRefresh } from '../coalesced-refresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

test('a held read and one thousand refreshes keep only the latest queued read', async () => {
  const refresh = createCoalescedRefresh<number>();
  const active = deferred<number>();
  const first = jest.fn(() => active.promise);
  const pending = jest.fn(async (value: number) => value);
  const completion = refresh(first);

  await Promise.resolve();
  for (let value = 1; value <= 1000; value += 1) {
    expect(refresh(() => pending(value))).toBe(completion);
  }

  expect(first).toHaveBeenCalledTimes(1);
  expect(pending).not.toHaveBeenCalled();
  active.resolve(0);
  await expect(completion).resolves.toBe(1000);
  expect(pending).toHaveBeenCalledTimes(1);
  expect(pending).toHaveBeenCalledWith(1000);
});

test('a superseded failure still runs the pending refresh and returns its result', async () => {
  const refresh = createCoalescedRefresh<number>();
  const active = deferred<number>();
  const completion = refresh(() => active.promise);

  await Promise.resolve();
  expect(refresh(async () => 2)).toBe(completion);
  active.reject(new Error('obsolete request failed'));
  await expect(completion).resolves.toBe(2);
});

test('the final failure is reported and the queue accepts a later retry', async () => {
  const refresh = createCoalescedRefresh<number>();
  const failure = new Error('current request failed');

  await expect(
    refresh(async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  await expect(refresh(async () => 3)).resolves.toBe(3);
});

test('a refresh requested during result handling is not lost', async () => {
  const refresh = createCoalescedRefresh<number>();
  const completion = refresh(async () => 1);

  await expect(completion.then(() => refresh(async () => 2))).resolves.toBe(2);
});
