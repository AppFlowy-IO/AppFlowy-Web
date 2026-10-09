/** @jest-environment node */
import { BackgroundRepairDonor } from '../donor';
import { REPAIR_TIMEOUT_MS, type RepairRequest, type RepairUpdate } from '../types';

function request(index: number): RepairRequest {
  return {
    requestId: `request-${index}`,
    objectId: `object-${index}`,
    collabType: 0,
    stateVector: new Uint8Array([0]),
    maxUpdateBytes: 1024,
    version: undefined,
    databaseId: undefined,
    databaseRestoreId: undefined,
  };
}

const update: RepairUpdate = {
  objectId: 'object',
  collabType: 0,
  payload: new Uint8Array([1]),
  version: undefined,
  databaseRestoreId: undefined,
  beforeStateVector: new Uint8Array([0]),
};

test('global admission limits parallel readers and pending requests across controllers', async () => {
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const read = jest.fn(async () => {
    active++;
    peak = Math.max(active, peak);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return update;
  });
  const first = new BackgroundRepairDonor(read);
  const second = new BackgroundRepairDonor(read);
  const publish = jest.fn(async () => true);
  const jobs = Array.from({ length: 18 }, (_, index) => (index % 2 ? first : second).submit(request(index), publish));

  expect(read).toHaveBeenCalledTimes(2);
  expect(await second.submit(request(30), publish)).toBe('limited');
  expect(await second.submit(request(0), publish)).toBe('duplicate');
  first.dispose();
  second.dispose();
  releases.forEach((release) => release());
  expect(await Promise.all(jobs)).toEqual(Array(18).fill('cancelled'));
  expect(peak).toBe(2);
  expect(publish).not.toHaveBeenCalled();
});

test('deadline aborts a running reader and a new controller can recover capacity', async () => {
  jest.useFakeTimers();
  const read = jest.fn(
    (_request: RepairRequest, signal: AbortSignal) =>
      new Promise<undefined>((resolve) => {
        signal.addEventListener('abort', () => resolve(undefined), { once: true });
      })
  );
  const donor = new BackgroundRepairDonor(read);
  const publish = jest.fn(async () => true);
  const task = donor.submit(request(1), publish);

  await jest.advanceTimersByTimeAsync(REPAIR_TIMEOUT_MS);
  expect(await task).toBe('cancelled');
  expect(publish).not.toHaveBeenCalled();
  donor.dispose();
  const recovered = new BackgroundRepairDonor(async () => update);

  expect(await recovered.submit(request(1), publish)).toBe('sent');
  recovered.dispose();
  jest.useRealTimers();
});

test('one connection deduplicates completed requests and bounds repeated cache misses', async () => {
  const read = jest.fn(async () => undefined);
  const donor = new BackgroundRepairDonor(read);
  const publish = jest.fn(async () => true);

  for (let index = 0; index < 128; index++) expect(await donor.submit(request(index), publish)).toBe('unavailable');
  expect(await donor.submit(request(0), publish)).toBe('duplicate');
  expect(await donor.submit(request(129), publish)).toBe('limited');
  expect(read).toHaveBeenCalledTimes(128);
  expect(publish).not.toHaveBeenCalled();
  donor.dispose();
});
