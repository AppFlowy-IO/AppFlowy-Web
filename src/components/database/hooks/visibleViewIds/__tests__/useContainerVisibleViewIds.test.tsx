import { expect } from '@jest/globals';
import { renderHook } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import { useContainerVisibleViewIds } from '@/components/database/hooks/visibleViewIds/useContainerVisibleViewIds';

function createView(overrides: Partial<View> & { view_id: string }): View {
  return {
    name: overrides.view_id,
    icon: null,
    layout: ViewLayout.Grid,
    extra: { is_space: false, database_id: 'db-1' },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

const gridView = createView({ view_id: 'grid-view', parent_view_id: 'container' });
const ownedBoardView = createView({
  view_id: 'owned-board-view',
  parent_view_id: 'container',
  layout: ViewLayout.Board,
  extra: { is_space: false, database_id: 'db-1', dashboard_owner: 'dashboard-view' },
});
const dashboardView = createView({ view_id: 'dashboard-view', parent_view_id: 'container', layout: ViewLayout.Dashboard });
const container = createView({
  view_id: 'container',
  extra: { is_space: false, is_database_container: true, database_id: 'db-1' },
  children: [gridView, ownedBoardView, dashboardView],
});
const outline = [createView({ view_id: 'space', layout: ViewLayout.Document, children: [container] })];

describe('useContainerVisibleViewIds', () => {
  it('lists the container children without the views a dashboard owns', () => {
    const { result } = renderHook(() => useContainerVisibleViewIds({ view: container, outline }));

    expect(result.current.containerView).toBe(container);
    expect(result.current.visibleViewIds).toEqual(['grid-view', 'dashboard-view']);
  });

  it('keeps the same list for a child route', () => {
    const { result } = renderHook(() => useContainerVisibleViewIds({ view: dashboardView, outline }));

    expect(result.current.visibleViewIds).toEqual(['grid-view', 'dashboard-view']);
  });

  it('shows an owned view opened from its route as the only tab', () => {
    const { result } = renderHook(() => useContainerVisibleViewIds({ view: ownedBoardView, outline }));

    expect(result.current.containerView).toBe(container);
    expect(result.current.visibleViewIds).toEqual(['owned-board-view']);
  });

  it('keeps every child when none is owned', () => {
    const plain = { ...container, children: [gridView, dashboardView] };
    const { result } = renderHook(() =>
      useContainerVisibleViewIds({ view: plain, outline: [createView({ view_id: 'space', children: [plain] })] })
    );

    expect(result.current.visibleViewIds).toEqual(['grid-view', 'dashboard-view']);
  });

  it('returns no list for a standalone database', () => {
    const standalone = createView({ view_id: 'standalone', parent_view_id: 'space' });
    const { result } = renderHook(() => useContainerVisibleViewIds({ view: standalone, outline: [standalone] }));

    expect(result.current.containerView).toBeUndefined();
    expect(result.current.visibleViewIds).toBeUndefined();
  });
});
