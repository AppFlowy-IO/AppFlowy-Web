import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import NumberCellEditing from '@/components/database/components/cell/number/NumberCellEditing';

jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

describe('NumberCellEditing', () => {
  const updateCell = jest.fn();

  beforeEach(() => {
    updateCell.mockReset();
    (useUpdateCellDispatch as jest.Mock).mockReturnValue(updateCell);
  });

  it('keeps partial input and the caret local until blur despite a remote refresh', () => {
    const onExit = jest.fn();
    const { rerender } = render(<NumberCellEditing defaultValue='1' fieldId='number' onExit={onExit} rowId='row' />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '2.' } });
    expect(updateCell).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '2.5' } });
    input.setSelectionRange(1, 1);
    rerender(<NumberCellEditing defaultValue='9' fieldId='number' onExit={onExit} rowId='row' />);
    expect(input.value).toBe('2.5');
    expect(input.selectionStart).toBe(1);
    expect(updateCell).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(updateCell).toHaveBeenCalledTimes(1);
    expect(updateCell).toHaveBeenCalledWith('2.5');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('commits once when Enter closes the number editor', () => {
    function EditingCell() {
      const [editing, setEditing] = useState(true);

      return editing ? (
        <NumberCellEditing defaultValue='1' fieldId='number' onExit={() => setEditing(false)} rowId='row' />
      ) : (
        <span>Committed</span>
      );
    }

    render(<EditingCell />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2.0' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 13, which: 13 });
    expect(updateCell).toHaveBeenCalledTimes(1);
    expect(updateCell).toHaveBeenCalledWith('2');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it.each(['0', ''])('commits %p without conflating zero and missing', (value) => {
    render(<NumberCellEditing defaultValue='1' fieldId='number' rowId='row' />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(updateCell).toHaveBeenCalledWith(value);
  });
});
