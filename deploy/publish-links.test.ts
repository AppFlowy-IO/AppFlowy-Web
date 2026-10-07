/** @jest-environment node */

import { jest } from '@jest/globals';

import { type PublishedViewRoute } from './api';
import { clearViewRouteCache, MAX_LINK_TARGETS, resolveViewHrefs } from './publish-links';

type FetchRoute = (viewId: string, signal: AbortSignal) => Promise<PublishedViewRoute | null>;

const route = (namespace: string, publishName: string): PublishedViewRoute => ({ namespace, publishName });

const resolve = (viewIds: string[], fetchRoute: FetchRoute, overrides: { timeoutMs?: number; now?: () => number } = {}) =>
  resolveViewHrefs(viewIds, {
    fetchRoute,
    timeoutMs: overrides.timeoutMs ?? 1000,
    isLinkableNamespace: (namespace) => namespace === 'docs' || namespace === 'guide',
    now: overrides.now,
  });

describe('resolveViewHrefs', () => {
  beforeEach(() => {
    clearViewRouteCache();
  });

  it('maps published views to encoded relative URLs', async () => {
    const fetchRoute = jest.fn<FetchRoute>(async (viewId) =>
      viewId === 'a' ? route('docs', 'getting started') : route('guide', 'b/c')
    );

    expect(Object.fromEntries(await resolve(['a', 'b'], fetchRoute))).toEqual({
      a: '/docs/getting%20started',
      b: '/guide/b%2Fc',
    });
  });

  it('omits views that are not published', async () => {
    const hrefs = await resolve(['a'], async () => null);

    expect(hrefs.size).toBe(0);
  });

  it('omits targets in namespaces that are not linkable', async () => {
    const hrefs = await resolve(['a', 'b'], async (viewId) =>
      viewId === 'a' ? route('docs', 'ok') : route('someone-else', 'private')
    );

    expect(Object.fromEntries(hrefs)).toEqual({ a: '/docs/ok' });
  });

  it('omits targets whose lookup fails and keeps the rest', async () => {
    const hrefs = await resolve(['a', 'b'], async (viewId) => {
      if (viewId === 'a') throw new Error('502');

      return route('docs', 'b');
    });

    expect(Object.fromEntries(hrefs)).toEqual({ b: '/docs/b' });
  });

  it('with no time left, links cached targets only and starts no lookups', async () => {
    await resolve(['a'], async () => route('docs', 'a'));

    const fetchRoute = jest.fn<FetchRoute>(async (viewId) => route('docs', viewId));
    const hrefs = await resolve(['a', 'b'], fetchRoute, { timeoutMs: 0 });

    expect(Object.fromEntries(hrefs)).toEqual({ a: '/docs/a' });
    expect(fetchRoute).not.toHaveBeenCalled();
  });

  it('deduplicates and caps the number of lookups', async () => {
    const fetchRoute = jest.fn<FetchRoute>(async (viewId) => route('docs', viewId));
    const ids = Array.from({ length: MAX_LINK_TARGETS + 20 }, (_, i) => `v${i}`);

    const hrefs = await resolve([...ids, ...ids], fetchRoute);

    expect(fetchRoute).toHaveBeenCalledTimes(MAX_LINK_TARGETS);
    expect(hrefs.size).toBe(MAX_LINK_TARGETS);
    expect(hrefs.has(`v${MAX_LINK_TARGETS}`)).toBe(false);
  });

  it('runs at most six lookups at a time', async () => {
    let active = 0;
    let peak = 0;
    const fetchRoute: FetchRoute = async (viewId) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;

      return route('docs', viewId);
    };

    await resolve(Array.from({ length: 20 }, (_, i) => `v${i}`), fetchRoute);

    expect(peak).toBe(6);
  });

  it('returns what resolved by the deadline and aborts the rest', async () => {
    const signals: AbortSignal[] = [];
    const fetchRoute: FetchRoute = (viewId, signal) => {
      signals.push(signal);

      return viewId === 'fast' ? Promise.resolve(route('docs', 'fast')) : new Promise(() => undefined);
    };

    const started = Date.now();
    const hrefs = await resolve(['fast', 'slow'], fetchRoute, { timeoutMs: 50 });

    expect(Object.fromEntries(hrefs)).toEqual({ fast: '/docs/fast' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('starts no new lookups once the deadline has passed', async () => {
    // A lookup that honours its abort signal, like Bun's fetch, and otherwise
    // never answers.
    const fetchRoute = jest.fn<FetchRoute>(
      (_viewId, signal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(new Error('aborted'));
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    await resolve(
      Array.from({ length: 20 }, (_, i) => `v${i}`),
      fetchRoute,
      { timeoutMs: 50 }
    );
    // Let the aborted workers settle before counting.
    await new Promise((r) => setTimeout(r, 10));

    // Only the six in-flight lookups; the remaining queue is left untouched.
    expect(fetchRoute).toHaveBeenCalledTimes(6);
  });

  it('caches results, including "not published", until the TTL expires', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchRoute = jest.fn<FetchRoute>(async (viewId) => (viewId === 'a' ? route('docs', 'a') : null));

    await resolve(['a', 'b'], fetchRoute, { now });
    expect(Object.fromEntries(await resolve(['a', 'b'], fetchRoute, { now }))).toEqual({ a: '/docs/a' });
    expect(fetchRoute).toHaveBeenCalledTimes(2);

    clock = 60_001;
    await resolve(['a', 'b'], fetchRoute, { now });
    expect(fetchRoute).toHaveBeenCalledTimes(4);
  });

  it('evicts the oldest entries beyond 1000, keeping the cache bounded', async () => {
    const fetchRoute = jest.fn<FetchRoute>(async (viewId) => route('docs', viewId));
    const ids = Array.from({ length: 1001 }, (_, i) => `view-${i}`);

    // One call resolves at most MAX_LINK_TARGETS, so fill the cache in batches.
    for (let i = 0; i < ids.length; i += MAX_LINK_TARGETS) {
      await resolve(ids.slice(i, i + MAX_LINK_TARGETS), fetchRoute);
    }

    expect(fetchRoute).toHaveBeenCalledTimes(1001);
    fetchRoute.mockClear();

    // The newest entry is still cached; the very first one was evicted.
    await resolve(['view-1000'], fetchRoute);
    expect(fetchRoute).not.toHaveBeenCalled();

    await resolve(['view-0'], fetchRoute);
    expect(fetchRoute).toHaveBeenCalledWith('view-0', expect.anything());
  });

  it('does not cache transient failures', async () => {
    const fetchRoute = jest
      .fn<FetchRoute>()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(route('docs', 'a'));

    expect((await resolve(['a'], fetchRoute)).size).toBe(0);
    expect(Object.fromEntries(await resolve(['a'], fetchRoute))).toEqual({ a: '/docs/a' });
  });

  it('applies the namespace filter to cached routes too', async () => {
    await resolve(['a'], async () => route('other', 'a'));

    const strict = await resolveViewHrefs(['a'], {
      fetchRoute: async () => route('other', 'a'),
      timeoutMs: 1000,
      isLinkableNamespace: () => false,
    });

    expect(strict.size).toBe(0);
  });

  it('makes no lookups when there are no targets', async () => {
    const fetchRoute = jest.fn<FetchRoute>();

    expect((await resolve([], fetchRoute)).size).toBe(0);
    expect(fetchRoute).not.toHaveBeenCalled();
  });
});
