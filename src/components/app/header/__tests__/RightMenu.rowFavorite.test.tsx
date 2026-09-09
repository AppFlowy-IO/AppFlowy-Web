import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ActiveRowPageInfo } from '@/application/row-document/row-page-state';
import { ViewLayout } from '@/application/types';
import RightMenu from '@/components/app/header/RightMenu';

let mockActiveRowPage: ActiveRowPageInfo | null = null;
let mockRouteViewId = 'database-container';
let mockRouteView = { view_id: mockRouteViewId };
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
  default: () => <div data-testid='more-actions' />,
}));

jest.mock('@/components/app/header/Users', () => ({
  Users: () => <div data-testid='users' />,
}));

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
  });
});
