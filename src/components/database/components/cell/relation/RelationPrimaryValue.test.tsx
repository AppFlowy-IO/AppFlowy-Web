import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType, SelectOptionColor } from '@/application/database-yjs';
import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { RelationPrimaryValue } from '@/components/database/components/cell/relation/RelationPrimaryValue';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

describe('RelationPrimaryValue', () => {
  it('reacts to schema-only switches and keeps the stored cell payload readable', async () => {
    const fieldId = 'primary-field';
    const fieldDoc = new Y.Doc();
    const field = fieldDoc.getMap('field') as YDatabaseField;
    const typeOptions = new Y.Map();
    const multiSelectOption = new Y.Map();

    multiSelectOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        options: [
          {
            id: 'option-a',
            name: 'Alpha',
            color: SelectOptionColor.OptionColor1,
          },
        ],
      })
    );
    typeOptions.set(String(FieldType.MultiSelect), multiSelectOption);
    field.set(YjsDatabaseKey.type, FieldType.MultiSelect);
    field.set(YjsDatabaseKey.type_option, typeOptions);

    const rowDoc = createRowDoc('row-id', 'database-id', {
      [fieldId]: { fieldType: FieldType.MultiSelect, data: 'option-a' },
    });
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);
    const { container } = render(<RelationPrimaryValue field={field} fieldId={fieldId} rowDoc={rowDoc} />);

    await waitFor(() => expect(container.textContent).toBe('Alpha'));

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.RichText);
    });

    await waitFor(() => expect(container.textContent).toBe('Alpha'));

    act(() => {
      cell.set(YjsDatabaseKey.data, 'Edited');
      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    });

    await waitFor(() => expect(container.textContent).toBe('Edited'));
  });

  it('reports the decoded title as the related row changes', async () => {
    const fieldId = 'primary-field';
    const fieldDoc = new Y.Doc();
    const field = fieldDoc.getMap('field') as YDatabaseField;
    const onTextChange = jest.fn();
    const rowDoc = createRowDoc('row-id', 'database-id', {
      [fieldId]: { fieldType: FieldType.RichText, data: 'Acme' },
    });
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    field.set(YjsDatabaseKey.type, FieldType.RichText);

    render(<RelationPrimaryValue field={field} fieldId={fieldId} onTextChange={onTextChange} rowDoc={rowDoc} />);

    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Acme'));
    expect(screen.getByText('Acme')).toBeTruthy();

    act(() => {
      cell.set(YjsDatabaseKey.data, 'Globex');
    });

    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Globex'));
    expect(screen.getByText('Globex')).toBeTruthy();
  });

  it('renders a primary cell that arrives after the row structure', async () => {
    const fieldId = 'primary-field';
    const fieldDoc = new Y.Doc();
    const field = fieldDoc.getMap('field') as YDatabaseField;
    const rowDoc = new Y.Doc() as YDoc;
    const row = new Y.Map() as YDatabaseRow;
    const cells = new Y.Map();

    field.set(YjsDatabaseKey.type, FieldType.RichText);
    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    row.set(YjsDatabaseKey.cells, cells);

    const { container } = render(<RelationPrimaryValue field={field} fieldId={fieldId} rowDoc={rowDoc} />);

    await waitFor(() => expect(container.textContent).toBe(''));

    act(() => {
      const cell = new Y.Map();

      cells.set(fieldId, cell);
      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      cell.set(YjsDatabaseKey.data, 'Late title');
    });

    await waitFor(() => expect(screen.getByText('Late title')).toBeTruthy());
  });
});
