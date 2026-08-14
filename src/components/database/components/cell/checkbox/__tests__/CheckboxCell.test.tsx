import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs';
import { CheckboxCell } from '@/components/database/components/cell/checkbox/CheckboxCell';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => jest.fn(),
}));

const baseCell = {
  createdAt: 0,
  lastModified: 0,
  fieldType: FieldType.Checkbox,
};

describe('CheckboxCell', () => {
  it('renders a newly converted checked value on the first prop update', () => {
    const rendered = render(
      <CheckboxCell cell={{ ...baseCell, data: 'No' }} fieldId='done' readOnly={false} rowId='row-1' wrap={false} />
    );

    expect(screen.getByTestId('checkbox-unchecked-icon')).toBeTruthy();

    rendered.rerender(
      <CheckboxCell cell={{ ...baseCell, data: 'Yes' }} fieldId='done' readOnly={false} rowId='row-1' wrap={false} />
    );

    expect(screen.getByTestId('checkbox-checked-icon')).toBeTruthy();
    expect(screen.queryByTestId('checkbox-unchecked-icon')).toBeNull();
  });
});
