import { renderHook, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';

import { useViewMeta } from '../useViewMeta';

const view: View = {
  view_id: 'view-id',
  parent_view_id: 'parent-id',
  name: 'Database',
  layout: ViewLayout.Grid,
  children: [],
  icon: null,
  extra: null,
  is_published: false,
  is_private: false,
};

describe('useViewMeta', () => {
  it('does not reload metadata when only the error callback identity changes', async () => {
    const loadViewMeta = jest.fn().mockResolvedValue(view);
    const { result, rerender } = renderHook(
      ({ onNotFound }: { onNotFound: () => void }) =>
        useViewMeta({
          viewId: view.view_id,
          loadViewMeta,
          onNotFound,
        }),
      {
        initialProps: {
          onNotFound: jest.fn(),
        },
      }
    );

    await waitFor(() => {
      expect(loadViewMeta).toHaveBeenCalledTimes(1);
      expect(result.current.viewMeta).toBe(view);
    });

    const stableLoadViewMeta = result.current.loadViewMeta;

    rerender({ onNotFound: jest.fn() });

    expect(result.current.loadViewMeta).toBe(stableLoadViewMeta);
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
  });

  it('does not expose metadata from the previously requested source view', async () => {
    let resolveFirstView: ((value: View) => void) | undefined;
    const firstView = { ...view, view_id: 'first-view' };
    const secondView = { ...view, view_id: 'second-view' };
    const loadViewMeta = jest.fn((viewId: string) => {
      if (viewId === firstView.view_id) {
        return new Promise<View>((resolve) => {
          resolveFirstView = resolve;
        });
      }

      return Promise.resolve(secondView);
    });
    const { result, rerender } = renderHook(
      ({ viewId }: { viewId: string }) =>
        useViewMeta({
          viewId,
          loadViewMeta,
        }),
      { initialProps: { viewId: firstView.view_id } }
    );

    rerender({ viewId: secondView.view_id });

    await waitFor(() => expect(result.current.viewMeta).toBe(secondView));
    resolveFirstView?.(firstView);
    await waitFor(() => expect(loadViewMeta).toHaveBeenCalledWith(firstView.view_id, undefined));
    expect(result.current.viewMeta).toBe(secondView);
  });
});
