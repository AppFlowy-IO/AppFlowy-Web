import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import type { Template } from '@/application/template.type';

import { useLoadCategoryTemplates, useLoadTemplate } from './hooks';

const mockGetAll = jest.fn<() => Promise<Template[]>>();
const mockNotifyError = jest.fn();

const mockGetById = jest.fn<(id: string) => Promise<Template>>();

jest.mock('@/application/services/domains', () => ({
  TemplateService: { getById: (id: string) => mockGetById(id), getAll: () => mockGetAll() },
}));
jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));

beforeEach(() => {
  mockGetById.mockReset();
  mockGetAll.mockReset();
  mockNotifyError.mockReset();
});

function template(name: string): Template {
  return {
    view_id: 'template-id',
    name,
    description: 'Description',
    about: 'About',
    view_url: 'https://example.com/published',
    categories: [],
    related_templates: [],
    creator: { id: 'creator', name: 'Creator', avatar_url: '' },
    is_new_template: false,
    is_featured: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });

  return { promise, resolve, reject };
}

test.each([true, false])(
  'only the latest load controls template data and loading state (older finishes first: %s)',
  async (olderFirst) => {
    const older = deferred<Template>();
    const newer = deferred<Template>();
    const latest = template('Latest saved metadata');

    mockGetById.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useLoadTemplate('template-id'));
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.loadTemplate();
      second = result.current.loadTemplate();
    });
    if (olderFirst) {
      await act(async () => {
        older.resolve(template('Stale metadata'));
        await first;
      });
      expect(result.current.template).toBeNull();
      expect(result.current.loading).toBe(true);
    }

    await act(async () => {
      newer.resolve(latest);
      await second;
    });
    expect(result.current.template).toEqual(latest);
    expect(result.current.loading).toBe(false);
    if (!olderFirst) {
      await act(async () => {
        older.resolve(template('Stale metadata'));
        await first;
      });
      expect(result.current.template).toEqual(latest);
      expect(result.current.loading).toBe(false);
    }
  }
);

test.each([true, false])(
  'only the latest category search controls results and loading (older finishes first: %s)',
  async (olderFirst) => {
    const older = deferred<Template[]>();
    const newer = deferred<Template[]>();
    const latest = [template('Project')];

    mockGetAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useLoadCategoryTemplates());
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.loadCategoryTemplates('category', 'pro');
      second = result.current.loadCategoryTemplates('category', 'project');
    });
    if (olderFirst) {
      await act(async () => {
        older.resolve([template('Old')]);
        await first;
      });
      expect(result.current.templates).toEqual([]);
      expect(result.current.loading).toBe(true);
    }

    await act(async () => {
      newer.resolve(latest);
      await second;
    });
    expect(result.current.templates).toEqual(latest);
    expect(result.current.loading).toBe(false);
    if (!olderFirst) {
      await act(async () => {
        older.resolve([template('Old')]);
        await first;
      });
      expect(result.current.templates).toEqual(latest);
    }
  }
);

test('ignores an old category search failure while the current query is pending', async () => {
  const older = deferred<Template[]>();
  const newer = deferred<Template[]>();

  mockGetAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() => useLoadCategoryTemplates());
  let first!: Promise<void>;
  let second!: Promise<void>;

  act(() => {
    first = result.current.loadCategoryTemplates('category', 'pro');
    second = result.current.loadCategoryTemplates('category', 'project');
  });
  await act(async () => {
    older.reject(new Error('old failure'));
    await first;
  });
  expect(mockNotifyError).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(true);
  await act(async () => {
    newer.resolve([template('Project')]);
    await second;
  });
  expect(result.current.templates).toEqual([template('Project')]);
});

test('does not notify about category searches that fail after unmount', async () => {
  const pending = deferred<Template[]>();

  mockGetAll.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useLoadCategoryTemplates());
  let request!: Promise<void>;

  act(() => {
    request = result.current.loadCategoryTemplates('category', 'pro');
  });
  unmount();
  await act(async () => {
    pending.reject(new Error('late failure'));
    await request;
  });
  expect(mockNotifyError).not.toHaveBeenCalled();
});

test('reports the current category search failure without leaving a rejected UI promise', async () => {
  mockGetAll.mockRejectedValueOnce(new Error('current failure'));
  const { result } = renderHook(() => useLoadCategoryTemplates());

  await act(async () => {
    await result.current.loadCategoryTemplates('category', 'pro');
  });
  expect(mockNotifyError).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(false);
});
