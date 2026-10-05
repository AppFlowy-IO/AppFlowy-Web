import type { View } from '@/application/types';

import {
  clearPageNameCache,
  getCachedPageName,
  isPageNameLoading,
  isPageNameUnavailable,
  loadPageNames,
  setCachedPageName,
} from '../page-name-cache';

function pendingView() {
  let resolve!: (view: View | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<View | null>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function view(name: string) {
  return { view_id: 'page', name } as View;
}

describe('cell page-name cache request ordering', () => {
  beforeEach(clearPageNameCache);
  afterEach(clearPageNameCache);

  it.each(['success', 'failure'])('keeps accepted metadata after an older lookup %s', async (result) => {
    const response = pendingView();
    const loading = loadPageNames('workspace', ['page'], () => response.promise);

    setCachedPageName('workspace', 'page', 'Renamed');
    if (result === 'success') response.resolve(view('Old'));
    else response.reject(new Error('Old request failed'));
    await loading;

    expect(getCachedPageName('workspace', 'page')).toBe('Renamed');
    expect(isPageNameUnavailable('workspace', 'page')).toBe(false);
  });

  it('shares a pending refresh even while an older name is cached', async () => {
    setCachedPageName('workspace', 'page', 'Old');
    const response = pendingView();
    const loadViewMeta = jest.fn(() => response.promise);
    const refresh = loadPageNames('workspace', ['page'], loadViewMeta, { refresh: true });
    let joined = false;
    const saveLookup = loadPageNames('workspace', ['page'], loadViewMeta).then(() => {
      joined = true;
    });

    await Promise.resolve();
    expect(joined).toBe(false);
    expect(isPageNameLoading('workspace', 'page')).toBe(true);
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
    response.resolve(view('Renamed'));
    await Promise.all([refresh, saveLookup]);
    expect(joined).toBe(true);
    expect(getCachedPageName('workspace', 'page')).toBe('Renamed');
  });

  it('does not let a superseded request remove a replacement refresh', async () => {
    const oldResponse = pendingView();
    const oldLookup = loadPageNames('workspace', ['page'], () => oldResponse.promise);

    setCachedPageName('workspace', 'page', 'Renamed');
    const newResponse = pendingView();
    const newLookup = loadPageNames('workspace', ['page'], () => newResponse.promise, { refresh: true });

    oldResponse.resolve(view('Old'));
    await oldLookup;
    expect(isPageNameLoading('workspace', 'page')).toBe(true);
    expect(getCachedPageName('workspace', 'page')).toBe('Renamed');
    newResponse.resolve(view('Newest'));
    await newLookup;
    expect(isPageNameLoading('workspace', 'page')).toBe(false);
    expect(getCachedPageName('workspace', 'page')).toBe('Newest');
  });
});
