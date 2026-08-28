import { fireEvent, render, screen, within } from '@testing-library/react';

import { UIVariant, View, ViewLayout } from '@/application/types';
import OutlineItem from '@/components/_shared/outline/OutlineItem';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
}));

jest.mock('@/components/_shared/outline/OutlineIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => <span data-testid='page-icon' />);
jest.mock('@/components/_shared/view-icon/PublishIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/SpaceIcon', () => () => null);

const completedView: View = {
  view_id: 'completed-view-id',
  parent_view_id: 'projects-container-id',
  name: 'Completed Project',
  layout: ViewLayout.Grid,
  children: [],
  icon: null,
  extra: {
    database_id: 'projects-database-id',
  },
  is_published: true,
  is_private: false,
};

const inProgressView: View = {
  ...completedView,
  view_id: 'in-progress-view-id',
  name: 'In Progress',
};

const projectsContainer: View = {
  view_id: 'projects-container-id',
  name: 'projects',
  layout: ViewLayout.Grid,
  children: [completedView, inProgressView],
  icon: null,
  extra: {
    database_id: 'projects-database-id',
    is_database_container: true,
  },
  is_published: true,
  is_private: false,
};

describe('published outline database container', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('outline_expanded', JSON.stringify({ [projectsContainer.view_id]: true }));
  });

  it('highlights both the container and active database view', () => {
    render(
      <OutlineItem
        view={projectsContainer}
        width={280}
        selectedViewId={completedView.view_id}
        variant={UIVariant.Publish}
      />
    );

    expect(screen.getByTestId(`outline-item-${projectsContainer.view_id}`).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId(`outline-item-${completedView.view_id}`).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId(`outline-item-${inProgressView.view_id}`).getAttribute('data-selected')).toBe('false');
  });

  it('keeps the container highlighted in the favorites outline when a database view is active', () => {
    render(
      <OutlineItem
        view={projectsContainer}
        width={280}
        selectedViewId={completedView.view_id}
        variant={UIVariant.Favorite}
      />
    );

    expect(screen.getByTestId(`outline-item-${projectsContainer.view_id}`).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId(`outline-item-${completedView.view_id}`).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId(`outline-item-${inProgressView.view_id}`).getAttribute('data-selected')).toBe('false');
  });

  it('renders dots instead of page icons for database views', () => {
    render(<OutlineItem view={projectsContainer} width={280} variant={UIVariant.Publish} />);

    const containerRow = screen.getByTestId(`outline-item-${projectsContainer.view_id}`);
    const completedRow = screen.getByTestId(`outline-item-${completedView.view_id}`);
    const inProgressRow = screen.getByTestId(`outline-item-${inProgressView.view_id}`);

    expect(within(containerRow).queryByTestId('page-icon')).not.toBeNull();
    expect(within(containerRow).queryByTestId('database-view-dot')).toBeNull();
    expect(within(completedRow).queryByTestId('page-icon')).toBeNull();
    expect(within(completedRow).queryByTestId('database-view-dot')).not.toBeNull();
    expect(within(inProgressRow).queryByTestId('page-icon')).toBeNull();
    expect(within(inProgressRow).queryByTestId('database-view-dot')).not.toBeNull();
  });

  it('opens the first database view when the container is clicked', () => {
    const navigateToView = jest.fn(async () => undefined);

    render(
      <OutlineItem
        view={projectsContainer}
        width={280}
        variant={UIVariant.Publish}
        navigateToView={navigateToView}
      />
    );

    const containerRow = screen.getByTestId(`outline-item-${projectsContainer.view_id}`);

    fireEvent.click(within(containerRow).getByTestId('page-name'));

    expect(navigateToView).toHaveBeenCalledWith(completedView.view_id);
  });

  it('opens an unpublished container instead of collapsing it', () => {
    const navigateToView = jest.fn(async () => undefined);
    const unpublishedContainer = {
      ...projectsContainer,
      is_published: false,
    };

    render(
      <OutlineItem
        view={unpublishedContainer}
        width={280}
        variant={UIVariant.Publish}
        navigateToView={navigateToView}
      />
    );

    const containerRow = screen.getByTestId(`outline-item-${unpublishedContainer.view_id}`);

    fireEvent.click(within(containerRow).getByTestId('page-name'));

    expect(navigateToView).toHaveBeenCalledWith(completedView.view_id);
  });
});
