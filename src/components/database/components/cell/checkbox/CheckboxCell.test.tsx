import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs';
import { CheckboxCell as CheckboxCellType } from '@/application/database-yjs/cell.type';
import { CheckboxCell } from '@/components/database/components/cell/checkbox/CheckboxCell';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => jest.fn(),
}));

function makeCell(data: string): CheckboxCellType {
  return {
    createdAt: 0,
    data,
    fieldType: FieldType.Checkbox,
    lastModified: 0,
  };
}

describe('CheckboxCell', () => {
  it('rerenders from remote cell data changes', () => {
    const { rerender } = render(
      <CheckboxCell
        cell={makeCell('No')}
        fieldId="done-field"
        rowId="row-1"
      />
    );

    expect(screen.getByTestId('checkbox-cell-row-1-done-field').getAttribute('data-checked')).toBe('false');
    expect(screen.getByTestId('checkbox-unchecked-icon')).not.toBeNull();

    rerender(
      <CheckboxCell
        cell={makeCell('Yes')}
        fieldId="done-field"
        rowId="row-1"
      />
    );

    expect(screen.getByTestId('checkbox-cell-row-1-done-field').getAttribute('data-checked')).toBe('true');
    expect(screen.getByTestId('checkbox-checked-icon')).not.toBeNull();
  });
});
