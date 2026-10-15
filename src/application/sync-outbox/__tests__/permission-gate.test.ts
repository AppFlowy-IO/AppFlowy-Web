import { Types } from '@/application/types';

import { createUploadPermissionGate, UploadPermission } from '../permission-gate';

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('upload permission revisions', () => {
  it('coalesces current requests and bounds cached grants to ten seconds', async () => {
    let now = 0;
    const probe = jest.fn(async (): Promise<UploadPermission> => 'allowed');
    const gate = createUploadPermissionGate(probe, () => true, () => now);

    expect(await Promise.all([gate.check('database', Types.Database), gate.check('database', Types.Database)]))
      .toEqual(['allowed', 'allowed']);
    expect(probe).toHaveBeenCalledTimes(1);
    now = 10_001;
    await gate.check('database', Types.Database);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('a same-context hint fences a late positive before a newer denial', async () => {
    let resolve!: (value: UploadPermission) => void;
    const probe = jest.fn().mockImplementationOnce(() => new Promise<UploadPermission>((done) => { resolve = done; }))
      .mockResolvedValue('denied');
    const gate = createUploadPermissionGate(probe, () => true);
    const old = gate.check('row', Types.DatabaseRow);

    gate.invalidate();
    expect(await gate.check('row', Types.DatabaseRow)).toBe('denied');
    resolve('allowed');
    expect(await old).toBe('unknown');
    expect(await gate.check('row', Types.DatabaseRow)).toBe('denied');
  });

  it('never uses a grant from a previous authenticated scope', async () => {
    let live = true;
    let resolve!: (value: UploadPermission) => void;
    const gate = createUploadPermissionGate(() => new Promise((done) => { resolve = done; }), () => live);
    const result = gate.check('page', Types.Document);

    live = false;
    resolve('allowed');
    expect(await result).toBe('unknown');
    expect(await gate.check('page', Types.Document)).toBe('unknown');
  });

  it('bounds distinct-object probes to eight in flight and 200 queued without weakening denial', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((done) => { release = done; });
    let active = 0;
    let peak = 0;
    const probe = jest.fn(async (): Promise<UploadPermission> => {
      active += 1;
      peak = Math.max(peak, active);
      await barrier;
      active -= 1;
      return 'denied';
    });
    const gate = createUploadPermissionGate(probe, () => true);
    const results = Array.from({length: 250}, (_, i) => gate.check(`row-${i}`, Types.DatabaseRow));

    expect(probe).toHaveBeenCalledTimes(8);
    release();
    const verdicts = await Promise.all(results);

    expect(peak).toBe(8);
    expect(probe).toHaveBeenCalledTimes(208);
    expect(verdicts.filter((value) => value === 'denied')).toHaveLength(208);
    expect(verdicts.filter((value) => value === 'unknown')).toHaveLength(42);
  });

  it('cancels queued stale work immediately when a revision changes', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((done) => { release = done; });
    const probe = jest.fn(async (): Promise<UploadPermission> => { await barrier; return 'allowed'; });
    const gate = createUploadPermissionGate(probe, () => true);
    const requests = Array.from({length: 40}, (_, i) => gate.check(`row-${i}`, Types.DatabaseRow));

    gate.invalidate();
    expect(await Promise.all(requests.slice(8))).toEqual(Array(32).fill('unknown'));
    expect(probe).toHaveBeenCalledTimes(8);
    release();
    expect(await Promise.all(requests.slice(0, 8))).toEqual(Array(8).fill('unknown'));
  });

  it('does not cache a transient failure as a denial or grant', async () => {
    const probe = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('allowed');
    const gate = createUploadPermissionGate(probe, () => true);

    expect(await gate.check('page', Types.Document)).toBe('unknown');
    expect(await gate.check('page', Types.Document)).toBe('allowed');
  });

  it('peeks only a settled current verdict and refreshes a grant shortly before it expires', async () => {
    let now = 0;
    let verdict: UploadPermission = 'allowed';
    const probe = jest.fn(async (): Promise<UploadPermission> => verdict);
    const gate = createUploadPermissionGate(probe, () => true, () => now);

    expect(gate.peek('page', Types.Document)).toBeUndefined();
    const pending = gate.check('page', Types.Document);

    expect(gate.peek('page', Types.Document)).toBeUndefined();
    await pending;
    expect(gate.peek('page', Types.Document)).toBe('allowed');
    expect(probe).toHaveBeenCalledTimes(1);

    // Close to expiry, a peek refreshes in the background and keeps answering.
    now = 8_000;
    verdict = 'denied';
    expect(gate.peek('page', Types.Document)).toBe('allowed');
    expect(probe).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(gate.peek('page', Types.Document)).toBe('denied');
    now = 18_001;
    expect(gate.peek('page', Types.Document)).toBeUndefined();
    gate.invalidate();
    expect(gate.peek('page', Types.Document)).toBeUndefined();
  });

  it('keeps a valid grant when its background refresh cannot complete', async () => {
    let now = 0;
    const probe = jest.fn().mockResolvedValueOnce('allowed').mockRejectedValueOnce(new Error('offline'));
    const gate = createUploadPermissionGate(probe, () => true, () => now);

    await gate.check('page', Types.Document);
    now = 9_000;
    expect(gate.peek('page', Types.Document)).toBe('allowed');
    await flushMicrotasks();
    expect(gate.peek('page', Types.Document)).toBe('allowed');
    now = 10_000;
    expect(gate.peek('page', Types.Document)).toBeUndefined();
  });

  it('expire drops cached verdicts without discarding a check in progress', async () => {
    let resolve!: (value: UploadPermission) => void;
    const probe = jest.fn().mockImplementationOnce(() => new Promise<UploadPermission>((done) => { resolve = done; }))
      .mockResolvedValue('allowed');
    const gate = createUploadPermissionGate(probe, () => true);
    const inFlight = gate.check('page', Types.Document);

    gate.expire();
    resolve('allowed');
    expect(await inFlight).toBe('allowed');
    gate.expire();
    expect(gate.peek('page', Types.Document)).toBeUndefined();
    expect(await gate.check('page', Types.Document)).toBe('allowed');
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
