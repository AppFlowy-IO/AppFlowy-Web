import { fireEvent, render, screen } from '@testing-library/react';

import { BoardColorColumnsItem } from '@/components/database/components/settings/BoardSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockToggle = jest.fn();
let mockShowColorColumns = false;
let mockReadOnly = false;

jest.mock('@/application/database-yjs', () => ({
  useBoardLayoutSettings: () => ({ showColorColumns: mockShowColorColumns }),
  useReadOnly: () => mockReadOnly,
}));
jest.mock('@/application/database-yjs/dispatch/board', () => ({ useToggleBoardColorColumns: () => mockToggle }));
jest.mock('@/components/database/components/settings/BoardSettingGroup', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/settings/Layout', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/settings/Properties', () => ({ __esModule: true, default: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function renderItem() {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <BoardColorColumnsItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('Board settings › Color columns (WP09 §1.5)', () => {
  beforeEach(() => {
    mockToggle.mockReset();
    mockShowColorColumns = false;
    mockReadOnly = false;
  });

  it('is a checkbox row that turns color columns on and off', () => {
    renderItem();

    const row = screen.getByTestId('board-color-columns-toggle');

    expect(row.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(row.textContent).toContain('board.column.colorColumns');
    fireEvent.click(row);
    expect(mockToggle).toHaveBeenCalledWith(true);
  });

  it('shows the stored state and turns it off', () => {
    mockShowColorColumns = true;
    renderItem();

    const row = screen.getByTestId('board-color-columns-toggle');

    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.getAttribute('data-checked')).toBe('true');
    fireEvent.click(row);
    expect(mockToggle).toHaveBeenCalledWith(false);
  });

  it('is offered to writers only', () => {
    mockReadOnly = true;
    renderItem();

    expect(screen.queryByTestId('board-color-columns-toggle')).toBeNull();
  });
});
