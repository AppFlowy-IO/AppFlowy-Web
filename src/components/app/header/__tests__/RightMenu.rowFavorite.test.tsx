import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';

import { publishDatabasePageSelection } from '@/application/database-yjs/database-page-state';
import type { ActiveRowPageInfo } from '@/application/row-document/row-page-state';
import { ViewLayout, type View } from '@/application/types';
import RightMenu from '@/components/app/header/RightMenu';

let mockActiveRowPage: ActiveRowPageInfo | null = null;
let mockRouteViewId = 'database-container';
let mockRouteView: Partial<View> = { view_id: mockRouteViewId };
let mockOutline: Array<Record<string, unknown>> = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/row-document/lifecycle', () => ({
  ensureRowDocumentView: jest.fn(async () => true),
  syncRowDocumentViewName: jest.fn(async () => undefined),
}));

jest.mock('@/application/row-document/row-page-state', () => ({
  useActiveRowPage: () => mockActiveRowPage,
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => mockOutline,
  useAppView: () => mockRouteView,
  useAppViewId: () => mockRouteViewId,
  useCurrentWorkspaceId: () => 'workspace-1',
}));

jest.mock('src/components/app/share/ShareButton', () => ({
  __esModule: true,
  default: ({
    viewId,
    publishViewId,
    hidePublish = false,
  }: {
    viewId: string;
    publishViewId?: string;
    hidePublish?: boolean;
  }) => (
    <div
      data-testid='share-button'
      data-view-id={viewId}
      data-publish-view-id={publishViewId}
      data-publish-hidden={String(hidePublish)}
    />
  ),
}));

jest.mock('@/components/app/header/FavoriteButton', () => ({
  __esModule: true,
  default: ({ viewId }: { viewId: string }) => <div data-testid='favorite-button' data-view-id={viewId} />,
}));

jest.mock('@/components/app/header/MoreActions', () => ({
  __esModule: true,
  default: ({ viewId, activeViewId, rowId }: { viewId: string; activeViewId: string; rowId?: string | null }) =>
    <div data-testid='more-actions' data-view-id={viewId} data-active-view-id={activeViewId} data-row-id={rowId} />,
}));

jest.mock('@/components/app/header/Users', () => ({
  Users: () => <div data-testid='users' />,
}));

function createDatabaseContainer(): View {
  const container: View = {
    view_id: 'database-container',
    name: 'Database',
    layout: ViewLayout.Grid,
    icon: null,
    extra: { is_database_container: true },
    is_published: false,
    is_private: false,
    children: [],
  };

  container.children = [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar].map((layout, index) => ({
    view_id: ['grid-view', 'board-view', 'calendar-view'][index],
    name: 'Tab',
    layout,
    icon: null,
    is_published: false,
    is_private: false,
    parent_view_id: container.view_id,
    children: [],
  }));
  return container;
}

describe('RightMenu row-page actions', () => {
  beforeEach(() => {
    mockActiveRowPage = null;
    mockRouteViewId = 'database-container';
    mockRouteView = { view_id: mockRouteViewId };
    mockOutline = [];
  });

  it('hides the favorite action while the requested row page state is not ready', () => {
    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/database-container?r=requested-row']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('favorite-button')).toBeNull();
    expect(screen.getByTestId('more-actions').getAttribute('data-row-id')).toBe('requested-row');
  });

  it('does not fall back to the database for an empty row query', () => {
    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/database-container?r=']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('favorite-button')).toBeNull();
    expect(screen.getByTestId('more-actions').getAttribute('data-row-id')).toBe('');
  });

  it('targets the row document once matching row page state is ready', () => {
    mockActiveRowPage = {
      rowId: 'requested-row',
      documentId: 'row-document',
      title: 'Requested row',
      source: null,
      hasDocument: false,
    };

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/database-container?r=requested-row']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('favorite-button').getAttribute('data-view-id')).toBe('row-document');
  });

  it('keeps sharing available but hides publishing on a row-page route', () => {
    mockActiveRowPage = {
      rowId: 'requested-row',
      documentId: 'row-document',
      title: 'Requested row',
      source: null,
      hasDocument: false,
    };

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/database-container?r=requested-row']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('share-button').getAttribute('data-publish-hidden')).toBe('true');
  });

  it('continues targeting the route view outside row-page routes', () => {
    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/database-container']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('favorite-button').getAttribute('data-view-id')).toBe('database-container');
    expect(screen.getByTestId('share-button').getAttribute('data-publish-hidden')).toBe('false');
  });

  it('keeps database sharing on the container while publishing the active child', () => {
    const containerViewId = 'database-container';

    mockRouteViewId = 'board-view';
    mockRouteView = {
      view_id: mockRouteViewId,
      parent_view_id: containerViewId,
    };
    mockOutline = [
      {
        view_id: containerViewId,
        name: 'Database',
        layout: ViewLayout.Grid,
        extra: { is_database_container: true },
        children: [mockRouteView],
      },
    ];

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/board-view']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    const shareButton = screen.getByTestId('share-button');

    expect(shareButton.getAttribute('data-view-id')).toBe(containerViewId);
    expect(shareButton.getAttribute('data-publish-view-id')).toBe(mockRouteViewId);
    expect(screen.getByTestId('more-actions').getAttribute('data-view-id')).toBe(containerViewId);
    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe(mockRouteViewId);
  });
});

