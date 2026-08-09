import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';

import { useSetBoardColumnRenderedDispatch } from '@/application/database-yjs/dispatch';

import HiddenColumnItem from '../HiddenColumnItem';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useSetBoardColumnRenderedDispatch: jest.fn(),
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

const mockUseSetBoardColumnRenderedDispatch = useSetBoardColumnRenderedDispatch as jest.MockedFunction<
  typeof useSetBoardColumnRenderedDispatch
>;

describe('HiddenColumnItem', () => {
  it('shows an auto-hidden group on the first eye click and hides it on the second', () => {
    const setColumnRendered = jest.fn();
    const baseProps = {
      fieldId: 'status-field',
      getRows: () => [],
      groupId: 'board-group',
      id: 'empty-group',
      automaticallyHidden: true,
    };

    mockUseSetBoardColumnRenderedDispatch.mockReturnValue(setColumnRendered);

    const { rerender } = render(<HiddenColumnItem {...baseProps} isShownOnBoard={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'board.mobile.showGroup' }));

    expect(setColumnRendered).toHaveBeenLastCalledWith('empty-group', true, true);

    rerender(<HiddenColumnItem {...baseProps} isShownOnBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'board.column.hideColumn' }));

    expect(setColumnRendered).toHaveBeenLastCalledWith('empty-group', false, true);
  });
});
