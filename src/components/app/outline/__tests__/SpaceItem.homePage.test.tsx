import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { View, ViewLayout } from '@/application/types';
import SpaceItem from '@/components/app/outline/SpaceItem';

import type { ReactNode } from 'react';

const mockOnClickView = jest.fn();
const mockToggleExpand = jest.fn();
const mockShouldSuppressClick = jest.fn();

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => 'workspace-id',
}));

jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({
    dragState: { type: 'idle' },
    shouldSuppressClick: mockShouldSuppressClick,
  }),
}));

jest.mock('@/components/app/outline/reorder/useReorderableSidebarList', () => ({
  useReorderableSidebarList: ({ items }: { items: View[] }) => ({ orderedItems: items }),
}));

jest.mock('@/components/app/outline/AnimatedCollapse', () => ({
  __esModule: true,
  default: ({ expanded, children }: { expanded: boolean; children: ReactNode }) =>
    expanded ? <div>{children}</div> : null,
}));

jest.mock('@/components/app/outline/ViewItem', () => ({
  __esModule: true,
  default: ({ view }: { view: View }) => <div>{view.name}</div>,
}));

jest.mock('@/components/_shared/view-icon/SpaceIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/drag-and-drop/DropRowLine', () => ({
  __esModule: true,
  default: () => null,
}));

const child: View = {
  view_id: 'child-page',
  name: 'Child page',
  layout: ViewLayout.Document,
  icon: null,
  extra: null,
  children: [],
  is_private: false,
  is_published: false,
};

function SpaceHarness({ hasHomePage, onClickSpace }: { hasHomePage?: boolean; onClickSpace?: (id: string) => void }) {
  const [expandIds, setExpandIds] = useState<string[]>([]);
  const space: View = {
    ...child,
    view_id: 'space-id',
    name: 'Test Space',
    extra: { is_space: true, has_space_home_page: hasHomePage },
    children: [child],
  };

  return (
    <SpaceItem
      view={space}
      width={280}
      expandIds={expandIds}
      toggleExpand={(id, expanded) => {
        mockToggleExpand(id, expanded);
        setExpandIds(expanded ? [id] : []);
      }}
      onClickView={mockOnClickView}
      onClickSpace={onClickSpace}
    />
  );
}

describe('SpaceItem home page navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldSuppressClick.mockReturnValue(false);
  });

  it('opens the retained home page while expanding and collapsing its child pages', () => {
    render(<SpaceHarness hasHomePage />);

    fireEvent.click(screen.getByTestId('space-space-id'));

    expect(mockOnClickView).toHaveBeenCalledTimes(1);
    expect(mockOnClickView).toHaveBeenCalledWith('space-id');
    expect(mockToggleExpand).toHaveBeenLastCalledWith('space-id', true);
    expect(screen.getByText('Child page')).toBeTruthy();

    const title = screen.getByRole('button', { name: 'Test Space' });

    // Native button activation also handles Enter and Space without custom key listeners.
    expect(title.getAttribute('type')).toBe('button');
    expect(title.tabIndex).toBe(0);
    expect(title.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(title);

    expect(mockOnClickView).toHaveBeenCalledTimes(2);
    expect(mockToggleExpand).toHaveBeenLastCalledWith('space-id', false);
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Child page')).toBeNull();
  });

  it('keeps ordinary spaces as expansion-only rows', () => {
    render(<SpaceHarness />);

    fireEvent.click(screen.getByTestId('space-space-id'));

    expect(screen.getByText('Child page')).toBeTruthy();
    fireEvent.click(screen.getByTestId('space-name'));

    expect(screen.queryByText('Child page')).toBeNull();
    expect(mockToggleExpand.mock.calls).toEqual([
      ['space-id', true],
      ['space-id', false],
    ]);
    expect(mockOnClickView).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Test Space' })).toBeNull();
  });

  it('preserves destination selection without navigating or toggling twice', () => {
    const onClickSpace = jest.fn();

    render(<SpaceHarness hasHomePage onClickSpace={onClickSpace} />);
    fireEvent.click(screen.getByTestId('space-space-id'));

    expect(onClickSpace).toHaveBeenCalledTimes(1);
    expect(onClickSpace).toHaveBeenCalledWith('space-id');
    expect(mockToggleExpand).toHaveBeenCalledTimes(1);
    expect(mockToggleExpand).toHaveBeenCalledWith('space-id', true);
    expect(mockOnClickView).not.toHaveBeenCalled();
  });

  it('does not open or expand the home page from a suppressed post-drag click', () => {
    mockShouldSuppressClick.mockReturnValue(true);
    render(<SpaceHarness hasHomePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Space' }));

    expect(mockOnClickView).not.toHaveBeenCalled();
    expect(mockToggleExpand).not.toHaveBeenCalled();
    expect(screen.queryByText('Child page')).toBeNull();
  });
});