describe('RightMenu database history tab', () => {
  beforeEach(() => {
    mockActiveRowPage = null;
    const container = createDatabaseContainer();

    mockOutline = [container];
    mockRouteViewId = 'grid-view';
    mockRouteView = container.children[0];
  });

  it.each([
    ['grid-view', '?v=board-view', 'board-view'],
    ['database-container', '?v=calendar-view', 'calendar-view'],
    ['board-view', '', 'board-view'],
    ['database-container', '', 'grid-view'],
    ['board-view', '?v=deleted-view', 'board-view'],
    ['database-container', '?v=deleted-view', 'grid-view'],
    ['database-container', '?v=', 'grid-view'],
  ])('opens the displayed tab from %s%s', (routeViewId, search, expectedViewId) => {
    const container = createDatabaseContainer();

    mockOutline = [container];
    mockRouteViewId = routeViewId;
    mockRouteView = [container, ...container.children].find((view) => view.view_id === routeViewId)!;

    render(
      <MemoryRouter
        initialEntries={[`/app/workspace-1/${routeViewId}${search}`]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    const moreActions = screen.getByTestId('more-actions');

    expect(moreActions.getAttribute('data-active-view-id')).toBe(expectedViewId);
    expect(moreActions.getAttribute('data-view-id')).toBe(container.view_id);
    expect(screen.getByTestId('favorite-button').getAttribute('data-view-id')).toBe(container.view_id);
  });

  it('follows tab switches that only update the v query parameter', () => {
    function Tabs() {
      const [, setSearchParams] = useSearchParams();

      return <>
        <button onClick={() => setSearchParams({ v: 'board-view' })}>Board</button>
        <button onClick={() => setSearchParams({ v: 'calendar-view' })}>Calendar</button>
      </>;
    }

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/grid-view']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Tabs />
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('grid-view');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('board-view');
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('calendar-view');
    expect(mockRouteViewId).toBe('grid-view');
  });

  it('uses the displayed restored tab before the folder outline catches up', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/app/workspace-1/grid-view?v=restored-calendar']}>
        <RightMenu />
      </MemoryRouter>
    );
    let release!: () => void;

    act(() => {
      release = publishDatabasePageSelection({ workspaceId: 'workspace-1', databasePageId: 'grid-view',
        tabViewId: 'restored-calendar', activeViewId: 'restored-calendar' });
    });
    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('restored-calendar');
    expect(screen.getByTestId('more-actions').getAttribute('data-view-id')).toBe('database-container');
    unmount();
    release();
  });

  it.each([
    { workspaceId: 'other-workspace', databasePageId: 'grid-view', tabViewId: 'board-view' },
    { workspaceId: 'workspace-1', databasePageId: 'other-page', tabViewId: 'board-view' },
    { workspaceId: 'workspace-1', databasePageId: 'grid-view', tabViewId: 'old-query' },
  ])('ignores selections left over from a different route scope: %p', (scope) => {
    const release = publishDatabasePageSelection({ ...scope, activeViewId: 'unrelated-tab' });
    const { unmount } = render(
      <MemoryRouter initialEntries={['/app/workspace-1/grid-view?v=board-view']}>
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('board-view');
    unmount();
    release();
  });

  it('preserves standalone database tab selection without a container', () => {
    mockOutline = [mockRouteView];

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/grid-view?v=board-view']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('board-view');
  });

  it('ignores the database tab query on document routes', () => {
    mockRouteViewId = 'document';
    mockRouteView = { view_id: mockRouteViewId, layout: ViewLayout.Document };
    mockOutline = [mockRouteView];

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/document?v=board-view']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <RightMenu />
      </MemoryRouter>
    );

    expect(screen.getByTestId('more-actions').getAttribute('data-active-view-id')).toBe('document');
  });
});
