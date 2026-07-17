import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType, SelectOptionColor } from '@/application/database-yjs';
import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import {
  YDatabaseField,
  YDatabaseRow,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
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
    const row = rowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
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
});
