import { fireEvent, render, screen, within } from '@testing-library/react';
import dayjs from 'dayjs';

import { FormulaCell as FormulaCellType } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { date, list } from '@/application/database-yjs/fields/formula/values';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { DateFormat, TimeFormat, User } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { AFConfigContext } from '@/components/main/app.hooks';

import { FormulaCell } from './FormulaCell';

jest.mock('@/components/database/components/property/formula/FormulaEditorDialog', () => ({
  FormulaEditorDialog: () => <div data-testid={'mock-formula-editor-dialog'} />,
}));

function createCell(overrides: Partial<FormulaCellType> = {}): FormulaCellType {
  return {
    createdAt: 0,
    lastModified: 0,
    fieldType: FieldType.Formula,
    data: '42',
    resultType: 'number',
    rawNumeric: 42,
    ...overrides,
  };
}

describe('FormulaCell', () => {
  it('renders number results right-aligned with the formatted text', () => {
    render(<FormulaCell cell={createCell({ data: '$42' })} rowId={'r1'} fieldId={'f1'} wrap={false} />);

    const cell = screen.getByTestId('formula-cell-r1-f1');

    expect(cell.textContent).toBe('$42');
    expect(cell.className).toContain('justify-end');
    expect(cell.getAttribute('data-result-type')).toBe('number');
  });

  it('renders boolean results as a read-only checkbox', () => {
    const { rerender } = render(
      <FormulaCell
        cell={createCell({ resultType: 'boolean', rawBoolean: true, rawNumeric: undefined, data: 'Yes' })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
      />
    );

    expect(screen.queryByTestId('formula-checked-icon')).not.toBeNull();
    rerender(
      <FormulaCell
        cell={createCell({ resultType: 'boolean', rawBoolean: false, rawNumeric: undefined, data: 'No' })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
      />
    );
    expect(screen.queryByTestId('formula-unchecked-icon')).not.toBeNull();
  });

  it('renders Show as Bar for number results with the divisor ratio', () => {
    render(
      <FormulaCell
        cell={createCell({
          rawNumeric: 25,
          visualization: { type: RollupShowAsType.Bar, color: 'fill-default', divisor: 50, showNumber: true },
        })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
      />
    );

    const bar = screen.getByTestId('formula-bar-visualization');

    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.textContent).toContain('42');
  });

  it('never visualizes on card cells or for non-number results', () => {
    render(
      <FormulaCell
        cell={createCell({ visualization: { type: RollupShowAsType.Ring, color: 'x', divisor: 0, showNumber: false } })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
        isCardCell
      />
    );

    expect(screen.queryByTestId('formula-ring-visualization')).toBeNull();
    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('42');
  });

  it('shows an error state with the message in a tooltip', () => {
    render(
      <FormulaCell
        cell={createCell({ data: '', rawNumeric: undefined, resultType: 'any', error: 'Unknown property "Nope" [1,1]' })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
      />
    );

    expect(screen.getByTestId('formula-cell-error-r1-f1').textContent).toContain('Error');
  });

  it('explains missing references and provides an edit action without triggering the containing row', async () => {
    const setEditing = jest.fn();
    const onRowClick = jest.fn();

    render(
      <div onClick={onRowClick}>
        <FormulaCell
          cell={createCell({
            data: '',
            resultType: 'any',
            rawNumeric: undefined,
            error: 'Unknown property "deleted-id" [1,1]',
            missingPropertyRef: 'deleted-id',
          })}
          rowId={'r1'}
          fieldId={'f1'}
          wrap={false}
          setEditing={setEditing}
        />
      </div>
    );

    const error = screen.getByTestId('formula-cell-error-r1-f1');

    expect(error.textContent).toBe('Missing property');
    fireEvent.focus(error);
    expect(
      within(await screen.findByRole('tooltip')).getByText(
        'A property used by this formula is missing. It may have been deleted.'
      )
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit formula' }));
    expect(setEditing).toHaveBeenCalledWith(true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows the missing-property state without an edit action in a read-only cell', () => {
    render(
      <FormulaCell
        cell={createCell({
          data: '',
          resultType: 'any',
          rawNumeric: undefined,
          error: 'Unknown property "deleted-id"',
          missingPropertyRef: 'deleted-id',
        })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
        setEditing={jest.fn()}
        readOnly
      />
    );

    expect(screen.getByTestId('formula-cell-error-r1-f1').textContent).toBe('Missing property');
    expect(screen.queryByRole('button', { name: 'Edit formula' })).toBeNull();
  });

  it('shows the placeholder only while the formula is blank', () => {
    const { rerender } = render(
      <FormulaCell
        cell={createCell({ data: '', rawNumeric: undefined, resultType: 'empty', isBlank: true })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
        placeholder={'Edit formula'}
      />
    );

    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('Edit formula');
    rerender(
      <FormulaCell
        cell={createCell({ data: '', rawNumeric: undefined, resultType: 'text' })}
        rowId={'r1'}
        fieldId={'f1'}
        wrap={false}
        placeholder={'Edit formula'}
      />
    );
    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('');
  });

  it("shows dates in the viewer's date and time formats", () => {
    const start = dayjs('2024-03-10T09:30:00').valueOf();
    const cell = createCell({
      resultType: 'date',
      rawNumeric: undefined,
      data: '03/10/2024 9:30 AM',
      value: list([date({ start, includeTime: true }), date({ start, includeTime: false })]),
    });
    const withUser = (metadata: Record<string, unknown>) => (
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          currentUser: { metadata } as unknown as User,
          updateCurrentUser: async () => undefined,
          openLoginModal: () => undefined,
        }}
      >
        <FormulaCell cell={cell} rowId={'r1'} fieldId={'f1'} wrap={false} />
      </AFConfigContext.Provider>
    );
    const { rerender } = render(
      withUser({ [MetadataKey.DateFormat]: DateFormat.ISO, [MetadataKey.TimeFormat]: TimeFormat.TwentyFourHour })
    );

    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('2024-03-10 09:30, 2024-03-10');
    rerender(withUser({}));
    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('03/10/2024 9:30 AM, 03/10/2024');
  });

  it('keeps the stored text for results without dates', () => {
    render(
      <FormulaCell cell={createCell({ data: '$42', value: undefined })} rowId={'r1'} fieldId={'f1'} wrap={false} />
    );

    expect(screen.getByTestId('formula-cell-r1-f1').textContent).toBe('$42');
  });

  it('mounts the (lazy) editor dialog while editing', async () => {
    render(<FormulaCell cell={createCell()} rowId={'r1'} fieldId={'f1'} wrap={false} editing setEditing={jest.fn()} />);

    expect(await screen.findByTestId('mock-formula-editor-dialog')).not.toBeNull();
  });
});
