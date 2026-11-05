import { OutboxDrainScheduler } from './drain-scheduler';

it('bounds payload readers and cancels queued objects without blocking active cleanup', async () => {
  let active = 0;
  let peak = 0;
  const starts: string[] = [];
  const releases = new Map<string, () => void>();
  let started: () => void = () => undefined;
  const startedTwo = new Promise<void>((resolve) => { started = resolve; });
  let finished: () => void = () => undefined;
  const thirdStarted = new Promise<void>((resolve) => { finished = resolve; });
  const scheduler = new OutboxDrainScheduler({
    concurrency: 2,
    canRun: () => true,
    run: async (id) => {
      starts.push(id);
      peak = Math.max(peak, ++active);
      if (starts.length === 2) started();
      if (starts.length === 3) finished();
      await new Promise<void>((resolve) => { releases.set(id, resolve); });
      active--;
    },
    onError: (_id, error) => { throw error; },
  });

  for (const id of ['a', 'b', 'cancel', 'd']) scheduler.enqueue(id);
  await startedTwo;
  scheduler.cancel('cancel');
  releases.get('a')!();
  await thirdStarted;
  expect(starts).toEqual(['a', 'b', 'd']);
  expect(peak).toBe(2);
  scheduler.clear();
  releases.get('b')!();
  releases.get('d')!();
});
