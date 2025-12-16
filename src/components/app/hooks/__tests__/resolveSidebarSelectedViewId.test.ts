import { View, ViewLayout } from '@/application/types';
import { resolveSidebarSelectedViewId } from '@/components/app/hooks/resolveSidebarSelectedViewId';

describe('resolveSidebarSelectedViewId', () => {
  const containerViewId = 'container-view-id';
  const gridViewId = 'grid-view-id';
  const boardViewId = 'board-view-id';
  const docViewId = 'doc-view-id';

  const gridView: View = {
    view_id: gridViewId,
    name: 'Grid',
    icon: null,
    layout: ViewLayout.Grid,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id: containerViewId,
  };

  const boardView: View = {
    view_id: boardViewId,
    name: 'Board',
    icon: null,
    layout: ViewLayout.Board,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id: containerViewId,
  };

  const containerView: View = {
    view_id: containerViewId,
    name: 'Database',
    icon: null,
    layout: ViewLayout.Grid,
    extra: { is_space: false, is_database_container: true },
    children: [gridView, boardView],
    is_published: false,
    is_private: false,
  };

  const documentView: View = {
    view_id: docViewId,
    name: 'Doc',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
  };

  const outline: View[] = [
    {
      view_id: 'space',
      name: 'Space',
      icon: null,
      layout: ViewLayout.Document,
      extra: { is_space: true },
      children: [containerView, documentView],
      is_published: false,
      is_private: false,
    },
  ];

  it('falls back to routeViewId when no tabViewId provided', () => {
    expect(resolveSidebarSelectedViewId({ routeViewId: gridViewId, tabViewId: null, outline })).toBe(gridViewId);
  });

  it('falls back to routeViewId when tabViewId is unknown', () => {
    expect(resolveSidebarSelectedViewId({ routeViewId: gridViewId, tabViewId: 'missing', outline })).toBe(gridViewId);
  });

  it('uses tabViewId when both views are in same database container', () => {
    expect(resolveSidebarSelectedViewId({ routeViewId: gridViewId, tabViewId: boardViewId, outline })).toBe(boardViewId);
  });

  it('ignores tabViewId when route view is not a database view', () => {
    expect(resolveSidebarSelectedViewId({ routeViewId: docViewId, tabViewId: boardViewId, outline })).toBe(docViewId);
  });

  it('ignores tabViewId when it points to a view in another database container', () => {
    const otherContainerId = 'other-container';
    const otherBoardId = 'other-board';

    const otherBoard: View = {
      view_id: otherBoardId,
      name: 'OtherBoard',
      icon: null,
      layout: ViewLayout.Board,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: otherContainerId,
    };

    const otherContainer: View = {
      view_id: otherContainerId,
      name: 'OtherDB',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [otherBoard],
      is_published: false,
      is_private: false,
    };

    const outlineWithOther: View[] = [
      {
        ...outline[0],
        children: [...(outline[0].children || []), otherContainer],
      },
    ];

    expect(resolveSidebarSelectedViewId({ routeViewId: gridViewId, tabViewId: otherBoardId, outline: outlineWithOther })).toBe(
      gridViewId
    );
  });
});

