import { fireEvent, render, screen } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import ViewItem from '@/components/app/outline/ViewItem';

declare global {
  // eslint-disable-next-line no-var
  var __selectedViewId: string | undefined;
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useSidebarSelectedViewId: () => global.__selectedViewId,
  useAppHandlers: () => ({
    updatePage: jest.fn(),
    uploadFile: jest.fn(),
  }),
}));

jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/_shared/outline/OutlineIcon', () => () => null);
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);

describe('ViewItem database container', () => {
  beforeEach(() => {
    global.__selectedViewId = undefined;
  });

  it('clicking a container opens its first child', () => {
    const childView: View = {
      view_id: 'child-view-id',
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: 'container-view-id',
    };

    const containerView: View = {
      view_id: 'container-view-id',
      name: 'New database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [childView],
      is_published: false,
      is_private: false,
    };

    const onClickView = jest.fn();

    render(
      <ViewItem
        view={containerView}
        width={240}
        expandIds={[]}
        toggleExpand={jest.fn()}
        onClickView={onClickView}
      />
    );

    fireEvent.click(screen.getByTestId(`page-${containerView.view_id}`));
    expect(onClickView).toHaveBeenCalledWith(childView.view_id);
  });

  it('marks a container selected when a child is the active view', () => {
    const childView: View = {
      view_id: 'child-view-id',
      name: 'Grid',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
      parent_view_id: 'container-view-id',
    };

    const containerView: View = {
      view_id: 'container-view-id',
      name: 'New database',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [childView],
      is_published: false,
      is_private: false,
    };

    global.__selectedViewId = childView.view_id;

    render(
      <ViewItem
        view={containerView}
        width={240}
        expandIds={[]}
        toggleExpand={jest.fn()}
        onClickView={jest.fn()}
      />
    );

    const el = screen.getByTestId(`page-${containerView.view_id}`);

    expect(el.getAttribute('data-selected')).toBe('true');
  });
});
