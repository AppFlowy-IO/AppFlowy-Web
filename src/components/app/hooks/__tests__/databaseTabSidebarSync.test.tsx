import { expect } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useCallback, useMemo, useState } from 'react';
import * as Y from 'yjs';

import { DatabaseViewLayout, View, ViewLayout, YDatabaseView, YjsDatabaseKey } from '@/application/types';
import ViewItem from '@/components/app/outline/ViewItem';
import { DatabaseViewTabs } from '@/components/database/components/tabs/DatabaseViewTabs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

declare global {
  // eslint-disable-next-line no-var
  var __routeViewId: string | undefined;
  // eslint-disable-next-line no-var
  var __tabViewId: string | null | undefined;
  // eslint-disable-next-line no-var
  var __outline: View[] | undefined;
}

jest.mock('@/components/app/app.hooks', () => {
  const { resolveSidebarSelectedViewId } = jest.requireActual(
    '@/components/app/hooks/resolveSidebarSelectedViewId'
  );

  return {
    useSidebarSelectedViewId: () =>
      resolveSidebarSelectedViewId({
        routeViewId: global.__routeViewId,
        tabViewId: global.__tabViewId,
        outline: global.__outline,
      }),
    useAppHandlers: () => ({
      updatePage: jest.fn(),
      uploadFile: jest.fn(),
    }),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/_shared/outline/OutlineIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);

jest.mock('@/components/_shared/scroller', () => ({
  AFScroller: React.forwardRef(
    ({ children }: { children: React.ReactNode }, ref: React.ForwardedRef<HTMLDivElement>) => (
      <div ref={ref}>{children}</div>
    )
  ),
}));

jest.mock('@/components/database/components/tabs/AddViewButton', () => ({
  AddViewButton: () => null,
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  }

  // jsdom doesn't provide ResizeObserver; DatabaseViewTabs uses it for tab scrolling.
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  });
});

function createDatabaseYView(name: string, layout: DatabaseViewLayout): YDatabaseView {
  const view = new Y.Map() as unknown as YDatabaseView;

  view.set(YjsDatabaseKey.name, name);
  view.set(YjsDatabaseKey.layout, layout);
  return view;
}

describe('Database tab ↔ sidebar selection sync', () => {
  it('keeps tab order stable and syncs selection both ways', () => {
    const containerId = 'container-id';
    const gridId = 'grid-id';
    const boardId = 'board-id';
    const calendarId = 'calendar-id';

    const gridView: View = {
      view_id: gridId,
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const boardView: View = {
      view_id: boardId,
      name: 'Board',
      icon: null,
      layout: ViewLayout.Board,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const calendarView: View = {
      view_id: calendarId,
      name: 'Calendar',
      icon: null,
      layout: ViewLayout.Calendar,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: containerId,
    };

    const containerView: View = {
      view_id: containerId,
      name: 'New database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [gridView, boardView, calendarView],
      is_published: false,
      is_private: false,
    };

    const outline: View[] = [
      {
        view_id: 'space-id',
        name: 'Space',
        icon: null,
        layout: ViewLayout.Document,
        extra: { is_space: true },
        children: [containerView],
        is_published: false,
        is_private: false,
      },
    ];

    const yDoc = new Y.Doc();
    const yViews = yDoc.getMap<YDatabaseView>('views');

    yViews.set(gridId, createDatabaseYView('Grid', DatabaseViewLayout.Grid));
    yViews.set(boardId, createDatabaseYView('Board', DatabaseViewLayout.Board));
    yViews.set(calendarId, createDatabaseYView('Calendar', DatabaseViewLayout.Calendar));

    expect(yViews.get(gridId)).toBeDefined();

    function Harness() {
      // In Web, the active database view tab is tracked via the `v` query param while the
      // route view id stays stable. We model that state explicitly for this unit test.
      const [routeViewId, setRouteViewId] = useState(gridId);
      const [tabViewId, setTabViewId] = useState<string | null>(null);

      global.__routeViewId = routeViewId;
      global.__tabViewId = tabViewId;
      global.__outline = outline;

      const activeViewId = tabViewId || routeViewId;
      const viewIds = useMemo(() => [gridId, boardId, calendarId], []);

      const handleSidebarClick = useCallback(
        (viewId: string) => {
          setRouteViewId(viewId);
          setTabViewId(null);
        },
        []
      );

      const handleTabClick = useCallback(
        (viewId: string) => {
          setTabViewId(viewId);
        },
        []
      );

      return (
        <>
          <ViewItem
            view={containerView}
            width={240}
            expandIds={[containerId]}
            toggleExpand={jest.fn()}
            onClickView={handleSidebarClick}
          />
          <DatabaseViewTabs
            viewIds={viewIds}
            selectedViewId={activeViewId}
            setSelectedViewId={handleTabClick}
            databasePageId={gridId}
            databaseName='New database'
            views={yViews}
            readOnly
            visibleViewIds={viewIds}
            menuViewId={null}
            setMenuViewId={jest.fn()}
            setDeleteConfirmOpen={jest.fn()}
            setRenameViewId={jest.fn()}
          />
        </>
      );
    }

    render(<Harness />);

    // Tab order stays Grid → Board → Calendar regardless of selection source.
    const tabs = screen.getAllByTestId(/view-tab-/);

    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Grid', 'Board', 'Calendar']);

    // Initial state: route view is Grid; both tab and sidebar should select Grid.
    expect(screen.getByTestId(`view-tab-${gridId}`).getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId(`page-${gridId}`).getAttribute('data-selected')).toBe('true');

    // Tab bar → sidebar: selecting Board tab updates sidebar selection.
    fireEvent.mouseDown(screen.getByTestId(`view-tab-${boardId}`));
    expect(screen.getByTestId(`view-tab-${boardId}`).getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId(`page-${boardId}`).getAttribute('data-selected')).toBe('true');

    // Sidebar → tab bar: opening Board from the sidebar selects the Board tab (no `v` param).
    fireEvent.click(screen.getByTestId(`page-${boardId}`));
    expect(screen.getByTestId(`view-tab-${boardId}`).getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId(`page-${boardId}`).getAttribute('data-selected')).toBe('true');

    // Sidebar → tab bar: opening Calendar from the sidebar selects the Calendar tab.
    fireEvent.click(screen.getByTestId(`page-${calendarId}`));
    expect(screen.getByTestId(`view-tab-${calendarId}`).getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId(`page-${calendarId}`).getAttribute('data-selected')).toBe('true');

    // Tab bar → sidebar from a non-Grid route: selecting Grid tab updates sidebar selection.
    fireEvent.mouseDown(screen.getByTestId(`view-tab-${gridId}`));
    expect(screen.getByTestId(`view-tab-${gridId}`).getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId(`page-${gridId}`).getAttribute('data-selected')).toBe('true');
  });
});
