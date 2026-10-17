import { VerificationStore } from '../store';
import { PageVerification, verificationStatus, verificationTooltip } from '../types';
import {
  batchPageVerification,
  getPageVerification,
} from '@/application/services/js-services/http/page-verification-api';

jest.mock('@/application/services/js-services/http/page-verification-api', () => ({
  batchPageVerification: jest.fn(),
  getPageVerification: jest.fn(),
}));
const batch = batchPageVerification as jest.MockedFunction<typeof batchPageVerification>;
const record = {
  id: 'generation-one',
  verified_by: { uid: 1, name: 'Sarah Chen' },
  verified_at: '2026-10-10T00:00:00Z',
  expires_at: '2027-01-08T00:00:00Z',
};
const state: PageVerification = {
  target_id: 'row',
  database_id: 'database',
  property: { id: 'property', database_id: 'database' },
  verification: record,
  status: 'verified',
  can_edit: true,
  eligible: true,
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('canonical verification', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-13T00:00:00Z') });
    batch.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('expires at the boundary, keeps indefinite records active, and formats current audit metadata', () => {
    expect(verificationStatus(record, Date.parse(record.expires_at) - 1)).toBe('verified');
    expect(verificationStatus(record, Date.parse(record.expires_at))).toBe('expired');
    expect(verificationStatus({ ...record, expires_at: null }, Date.parse('2030-01-01'))).toBe('verified');
    expect(verificationTooltip(record, 'en-US', Date.parse('2026-10-13'))).toBe(
      'Verified by Sarah Chen from Oct 10, 2026 to Jan 8, 2027'
    );
    expect(verificationTooltip(record, 'en-US', Date.parse(record.expires_at))).toMatch(
      /^Expired — Verified by Sarah Chen/
    );
  });

  it('coalesces row and document lookup, then renews and removes both aliases immediately', async () => {
    batch.mockResolvedValue({ items: [state], targets: { row: 'row', document: 'row' } });
    const store = new VerificationStore('workspace');
    const offRow = store.subscribe('row', jest.fn());
    const offDocument = store.subscribe('document', jest.fn());
    jest.runAllTicks();
    await flush();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(store.snapshot('document').data?.verification?.verified_by.name).toBe('Sarah Chen');
    store.accept(
      { ...state, verification: { ...record, id: 'new', verified_by: { uid: 2, name: 'John' } } },
      'document'
    );
    expect(store.snapshot('row').data?.verification?.verified_by.name).toBe('John');
    store.accept({ ...state, verification: null, status: 'unverified' }, 'row');
    expect(store.snapshot('document').data?.verification).toBeNull();
    offRow();
    offDocument();
  });

  it('clears all row aliases when a property is deleted, retaining other databases', async () => {
    batch.mockResolvedValue({
      items: [state, { ...state, target_id: 'other', database_id: 'other-db' }],
      targets: { row: 'row', document: 'row', other: 'other' },
    });
    const store = new VerificationStore('workspace');
    const stops = ['row', 'document', 'other'].map((id) => store.subscribe(id, jest.fn()));
    jest.runAllTicks();
    await flush();
    store.invalidateDatabase('database', true);
    expect(store.snapshot('row').data?.property).toBeNull();
    expect(store.snapshot('document').data?.verification).toBeNull();
    expect(store.snapshot('other').data?.verification).toEqual(record);
    stops.forEach((stop) => stop());
  });
  it('does not let a slow read replace a newer renewal', async () => {
    let resolve!: (value: PageVerification) => void;
    (getPageVerification as jest.Mock).mockReturnValue(
      new Promise<PageVerification>((done) => {
        resolve = done;
      })
    );
    const store = new VerificationStore('workspace');
    store.snapshot('row');
    const reading = store.refresh('row');
    store.accept({ ...state, verification: { ...record, id: 'new-generation' } });
    resolve(state);
    await reading;
    expect(store.snapshot('row').data?.verification?.id).toBe('new-generation');
  });

  it('clears cached metadata immediately when permissions are invalidated', () => {
    const store = new VerificationStore('workspace');
    store.snapshot('row');
    store.accept(state);
    store.invalidate(true);
    expect(store.snapshot('row').data).toBeUndefined();
  });
});

