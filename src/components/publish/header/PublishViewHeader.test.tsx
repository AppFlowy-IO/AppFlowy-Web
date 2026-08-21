import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PublishViewHeader } from '@/components/publish/header/PublishViewHeader';

jest.mock('@/application/publish', () => ({
  usePublishContext: () => ({
    viewMeta: { view_id: 'projects-container-id' },
    outline: [
      {
        view_id: 'projects-container-id',
        name: 'projects',
        layout: 1,
        children: [
          {
            view_id: 'completed-view-id',
            parent_view_id: 'projects-container-id',
            name: 'Completed Project',
            layout: 1,
            children: [],
            icon: null,
            extra: { database_id: 'projects-database-id' },
            is_published: true,
            is_private: false,
          },
        ],
        icon: null,
        extra: { database_id: 'projects-database-id', is_database_container: true },
        is_published: true,
        is_private: false,
      },
    ],
    toView: jest.fn(),
    breadcrumbs: [],
    rendered: false,
  }),
}));

jest.mock('@/components/_shared/breadcrumb', () => ({
  Breadcrumb: () => null,
}));

jest.mock('@/components/_shared/outline', () => ({
  OutlinePopover: ({ content }: { content: React.ReactNode }) => <>{content}</>,
}));

jest.mock('@/components/_shared/outline/Outline', () => ({
  __esModule: true,
  default: ({ selectedViewId }: { selectedViewId?: string }) => (
    <div data-testid='header-outline' data-selected-view-id={selectedViewId} />
  ),
}));

jest.mock('@/components/_shared/outline/outline.hooks', () => ({
  useOutlinePopover: () => ({
    openPopover: true,
    debounceClosePopover: jest.fn(),
    handleOpenPopover: jest.fn(),
    debounceOpenPopover: jest.fn(),
    handleClosePopover: jest.fn(),
  }),
}));

jest.mock('@/components/_shared/skeleton/BreadcrumbSkeleton', () => () => null);

jest.mock('@/utils/platform', () => ({
  getPlatform: () => ({ isMobile: false }),
}));

function renderHeader(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <PublishViewHeader
        drawerWidth={280}
        onOpenDrawer={jest.fn()}
        openDrawer={false}
        onCloseDrawer={jest.fn()}
      />
    </MemoryRouter>
  );
}

describe('PublishViewHeader outline selection', () => {
  it('uses the active database view from the query string', () => {
    renderHeader('/namespace/projects?v=completed-view-id');

    expect(screen.getByTestId('header-outline').getAttribute('data-selected-view-id')).toBe('completed-view-id');
  });

  it('selects the first database view when the published route is a container', () => {
    renderHeader('/namespace/projects');

    expect(screen.getByTestId('header-outline').getAttribute('data-selected-view-id')).toBe('completed-view-id');
  });
});
