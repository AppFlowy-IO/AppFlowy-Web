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
    });

    const stableLoadViewMeta = result.current.loadViewMeta;

    rerender({ onNotFound: jest.fn() });

    expect(result.current.loadViewMeta).toBe(stableLoadViewMeta);
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
  });
});
