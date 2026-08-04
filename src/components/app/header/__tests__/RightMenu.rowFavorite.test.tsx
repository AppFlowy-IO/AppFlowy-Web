import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ActiveRowPageInfo } from '@/application/row-document/row-page-state';
import RightMenu from '@/components/app/header/RightMenu';

let mockActiveRowPage: ActiveRowPageInfo | null = null;

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
  useAppOutline: () => [],
  useAppView: () => ({ view_id: 'database-container' }),
  useAppViewId: () => 'database-container',
  useCurrentWorkspaceId: () => 'workspace-1',
}));

jest.mock('src/components/app/share/ShareButton', () => ({
  __esModule: true,
  default: ({ hidePublish = false }: { hidePublish?: boolean }) => (
    <div data-testid='share-button' data-publish-hidden={String(hidePublish)} />
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
});
