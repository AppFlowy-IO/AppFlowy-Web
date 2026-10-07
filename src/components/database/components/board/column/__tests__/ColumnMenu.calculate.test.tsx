import { fireEvent, render, screen, within } from '@testing-library/react';

import ColumnHeaderPrimitive from '@/components/database/components/board/column/ColumnHeaderPrimitive';
import { ColumnMenu } from '@/components/database/components/board/column/ColumnMenu';
import {
  BoardColumnDisplay,
  BoardColumnDisplayContext,
} from '@/components/database/components/board/group/board-display-context';

const mockSetGroupCalculation = jest.fn();
const mockUpdateOption = jest.fn();
let mockGroupCalculation: { type: number; fieldId: string } | undefined;
let mockReadOnly = false;

jest.mock('@/application/database-yjs', () => {
  const actual = jest.requireActual('@/application/database-yjs/database.type');
  const select = { id: 'status', name: 'Status', type: 3 };

  return {
    FieldType: actual.FieldType,
    FieldVisibility: actual.FieldVisibility,
    parseSelectOptionTypeOptions: () => ({
      options: [
        { id: 'todo', name: 'Todo', color: 'Purple' },
        { id: 'doing', name: 'Doing', color: 'Blue' },
      ],
    }),
    useBoardLayoutSettings: () => ({ groupCalculation: mockGroupCalculation }),
    useFieldSelector: () => ({ field: { get: (key: string) => (key === 'ty' ? select.type : undefined) }, clock: 0 }),
    useFieldsSelector: () => [
      { fieldId: 'name', fieldName: 'Name', fieldType: 0, isPrimary: true },
      { fieldId: 'status', fieldName: 'Status', fieldType: 3, isPrimary: false },
      { fieldId: 'estimate', fieldName: 'Estimate', fieldType: 1, isPrimary: false },
      { fieldId: 'owner', fieldName: 'Owner', fieldType: 10, isPrimary: false },
    ],
    useReadOnly: () => mockReadOnly,
  };
});

jest.mock('@/application/database-yjs/dispatch', () => ({
  useToggleHiddenGroupColumnDispatch: () => jest.fn(),
  useUpdateSelectOption: () => mockUpdateOption,
}));

jest.mock('@/application/database-yjs/dispatch/board', () => ({
  useSetBoardGroupCalculation: () => mockSetGroupCalculation,
}));

jest.mock('@/components/database/components/board/column/ColumnRename', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/board/column/ColumnDeleteConfirm', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/board/column/useRenderColumn', () => ({
  useRenderColumn: () => ({ header: <span>Doing</span>, renameEnabled: true, deleteEnabled: true, hideEnabled: true }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderMenu(display: Partial<BoardColumnDisplay> = {}) {
  render(
    <BoardColumnDisplayContext.Provider value={{ sorted: false, showColorColumns: false, ...display }}>
      <ColumnMenu deleteEnabled fieldId='status' getCards={() => []} groupId='group' id='doing' renameEnabled>
        <button type='button'>More</button>
      </ColumnMenu>
    </BoardColumnDisplayContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
}

describe('ColumnMenu › Calculate (WP09 §1.6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupCalculation = undefined;
    mockReadOnly = false;
  });

  it('lists Count all (ticked by default) and the supported properties in field order', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('board-column-calculate'));

    const pane = screen.getByTestId('board-column-calculate-menu');

    expect(within(pane).getByText('board.column.calculate')).toBeTruthy();
    expect(screen.getByTestId('board-column-calculate-count-all').getAttribute('data-checked')).toBe('true');
    expect(within(pane).getByText('board.column.properties')).toBeTruthy();
    // A Person property offers no column calculation.
    expect(
      Array.from(pane.querySelectorAll('[data-testid^="board-column-calculate-field-"]')).map((row) =>
        row.getAttribute('data-testid')
      )
    ).toEqual([
      'board-column-calculate-field-name',
      'board-column-calculate-field-status',
      'board-column-calculate-field-estimate',
    ]);
    expect(screen.getByTestId('board-column-menu').closest('[data-radix-popper-content-wrapper]')).toBeTruthy();
  });

  it('offers the calculations valid for the property, in menu order, and writes the pick', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('board-column-calculate'));
    fireEvent.click(screen.getByTestId('board-column-calculate-field-estimate'));

    const types = Array.from(
      screen.getByTestId('board-column-calculate-types').querySelectorAll('[data-testid^="board-column-calculate-type-"]')
    ).map((row) => row.getAttribute('data-testid')?.replace('board-column-calculate-type-', ''));

    expect(types).toEqual(['17', '6', '7', '15', '16', '4', '0', '3', '1', '2', '11']);
    fireEvent.click(screen.getByTestId('board-column-calculate-type-4'));
    expect(mockSetGroupCalculation).toHaveBeenCalledWith({ type: 4, fieldId: 'estimate' });
    expect(screen.queryByTestId('board-column-menu')).toBeNull();
  });

  it('writes Count all, ticks the current property and calculation, and goes back a pane', () => {
    mockGroupCalculation = { type: 4, fieldId: 'estimate' };
    renderMenu();
    fireEvent.click(screen.getByTestId('board-column-calculate'));
    expect(screen.getByTestId('board-column-calculate-count-all').getAttribute('data-checked')).toBe('false');
    expect(screen.getByTestId('board-column-calculate-field-estimate').getAttribute('data-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('board-column-calculate-field-estimate'));
    expect(screen.getByTestId('board-column-calculate-type-4').getAttribute('data-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('board-column-calculate-back'));
    fireEvent.click(screen.getByTestId('board-column-calculate-count-all'));
    expect(mockSetGroupCalculation).toHaveBeenCalledWith(null);
  });

  it('offers the ten base colours of a select column while Color columns is on', () => {
    renderMenu({ showColorColumns: true });

    const swatches = screen.getByTestId('board-column-color-row').querySelectorAll('[role="radio"]');

    expect(swatches).toHaveLength(10);
    expect(screen.getByTestId('board-column-color-Blue').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('board-column-color-Green'));
    expect(mockUpdateOption).toHaveBeenCalledWith('doing', { id: 'doing', name: 'Doing', color: 'Green' });
  });

  it('has no colour row while Color columns is off', () => {
    renderMenu();
    expect(screen.queryByTestId('board-column-color-row')).toBeNull();
  });

  it('gives readers no column menu at all', () => {
    mockReadOnly = true;
    render(
      <ColumnHeaderPrimitive addCardBefore={jest.fn()} fieldId='status' getCards={() => []} groupId='group' id='doing' rowCount={2} />
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('board-column-aggregate').textContent).toBe('2');
  });
});
