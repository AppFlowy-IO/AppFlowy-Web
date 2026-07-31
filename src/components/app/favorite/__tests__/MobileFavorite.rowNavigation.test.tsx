import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { View, ViewLayout } from '@/application/types';
import MobileFavorite from '@/components/app/favorite/MobileFavorite';

const mockGetView = jest.fn();
const mockToView = jest.fn(async () => undefined);
let mockFavoriteViews: View[] | undefined;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {},
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppFavorites: () => ({
    favoriteViews: mockFavoriteViews,
    loadFavoriteViews: jest.fn(async () => undefined),
  }),
  useCurrentWorkspaceIdOptional: () => 'workspace-1',
  useToView: () => mockToView,
}));

jest.mock('@/components/_shared/mobile-outline/MobileOutlineWithCover', () => ({
  __esModule: true,
  default: ({ navigateToView, view }: { navigateToView: (viewId: string) => void; view: View }) => (
    <button data-testid={`mobile-favorite-${view.view_id}`} onClick={() => navigateToView(view.view_id)}>
      {view.name}
    </button>
  ),
}));

function createView(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function LocationDisplay() {
  const location = useLocation();

  return <div data-testid='location'>{`${location.pathname}${location.search}`}</div>;
}

describe('MobileFavorite row navigation', () => {
  beforeEach(() => {
    mockGetView.mockReset();
    mockToView.mockClear();
    mockFavoriteViews = [
      createView({
        view_id: 'row-document-id',
        name: 'Row page',
        extra: {
          row_document: {
            source: {
              database_id: 'database-id',
              database_view_id: 'database-view-id',
              row_id: 'row-id',
            },
          },
        },
      }),
    ];
    mockGetView.mockImplementation(async (_workspaceId: string, viewId: string) => {
      if (viewId === 'database-view-id') {
        return createView({
          view_id: viewId,
          layout: ViewLayout.Grid,
          parent_view_id: 'database-container-id',
        });
      }

      if (viewId === 'database-container-id') {
        return createView({
          view_id: viewId,
          layout: ViewLayout.Grid,
          extra: { is_database_container: true },
        });
      }

      return undefined;
    });
  });

  it('opens a row favorite through its containing database route', async () => {
    const onClose = jest.fn();

    render(
      <MemoryRouter
        initialEntries={['/app/workspace-1/start']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <MobileFavorite onClose={onClose} />
        <LocationDisplay />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('mobile-favorite-row-document-id'));

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/app/workspace-1/database-container-id?v=database-view-id&r=row-id'
      );
    });
    expect(mockToView).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