describe('async claim invalidation', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-13T00:00:00Z') });
    batch.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('does not let an obsolete batch failure erase an accepted mutation', async () => {
    let reject!: (error: Error) => void;
    batch.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const store = new VerificationStore('workspace');
    const stop = store.subscribe('row', jest.fn());

    jest.runAllTicks();
    store.accept(state);
    reject(new Error('obsolete network error'));
    await flush();
    expect(store.snapshot('row').data?.verification).toEqual(record);
    expect(store.snapshot('row').error).toBeUndefined();
    stop();
  });

  it('publishes unrelated concurrent reads without invalidating each other', async () => {
    const other = { ...state, target_id: 'other' };
    (getPageVerification as jest.Mock).mockImplementation((_workspace, id) => Promise.resolve(id === 'row' ? state : other));
    const store = new VerificationStore('workspace');

    await Promise.all([store.refresh('row'), store.refresh('other')]);
    expect(store.snapshot('row').data?.target_id).toBe('row');
    expect(store.snapshot('other').data?.target_id).toBe('other');
  });

  it('clears claims immediately while a changed property generation reloads', () => {
    const store = new VerificationStore('workspace');

    store.accept(state);
    store.invalidateDatabase('database');
    expect(store.snapshot('row').data).toBeUndefined();
    expect(store.snapshot('row').loading).toBe(true);
  });

  it('does not expire fractional-millisecond claims before the boundary', () => {
    const expiry = { ...record, expires_at: '2026-10-13T00:00:00.000123Z' };

    expect(verificationStatus(expiry, Date.parse('2026-10-13T00:00:00Z'))).toBe('verified');
    expect(verificationStatus(expiry, Date.parse('2026-10-13T00:00:00Z') + 1)).toBe('expired');
  });
});

it('revokes dormant claims and ignores a read completing after its last subscriber left', async () => {
  let resolve!: (value: PageVerification) => void;
  (getPageVerification as jest.Mock).mockReturnValue(new Promise<PageVerification>((done) => { resolve = done; }));
  batch.mockResolvedValue({ items: [], targets: {} });
  const store = new VerificationStore('workspace');
  const stop = store.subscribe('row', jest.fn());

  store.accept(state);
  const reading = store.refresh('row');

  stop();
  expect(store.snapshot('row').data).toBeUndefined();
  resolve(state);
  await reading;
  expect(store.snapshot('row').data).toBeUndefined();
});

it('does not reuse a removed cache entry authorization epoch after eviction', async () => {
  let resolve!: (value: PageVerification) => void;
  (getPageVerification as jest.Mock).mockReturnValue(new Promise<PageVerification>((done) => { resolve = done; }));
  batch.mockResolvedValue({ items: [], targets: {} });
  const store = new VerificationStore('workspace');
  const stop = store.subscribe('row', jest.fn());
  const reading = store.refresh('row');

  for (let i = 0; i < 1000; i++) store.snapshot(`inactive-${i}`);
  stop();
  // The bounded cache evicted the old entry; a new object starts at epoch zero.
  expect(store.snapshot('row').data).toBeUndefined();
  resolve(state);
  await reading;
  expect(store.snapshot('row').data).toBeUndefined();
});

it('a second consumer joins an existing in-flight request', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
  batch.mockReset();
  let resolve!: (value: unknown) => void;
  batch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  batch.mockResolvedValue({ items: [], targets: {} });
  const store = new VerificationStore('review-workspace');
  const first = store.subscribe('row', () => undefined);
  let second: () => void = () => undefined;
  try {
    jest.runAllTicks();
    expect(batch).toHaveBeenCalledTimes(1);
    second = store.subscribe('row', () => undefined);
    resolve({ items: [state], targets: { row: 'row' } });
    await flush();
    expect(batch).toHaveBeenCalledTimes(1);
  } finally { first(); second(); jest.useRealTimers(); }
});

