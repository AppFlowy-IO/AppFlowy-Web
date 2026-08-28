import { fireEvent, render, screen } from '@testing-library/react';

import TextCellEditing from '@/components/database/components/cell/text/TextCellEditing';

const mockUpdateCell = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => mockUpdateCell,
}));

describe('TextCellEditing external value reconciliation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updates a clean editor when undo, redo, or remote sync changes the value', () => {
    const { rerender } = render(<TextCellEditing defaultValue='before' fieldId='field-id' rowId='row-id' />);

    expect(screen.getByRole('textbox').value).toBe('before');

    rerender(<TextCellEditing defaultValue='after' fieldId='field-id' rowId='row-id' />);

    expect(screen.getByRole('textbox').value).toBe('after');
    expect(mockUpdateCell).not.toHaveBeenCalled();
  });

  it('preserves and commits a dirty draft when the external value changes', () => {
    const onExit = jest.fn();
    const { rerender } = render(
      <TextCellEditing defaultValue='before' fieldId='field-id' onExit={onExit} rowId='row-id' />
    );
    const editor = screen.getByRole('textbox');

    fireEvent.change(editor, { target: { value: 'local draft' } });
    rerender(<TextCellEditing defaultValue='remote value' fieldId='field-id' onExit={onExit} rowId='row-id' />);

    expect(editor.value).toBe('local draft');
    expect(editor.getAttribute('data-database-history-hotkeys')).toBeNull();

    fireEvent.blur(editor);

    expect(mockUpdateCell).toHaveBeenCalledTimes(1);
    expect(mockUpdateCell).toHaveBeenCalledWith('local draft');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
