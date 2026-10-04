import { fireEvent, render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { TextCell as TextCellType } from '@/application/database-yjs/cell.type';
import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { PlainTextCellEditing } from '@/components/database/components/cell/text/PlainTextCellEditing';
import { TextCell } from '@/components/database/components/cell/text/TextCell';

const mockUpdateCell = jest.fn();
const mockEditorProps = jest.fn();
let mockTemplateEditingRowId: string | undefined;
let mockEditorUnavailable = false;

jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/fields/text/rich-text-notice', () => ({ notifyRichTextNewer: jest.fn() }));
// The cell's renderer (Cell, Property) passes the field's type and name: the
// cell itself must not observe the field once more.
jest.mock('@/application/database-yjs/selector', () => ({ useFieldSelector: jest.fn() }));
jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContextOptional: () => ({ templateEditingRowId: mockTemplateEditingRowId }),
}));
jest.mock('@/components/database/components/cell/text/rich-text/RichTextCellDocument', () => ({
  __esModule: true,
  default: () => null,
}));
// A stand-in for the editor that can also fail to render: the cell then
// falls back to its plain-text editor.
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  RichTextCellEditor: (props: { ariaLabel?: string }) => {
    mockEditorProps(props);
    if (mockEditorUnavailable) throw new Error('Failed to fetch dynamically imported module');
    return <div data-testid='rich-text-cell-editor' aria-label={props.ariaLabel} />;
  },
}));

const bold: RichTextDelta = [{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }];

function formattedCell(): TextCellType {
  return { fieldType: FieldType.RichText, data: 'Hello world', richText: bold, createdAt: 0, lastModified: 0 };
}

