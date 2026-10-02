import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { TextCell as TextCellType } from '@/application/database-yjs/cell.type';
import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { PlainTextCellEditing } from '@/components/database/components/cell/text/PlainTextCellEditing';
import { TextCell } from '@/components/database/components/cell/text/TextCell';

const mockUpdateCell = jest.fn();
let mockField: YDatabaseField | undefined;
let mockTemplateEditingRowId: string | undefined;

jest.mock('@/application/database-yjs/dispatch', () => ({ useUpdateCellDispatch: () => mockUpdateCell }));
jest.mock('@/application/database-yjs/selector', () => ({ useFieldSelector: () => ({ field: mockField }) }));
jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContextOptional: () => ({ templateEditingRowId: mockTemplateEditingRowId }),
}));
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  RichTextCellContent: ({ text }: { text: string }) => <div data-testid='rich-text-cell-content'>{text}</div>,
  RichTextCellEditor: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div data-testid='rich-text-cell-editor' aria-label={ariaLabel} />
  ),
}));

const bold: RichTextDelta = [{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }];

function makeField(type: FieldType, name = 'Notes') {
  const field = new Y.Doc().getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.type, type);
  field.set(YjsDatabaseKey.name, name);
  return field;
}

function formattedCell(): TextCellType {
  return { fieldType: FieldType.RichText, data: 'Hello world', richText: bold, createdAt: 0, lastModified: 0 };
}

describe('TextCell', () => {
  beforeEach(() => {
    mockUpdateCell.mockReset();
    mockField = makeField(FieldType.RichText);
    mockTemplateEditingRowId = undefined;
  });

  it("shows an empty URL property's placeholder as a hint, not as a link", () => {
    mockField = makeField(FieldType.URL, 'Website');
    const { container, rerender } = render(
      <TextCell rowId='row-1' fieldId='field-1' wrap={false} placeholder='Add Website' />
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
        cell={{ fieldType: FieldType.URL, data: 'https://appflowy.io', createdAt: 0, lastModified: 0 }}
      />
    );
    expect(cell.className).toContain('!text-text-action');
  });

  it('names its editor after the property, or after its hint', () => {
    const { rerender } = render(<TextCell rowId='row-1' fieldId='field-1' wrap={false} editing placeholder='Empty' />);

    expect(screen.getByTestId('rich-text-cell-editor').getAttribute('aria-label')).toBe('Notes');

    mockField = makeField(FieldType.RichText, '');
    rerender(<TextCell rowId='row-1' fieldId='field-1' wrap={false} editing placeholder='Untitled' />);
    expect(screen.getByTestId('rich-text-cell-editor').getAttribute('aria-label')).toBe('Untitled');
  });

  describe('hosts that edit as plain text', () => {
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
});
