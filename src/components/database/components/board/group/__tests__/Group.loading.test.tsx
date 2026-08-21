import { render, screen } from '@testing-library/react';

import { useRowsByGroup } from '@/application/database-yjs';
import { Group } from '@/components/database/components/board/group/Group';

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 100,
  useDatabaseContext: () => ({ navigateToRow: jest.fn(), paddingEnd: 0, paddingStart: 0 }),
  useReadOnly: () => false,
  useRowsByGroup: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: () => jest.fn(),
}));
jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: () => ({ setEditingCardId: jest.fn(), setSelectedCardIds: jest.fn() }),
}));
jest.mock('@/components/database/components/board/drag-and-drop/useColumnsDrag', () => ({
  useColumnsDrag: () => ({ contextValue: { instanceId: 'test-board' }, scrollableRef: { current: null } }),
}));
jest.mock('@/components/database/components/board/group/Columns', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => <div data-testid='board-columns'>Hydrated board</div>),
  };
});
jest.mock('@/components/database/components/board/group/GroupStickyHeader', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => null),
  };
});
jest.mock('@/components/database/components/board/group/useNavigationKey', () => ({
  useNavigationKey: jest.fn(),
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: React.forwardRef<HTMLDivElement>(() => null),
  };
});
jest.mock('@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseRowsByGroup = useRowsByGroup as jest.MockedFunction<typeof useRowsByGroup>;
const loadingResult = {
  columns: [],
  fieldId: 'status-field-id',
  groupResult: new Map(),
  groupRowsReady: false,
  hideEmptyGroups: false,
  notFound: false,
};

describe('Board group loading state', () => {
  afterEach(() => {
    mockUseRowsByGroup.mockReset();
  });

  it('replaces the non-interactive Kanban skeleton after the first row grouping is hydrated', () => {
    mockUseRowsByGroup.mockReturnValue(loadingResult);

    const { rerender } = render(<Group groupId='status-group-id' />);

    expect(screen.getByTestId('kanban-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('board-columns')).toBeNull();
    expect(screen.queryByText('New')).toBeNull();

    mockUseRowsByGroup.mockReturnValue({ ...loadingResult, groupRowsReady: true });
    rerender(<Group groupId='status-group-id' />);

    expect(screen.queryByTestId('kanban-skeleton')).toBeNull();
    expect(screen.getByTestId('board-columns').textContent).toBe('Hydrated board');
  });
});
