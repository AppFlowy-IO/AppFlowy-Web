import { act, renderHook } from '@testing-library/react';

import { findReusableResult } from '../server-client';
import { useReusableGeneration } from '../useReusableGeneration';

import type { GenerateInput } from '../server-adapter';
import type { JobStatus } from '../server-contract';

jest.mock('../server-client', () => ({ findReusableResult: jest.fn() }));
const job = { id: 'saved-job', state: 'succeeded' } as JobStatus;
const input = (task: 'slides' | 'mindmap'): GenerateInput =>
  ({
    scope: { workspaceId: 'workspace', pageId: 'page' },
    task,
    source: {
      pageId: 'page',
      revision: 'revision',
      serverSource: { sources: [{ pageId: 'page', revision: 'native' }] },
    },
    options: {
      designMode: 'auto',
      slideCountMode: 'auto',
      slideCount: 6,
      includeProperties: true,
      allowWebSearch: false,
    },
    style: { id: 'theme', reviewed: true },
  } as GenerateInput);

beforeAll(() => {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000001',
  });
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(findReusableResult).mockReset().mockResolvedValue(job);
});
afterEach(() => jest.useRealTimers());
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
  });

test.each(['slides', 'mindmap'] as const)(
  '%s immediately hides Open for every generation setting and ignores obsolete replies',
  async (task) => {
    const original = input(task);
    const { result, rerender } = renderHook(({ value }) => useReusableGeneration(value, true, 'actor'), {
      initialProps: { value: original },
    });

    await settle();
    expect(result.current.job).toBe(job);
    const changes: Array<Partial<GenerateInput['options']>> = [
      { allowWebSearch: true },
      { includeProperties: false },
      { slideCountMode: 'fixed', slideCount: 4 },
      { instructions: 'Use my instructions', instructionsEnabled: true },
      { audience: 'Leadership', preconfigure: true },
      { tone: 'professional', preconfigure: true },
      { contentDensity: 'detailed', preconfigure: true },
      { designMode: 'theme' },
      { templateReuse: 'style-only' },
      { layoutPreference: 'comparison' },
      { purpose: 'Explain the roadmap' },
      { reviewOutline: true },
      { preconfigure: true },
      { instructionsEnabled: true },
    ];

    for (const patch of changes) {
      rerender({ value: { ...original, options: { ...original.options, ...patch } } });
      expect(result.current.job).toBeUndefined();
      expect(result.current.checking).toBe(true);
      await settle();
      rerender({ value: original });
      await settle();
    }

    let late!: (value: JobStatus) => void;

    jest.mocked(findReusableResult).mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      })
    );
    rerender({ value: { ...original, source: { ...original.source, revision: 'changed' } } });
    await settle();
    jest.mocked(findReusableResult).mockResolvedValueOnce(null);
    rerender({ value: { ...original, style: { ...original.style!, id: 'another-theme' } } });
    await settle();
    await act(async () => {
      late(job);
    });
    expect(result.current.job).toBeNull();
  }
);
