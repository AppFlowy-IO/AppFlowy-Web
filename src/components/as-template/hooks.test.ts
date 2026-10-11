import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import type { Template } from '@/application/template.type';

import { useLoadTemplate } from './hooks';

const mockGetById = jest.fn<(id: string) => Promise<Template>>();

jest.mock('@/application/services/domains', () => ({
  TemplateService: { getById: (id: string) => mockGetById(id) },
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

beforeEach(() => mockGetById.mockReset());

function template(name: string): Template {
  return {
    view_id: 'template-id', name, description: 'Description', about: 'About',
    view_url: 'https://example.com/published', categories: [], related_templates: [],
    creator: { id: 'creator', name: 'Creator', avatar_url: '' },
    is_new_template: false, is_featured: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });

  return { promise, resolve };
}

test.each([true, false])('only the latest load controls template data and loading state (older finishes first: %s)', async (olderFirst) => {
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
    await act(async () => { older.resolve(template('Stale metadata')); await first; });
    expect(result.current.template).toBeNull();
    expect(result.current.loading).toBe(true);
  }

  await act(async () => { newer.resolve(latest); await second; });
  expect(result.current.template).toEqual(latest);
  expect(result.current.loading).toBe(false);
  if (!olderFirst) {
    await act(async () => { older.resolve(template('Stale metadata')); await first; });
    expect(result.current.template).toEqual(latest);
    expect(result.current.loading).toBe(false);
  }
});