describe('TextCell', () => {
  beforeEach(() => {
    mockUpdateCell.mockReset();
    mockEditorProps.mockReset();
    (notifyRichTextNewer as jest.Mock).mockReset();
    mockTemplateEditingRowId = undefined;
    mockEditorUnavailable = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows an empty URL property's placeholder as a hint, not as a link", () => {
    const { container, rerender } = render(
      <TextCell rowId='row-1' fieldId='field-1' wrap={false} placeholder='Add Website' fieldType={FieldType.URL} />
    );
    const cell = container.firstElementChild as HTMLElement;

    expect(cell.textContent).toBe('Add Website');
    expect(cell.className).toContain('text-text-tertiary');
    expect(cell.className).not.toContain('text-text-action');

    rerender(
      <TextCell
        rowId='row-1'
        fieldId='field-1'
        wrap={false}
        placeholder='Add Website'
        fieldType={FieldType.URL}
        cell={{ fieldType: FieldType.URL, data: 'https://appflowy.io', createdAt: 0, lastModified: 0 }}
      />
    );
    expect(cell.className).toContain('!text-text-action');
  });

  it("edits an empty URL property as plain text: the field's type decides, not the missing cell", () => {
    render(<TextCell rowId='row-1' fieldId='field-1' wrap={false} editing fieldType={FieldType.URL} />);

    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(mockEditorProps).not.toHaveBeenCalled();
    // The type came from the renderer; the cell did not subscribe to the field.
    expect(useFieldSelector).not.toHaveBeenCalled();
  });

  it('names its editor after the property, or after its hint', () => {
    const { rerender } = render(
      <TextCell rowId='row-1' fieldId='field-1' wrap={false} editing placeholder='Empty' fieldName='Notes' />
    );

    expect(screen.getByTestId('rich-text-cell-editor').getAttribute('aria-label')).toBe('Notes');

    rerender(<TextCell rowId='row-1' fieldId='field-1' wrap={false} editing placeholder='Untitled' fieldName='' />);
    expect(screen.getByTestId('rich-text-cell-editor').getAttribute('aria-label')).toBe('Untitled');
  });

  it('shows formatting that needs no editor without loading one', () => {
    render(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} />);

    expect(screen.getByTestId('rich-text-cell-content').querySelector('strong')?.textContent).toBe('world');
    expect(mockEditorProps).not.toHaveBeenCalled();
  });

  it('edits as plain text when the rich editor cannot be loaded', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockEditorUnavailable = true;
    const setEditing = jest.fn();

    render(
      <TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} editing setEditing={setEditing} />
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');

    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('Hello world');

    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13, which: 13 });
    expect(mockUpdateCell).toHaveBeenCalledWith('Hello there');
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  it('keeps the props of the (memoized) editor the same while the cell is only hovered', () => {
    const setEditing = jest.fn();
    const cell = formattedCell();
    const props = { rowId: 'row-1', fieldId: 'field-1', wrap: false, cell, editing: true, setEditing };
    const { rerender } = render(<TextCell {...props} />);

    rerender(<TextCell {...props} isHovering />);

    const [[first], [second]] = mockEditorProps.mock.calls as [{ onExit: () => void; richText: unknown }][];

    expect(second.onExit).toBe(first.onExit);
    expect(second.richText).toBe(first.richText);

    second.onExit();
    expect(setEditing).toHaveBeenCalledWith(false);
  });

  describe('hosts that edit as plain text', () => {
    it('does not save or trim an untouched formatted calendar property', () => {
      const cell: TextCellType = {
        ...formattedCell(),
        data: ' Hello ',
        richText: [{ insert: ' Hello ', attributes: { bold: true } }],
      };

      render(
        <PlainTextCellEditing.Provider value>
          <TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={cell} editing />
        </PlainTextCellEditing.Provider>
      );
      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');

      fireEvent.focus(textarea);
      fireEvent.blur(textarea);
      expect(textarea.value).toBe(' Hello ');
      expect(mockUpdateCell).not.toHaveBeenCalled();
    });

    it('edit a formatted cell in a textarea in the calendar event popover, and keep its formatting', () => {
      const setEditing = jest.fn();
      const { rerender } = render(
        <PlainTextCellEditing.Provider value>
          <TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} />
        </PlainTextCellEditing.Provider>
      );

      // Not editing: the formatting still shows.
      expect(screen.getByTestId('rich-text-cell-content').textContent).toBe('Hello world');

      rerender(
        <PlainTextCellEditing.Provider value>
          <TextCell
            rowId='row-1'
            fieldId='field-1'
            wrap={false}
            cell={formattedCell()}
            editing
            setEditing={setEditing}
          />
        </PlainTextCellEditing.Provider>
      );

      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');

      expect(textarea.tagName).toBe('TEXTAREA');
      expect(textarea.value).toBe('Hello world');
      expect(screen.queryByTestId('rich-text-cell-editor')).toBeNull();

      // Enter without a change writes nothing, so the formatting stays.
      fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13, which: 13 });
      expect(mockUpdateCell).not.toHaveBeenCalled();
      expect(setEditing).toHaveBeenCalledWith(false);
    });

    it("show and edit a row template's source row as plain text", () => {
      mockTemplateEditingRowId = 'row-1';
      const { rerender } = render(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} />);

      expect(screen.queryByTestId('rich-text-cell-content')).toBeNull();
      expect(screen.getByText('Hello world')).toBeTruthy();

      rerender(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} editing />);
      expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
      expect(screen.queryByTestId('rich-text-cell-editor')).toBeNull();
    });

    it('edit other rows of the same database with the rich editor', () => {
      mockTemplateEditingRowId = 'template-row';
      render(<TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={formattedCell()} editing />);

      expect(screen.getByTestId('rich-text-cell-editor')).toBeTruthy();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  it.each([false, true])('blocks protected titles before mounting either editor, plain=%s', (plain) => {
    const setEditing = jest.fn();
    const cell = { ...formattedCell(), richTextReadOnly: true };

    render(
      <PlainTextCellEditing.Provider value={plain}>
        <TextCell rowId='row-1' fieldId='field-1' wrap={false} cell={cell} editing setEditing={setEditing} />
      </PlainTextCellEditing.Provider>
    );
    expect(mockEditorProps).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTestId('rich-text-cell-content').querySelector('strong')?.textContent).toBe('world');
    expect(notifyRichTextNewer).toHaveBeenCalledTimes(1);
    expect(setEditing).toHaveBeenCalledWith(false);
    expect(mockUpdateCell).not.toHaveBeenCalled();
  });

  it('unmounts an editor when the cell becomes protected', () => {
    const setEditing = jest.fn();
    const props = { rowId: 'row-1', fieldId: 'field-1', wrap: false, editing: true, setEditing };
    const { rerender } = render(<TextCell {...props} cell={formattedCell()} />);

    expect(screen.getByTestId('rich-text-cell-editor')).toBeTruthy();
    rerender(<TextCell {...props} cell={{ ...formattedCell(), richTextReadOnly: true }} />);
    expect(screen.queryByTestId('rich-text-cell-editor')).toBeNull();
    expect(notifyRichTextNewer).toHaveBeenCalledTimes(1);
    expect(setEditing).toHaveBeenCalledWith(false);
  });
});
