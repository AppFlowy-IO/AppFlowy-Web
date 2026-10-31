import { act, render, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import type { View, YDoc } from '@/application/types';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { usePageReferenceMetadata } from '@/components/editor/components/leaf/mention/usePageReferenceMetadata';
import { type EditorContextState, useEditorContext } from '@/components/editor/EditorContext';

import DocumentContentProvider from '../DocumentContentProvider';

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEventEmitterOptional: () => undefined,
}));

const page = { view_id: 'page', name: 'Roadmap' } as View;

function Host({
  operations,
  onNavigate,
  children,
}: {
  operations: Partial<AppOperationsContextType>;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <AppOperationsContext.Provider value={operations as AppOperationsContextType}>
      <DocumentContentProvider onNavigate={onNavigate}>{children}</DocumentContentProvider>
    </AppOperationsContext.Provider>
  );
}

const provider = (operations: Partial<AppOperationsContextType>) =>
  function Provider({ children }: { children: React.ReactNode }) {
    return <Host operations={operations}>{children}</Host>;
  };

function context(operations: Partial<AppOperationsContextType>) {
  return renderHook(() => useEditorContext(), { wrapper: provider(operations) }).result.current;
}

test('a mention Retry after a failed lookup reaches the loader instead of replaying the failure', async () => {
  const loadViewMeta = jest.fn().mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValue(page);
  const { result } = renderHook(
    () => usePageReferenceMetadata({ pageId: 'page', loadViewMeta: useEditorContext().loadViewMeta }),
    { wrapper: provider({ loadViewMeta }) }
  );

  await waitFor(() => expect(result.current.error).toBe('load_failed'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.view).toBe(page));
  expect(result.current.error).toBeNull();
  expect(loadViewMeta.mock.calls).toEqual([
    ['page', undefined, { metadataOnly: true }],
    ['page', undefined, { metadataOnly: true, authoritative: true }],
  ]);
});

test('lookups share one request, forward change callbacks and let an authoritative answer replace it', async () => {
  const fresh = { ...page, name: 'Renamed roadmap' };
  const loadViewMeta = jest.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(fresh);
  const { loadViewMeta: load } = context({ loadViewMeta });
  const first = jest.fn();
  const second = jest.fn();

  await expect(load!('page', first)).resolves.toBe(page);
  expect(loadViewMeta).toHaveBeenLastCalledWith('page', first, { metadataOnly: true });
  await expect(load!('page', second)).resolves.toBe(page);
  expect(second).toHaveBeenCalledWith(page);
  expect(loadViewMeta).toHaveBeenCalledTimes(1);
  await expect(load!('page', undefined, { authoritative: true })).resolves.toBe(fresh);
  await expect(load!('page')).resolves.toBe(fresh);
  expect(loadViewMeta).toHaveBeenCalledTimes(2);
});

test('a failed document load is retried by the next reader; a loaded document is shared', async () => {
  const doc = {} as YDoc;
  const loadView = jest.fn().mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValue(doc);
  const { loadView: load } = context({ loadView });

  await expect(load!('page')).rejects.toThrow('Server unavailable');
  await expect(load!('page')).resolves.toBe(doc);
  await expect(load!('page')).resolves.toBe(doc);
  expect(loadView).toHaveBeenCalledTimes(2);
});

test('navigation keeps one editor context across host renders and closes with the latest callback', async () => {
  const toView = jest.fn().mockResolvedValue(undefined);
  const operations = { toView };
  const contexts: EditorContextState[] = [];
  const first = jest.fn();
  const second = jest.fn();
  const Probe = () => {
    contexts.push(useEditorContext());
    return null;
  };

  const { rerender } = render(
    <Host operations={operations} onNavigate={first}>
      <Probe />
    </Host>
  );

  // A host re-render passes a fresh close callback.
  rerender(
    <Host operations={operations} onNavigate={second}>
      <Probe />
    </Host>
  );
  expect(contexts).toHaveLength(2);
  expect(contexts[1]).toBe(contexts[0]);
  await contexts[1].navigateToView!('target', 'block');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(toView).toHaveBeenCalledWith('target', 'block');
});
