import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';

import { useToggleHiddenGroupColumnDispatch } from '@/application/database-yjs/dispatch';

import HiddenColumnItem from '../HiddenColumnItem';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useToggleHiddenGroupColumnDispatch: jest.fn(),
}));

jest.mock('@/components/database/components/board/column/useRenderColumn', () => ({
  useRenderColumn: () => ({ header: <span>Empty group</span> }),
}));

jest.mock('@/components/database/components/drag-and-drop/DragItem', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/board/column/HiddenItemMenu', () => ({
  HiddenItemMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseToggleHiddenGroupColumnDispatch = useToggleHiddenGroupColumnDispatch as jest.MockedFunction<
  typeof useToggleHiddenGroupColumnDispatch
>;

describe('HiddenColumnItem', () => {
  it('shows an auto-hidden group on the first eye click and hides it on the second', () => {
    const toggleHidden = jest.fn();
    const onColumnTemporarilyShownChange = jest.fn();
    const baseProps = {
      fieldId: 'status-field',
      getRows: () => [],
      groupId: 'board-group',
      id: 'empty-group',
      onColumnTemporarilyShownChange,
    };

    mockUseToggleHiddenGroupColumnDispatch.mockReturnValue(toggleHidden);

    const { rerender } = render(<HiddenColumnItem {...baseProps} isShownOnBoard={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'board.mobile.showGroup' }));

    expect(onColumnTemporarilyShownChange).toHaveBeenLastCalledWith('empty-group', true);
    expect(toggleHidden).toHaveBeenLastCalledWith('empty-group', false);

    rerender(<HiddenColumnItem {...baseProps} isShownOnBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'board.column.hideColumn' }));

    expect(onColumnTemporarilyShownChange).toHaveBeenLastCalledWith('empty-group', false);
    expect(toggleHidden).toHaveBeenLastCalledWith('empty-group', true);
  });
});
