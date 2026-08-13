import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GridDragState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';

import { HoverControls } from '../HoverControls';

jest.mock('@/application/database-yjs', () => ({
  useSortsSelector: () => [],
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'tooltip.dragRow': 'Drag row',
        'tooltip.openMenu': 'Open menu',
      }[key] ?? key),
  }),
}));

jest.mock('../HoverControls.hooks', () => ({
  useHoverControlsActions: () => ({
    addAboveLoading: false,
    addBelowLoading: false,
    onAddRowAbove: jest.fn(),
    onAddRowBelow: jest.fn(),
  }),
  useHoverControlsDisplay: () => ({ ref: jest.fn() }),
}));

jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  __esModule: true,
  ClearSortingConfirm: () => null,
  default: () => null,
}));

jest.mock('../RowMenu', () => {
  const { DropdownMenuContent, DropdownMenuItem } = jest.requireActual('@/components/ui/dropdown-menu');

  return {
    __esModule: true,
    default: () => (
      <DropdownMenuContent>
        <DropdownMenuItem data-testid='mock-row-menu-item'>Insert above</DropdownMenuItem>
      </DropdownMenuContent>
    ),
  };
});

describe('HoverControls accessibility', () => {
  it('opens the grouped row menu from a visible, labeled keyboard trigger', async () => {
    render(
      <HoverControls
        canDrag={false}
        groupFieldId='status'
        groupId='todo'
        rowId='row-a'
        rowKey='group:todo:row:row-a'
        state={{ type: GridDragState.IDLE }}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    const controls = trigger.parentElement?.parentElement;

    expect(trigger.getAttribute('tabindex')).toBeNull();
    expect(trigger.className).toContain('focus-visible:ring-1');
    expect(controls?.className).toContain('focus-within:!opacity-100');

    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { code: 'Enter', key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('mock-row-menu-item')).toBeTruthy());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