it('slow response is not queued again by the polling timer', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
  batch.mockReset();
  batch.mockReset();
  let resolve!: (value: unknown) => void;
  batch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  batch.mockResolvedValue({ items: [], targets: {} });
  const store = new VerificationStore('review-workspace');
  const stop = store.subscribe('row', () => undefined);
  try {
    jest.runAllTicks();
    expect(batch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1100);
    resolve({ items: [state], targets: { row: 'row' } });
    await flush();
    expect(batch).toHaveBeenCalledTimes(1);
  } finally { stop(); jest.useRealTimers(); }
});

describe('claim mutation ordering', () => {
  beforeEach(() => {
    batch.mockReset();
    batch.mockResolvedValue({ items: [], targets: {} });
    (getPageVerification as jest.Mock).mockReset();
  });

  it('rejects a delayed renewal after a newer removal, including row/document aliases', () => {
    const store = new VerificationStore('workspace');

    store.accept(state, 'document');
    store.accept(state, 'row');
    const version = store.claimVersion('document');

    store.accept({ ...state, verification: null, status: 'unverified' }, 'row');
    expect(store.acceptMutation(state, 'document', version)).toBe(false);
    expect(store.snapshot('document').data?.verification).toBeNull();
    expect(store.snapshot('row').data?.verification).toBeNull();
  });

  it('rejects an old reply even after a claim changes back to its original empty state', () => {
    const store = new VerificationStore('workspace');
    const unverified: PageVerification = { ...state, verification: null, status: 'unverified' };

    store.accept(unverified);
    const version = store.claimVersion('row');

    store.accept(state);
    store.accept(unverified);
    expect(store.acceptMutation(state, 'row', version)).toBe(false);
    expect(store.snapshot('row').data?.verification).toBeNull();
  });

  it('keeps unrelated changes and identical reads from canceling a current mutation', async () => {
    const store = new VerificationStore('workspace');

    store.accept(state);
    const version = store.claimVersion('row');

    store.accept({ ...state, target_id: 'other' });
    (getPageVerification as jest.Mock).mockResolvedValue({ ...state, verification: { ...record } });
    await store.refresh('row');
    expect(store.claimVersion('row')).toBe(version);
    expect(store.acceptMutation({ ...state, verification: null, status: 'unverified' }, 'row', version)).toBe(true);
  });

  it('rejects a pending mutation when a read observes a newer claim', async () => {
    const store = new VerificationStore('workspace');
    const renewed = { ...state, verification: { ...record, id: 'renewed' } };

    store.accept(state);
    const version = store.claimVersion('row');

    (getPageVerification as jest.Mock).mockResolvedValue(renewed);
    await store.refresh('row');
    expect(store.acceptMutation({ ...state, verification: null, status: 'unverified' }, 'row', version)).toBe(false);
    expect(store.snapshot('row').data?.verification?.id).toBe('renewed');
  });

  it('revokes mutation versions when permission snapshots are invalidated', () => {
    const store = new VerificationStore('workspace');

    store.accept(state);
    const version = store.claimVersion('row');

    store.invalidate(true);
    expect(store.acceptMutation(state, 'row', version)).toBe(false);
    expect(store.snapshot('row').data).toBeUndefined();
  });
});

it.each(['invalidate', 'reopen'])('fetches a fresh snapshot after %s during an in-flight read', async (action) => {
  jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') });
  batch.mockReset();
  let finish!: (value: unknown) => void;
  const renewed = { ...state, verification: { ...record, id: 'renewed' } };

  batch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  batch.mockResolvedValue({ items: [renewed], targets: { row: 'row' } });
  const store = new VerificationStore('workspace');
  let stop = store.subscribe('row', jest.fn());

  try {
    jest.runAllTicks();
    if (action === 'invalidate') store.invalidate(true);
    else {
      stop();
      stop = store.subscribe('row', jest.fn());
    }

    finish({ items: [state], targets: { row: 'row' } });
    await flush();
    expect(batch).toHaveBeenCalledTimes(2);
    expect(store.snapshot('row').data?.verification?.id).toBe('renewed');
  } finally { stop(); jest.useRealTimers(); }
});
