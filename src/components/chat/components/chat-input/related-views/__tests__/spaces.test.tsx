import { fireEvent, render, screen } from '@testing-library/react';

import { Spaces } from '@/components/chat/components/chat-input/related-views/spaces';
import { CheckStatus } from '@/components/chat/types/checkbox';
import type { View } from '@/components/chat/types/request';
import { ViewLayout } from '@/components/chat/types/request';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/chat/components/view/view-children', () => ({
  ViewChildren: () => null,
}));

jest.mock('@/components/chat/components/view/space-item', () => ({
  __esModule: true,
  default: ({ view }: { view: View }) => <div data-testid='space-item'>{view.name}</div>,
}));

jest.mock('@/components/chat/components/view/view-item', () => ({
  ViewItem: ({ view, onToggle }: { view: View; onToggle: (view: View) => void }) => (
    <button onClick={() => onToggle(view)}>{view.name}</button>
  ),
}));

function view(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_private: false,
    ...overrides,
  };
}

describe('RelatedViews Spaces', () => {
  it('renders a document root as a selectable row even when it has no children', () => {
    const parent = view({ view_id: 'parent-id', name: 'Parent page' });
    const onToggle = jest.fn();

    render(
      <Spaces
        spaces={[parent]}
        viewsLoading={false}
        getCheckStatus={() => CheckStatus.Unchecked}
        getInitialExpand={() => false}
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByText('Parent page'));

    expect(onToggle).toHaveBeenCalledWith(parent);
  });

  it('renders a top-level is_space view as a non-selectable space container', () => {
    const space = view({
      view_id: 'shared-space-id',
      name: 'Shared space',
      is_space: true,
      extra: null,
    });
    const onToggle = jest.fn();

    render(
      <Spaces
        spaces={[space]}
        viewsLoading={false}
        getCheckStatus={() => CheckStatus.Unchecked}
        getInitialExpand={() => false}
        onToggle={onToggle}
      />
    );

    expect(screen.getByTestId('space-item').textContent).toBe('Shared space');
    fireEvent.click(screen.getByText('Shared space'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
