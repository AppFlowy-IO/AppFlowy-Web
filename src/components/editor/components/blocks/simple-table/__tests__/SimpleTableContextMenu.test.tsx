import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, SimpleTableData } from '@/application/types';

import { SimpleTableContext, SimpleTableContextValue } from '../SimpleTableContext';
import { ColumnActionTrigger, RowActionTrigger } from '../SimpleTableContextMenu';

const mockEditor = {};

jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { updateTableData: jest.fn() },
}));

const mockUpdateTableData = jest.mocked(CustomEditor.updateTableData);

function renderMenu(type: 'row' | 'column', index = 0, initialData: SimpleTableData = {}, readOnly = false) {
  const setIsMenuOpen = jest.fn();

  function Harness() {
    const [data, setData] = useState(initialData);

    mockUpdateTableData.mockImplementation((_, __, updates) => {
      setData((previous) => ({ ...previous, ...updates }));
    });

    const context: SimpleTableContextValue = {
      tableNode: { blockId: 'table', type: BlockType.SimpleTableBlock, data, children: [] },
      cellPositionById: new Map(),
      rowCount: 2,
      columnCount: 2,
      isHoveringTable: true,
      hoveringCell: null,
      readOnly,
      setHoveringCell: jest.fn(),
      isMenuOpen: false,
      setIsMenuOpen,
    };

    return (
      <SimpleTableContext.Provider value={context}>
        {type === 'row' ? <RowActionTrigger rowIndex={index} /> : <ColumnActionTrigger colIndex={index} />}
      </SimpleTableContext.Provider>
    );
  }

  const result = render(<Harness />);
  const trigger = result.container.querySelector('.simple-table-action-btn');

  function openMenu() {
    if (!(trigger instanceof HTMLElement)) throw new Error('Table menu trigger is missing');
    jest.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, top: 100, left: 100, right: 116, bottom: 116, width: 16, height: 16, toJSON: () => ({}),
    });
    fireEvent.click(trigger);
  }

  return { ...result, trigger, openMenu, setIsMenuOpen };
}

describe('Simple table header menus', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    { type: 'row' as const, label: 'Header row', flag: 'enable_header_row' },
    { type: 'column' as const, label: 'Header column', flag: 'enable_header_column' },
  ])('toggles $label from its label and switch, and retains its state when reopened', async ({ type, label, flag }) => {
    const { openMenu, setIsMenuOpen } = renderMenu(type);

    openMenu();
    const control = screen.getByRole<HTMLInputElement>('switch', { name: label });

    expect(control.checked).toBe(false);
    fireEvent.click(screen.getByText(label));
    expect(mockUpdateTableData).toHaveBeenLastCalledWith(mockEditor, 'table', { [flag]: true });
    expect(control.checked).toBe(true);
    expect(screen.getByRole('switch', { name: label })).toBe(control);
    expect(setIsMenuOpen).not.toHaveBeenCalledWith(false);

    fireEvent.keyDown(control, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('switch', { name: label })).toBeNull());
    openMenu();

    const reopenedControl = screen.getByRole<HTMLInputElement>('switch', { name: label });

    expect(reopenedControl.checked).toBe(true);
    fireEvent.click(reopenedControl);
    expect(mockUpdateTableData).toHaveBeenLastCalledWith(mockEditor, 'table', { [flag]: false });
    expect(reopenedControl.checked).toBe(false);
    expect(mockUpdateTableData).toHaveBeenCalledTimes(2);
  });

  it.each(['row', 'column'] as const)('omits the header toggle for a later %s', (type) => {
    const { openMenu } = renderMenu(type, 1);

    openMenu();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Color')).toBeTruthy();
  });

  it.each(['row', 'column'] as const)('hides the %s menu in read-only tables', (type) => {
    const { trigger } = renderMenu(type, 0, {}, true);

    expect(trigger).toBeNull();
    expect(mockUpdateTableData).not.toHaveBeenCalled();
  });
});
