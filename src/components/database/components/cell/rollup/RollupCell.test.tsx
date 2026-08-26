import { fireEvent, render, screen } from '@testing-library/react';

import { RollupCell as RollupCellType } from '@/application/database-yjs/cell.type';
import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { RollupCell } from '@/components/database/components/cell/rollup/RollupCell';

const mockNavigateToRow = jest.fn();
const mockDatabaseContext = {
  databasePageId: 'current-view',
  navigateToRow: mockNavigateToRow,
};

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabaseContextOptional: () => mockDatabaseContext,
}));

function createCell(overrides: Partial<RollupCellType> = {}): RollupCellType {
  return {
    createdAt: 0,
    lastModified: 0,
    fieldType: FieldType.Rollup,
    data: 'EPC-013, EPC-014',
    ...overrides,
  };
}

describe('RollupCell list navigation', () => {
  beforeEach(() => {
    mockNavigateToRow.mockClear();
  });

  it('opens each structured rollup item in its related database', () => {
    const onCellClick = jest.fn();
    const cell = createCell({
      list: ['EPC-013', 'EPC-014'],
      listItems: [
        { label: 'EPC-013', rowId: 'epic-row-13', viewId: 'epics-view' },
        { label: 'EPC-014', rowId: 'epic-row-14', viewId: 'epics-view' },
      ],
    });

    render(
      <div onClick={onCellClick}>
        <RollupCell cell={cell} rowId={'project-row'} fieldId={'epics-rollup'} wrap={false} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'EPC-013' }));
    fireEvent.click(screen.getByRole('button', { name: 'EPC-014' }));

    expect(mockNavigateToRow).toHaveBeenNthCalledWith(1, 'epic-row-13', 'epics-view');
    expect(mockNavigateToRow).toHaveBeenNthCalledWith(2, 'epic-row-14', 'epics-view');
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('keeps legacy text-only list values readable without making them false links', () => {
    render(
      <RollupCell
        cell={createCell({ list: ['EPC-013', 'EPC-014'] })}
        rowId={'project-row'}
        fieldId={'epics-rollup'}
        wrap={false}
      />
    );

    expect(screen.getByText('EPC-013')).toBeTruthy();
    expect(screen.getByText('EPC-014')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders the Desktop bar visualization using the configured divisor', () => {
    render(
      <RollupCell
        cell={createCell({
          data: '40',
          rawNumeric: 40,
          targetFieldType: FieldType.Number,
          calculationType: CalculationType.Sum,
          showAs: RollupDisplayMode.Calculated,
          visualization: { type: RollupShowAsType.Bar, color: 'fill-default', divisor: 80, showNumber: false },
        })}
        rowId={'project-row'}
        fieldId={'budget-rollup'}
        wrap={false}
      />
    );

    const bar = screen.getByTestId('rollup-bar-visualization');

    expect(bar.textContent).toBe('');
    expect(screen.getByRole('progressbar', { name: '40' })).toBe(bar);
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-valuetext')).toBe('40');
    expect(bar.querySelector<HTMLElement>('[style]')?.style.width).toBe('50%');
  });

  it('renders a ring with its number when Show number is enabled', () => {
    render(
      <RollupCell
        cell={createCell({
          data: '25',
          rawNumeric: 25,
          targetFieldType: FieldType.Number,
          calculationType: CalculationType.Sum,
          showAs: RollupDisplayMode.Calculated,
          visualization: { type: RollupShowAsType.Ring, color: 'text-color-2', divisor: 100, showNumber: true },
        })}
        rowId={'project-row'}
        fieldId={'budget-rollup'}
        wrap={false}
      />
    );

    expect(screen.getByTestId('rollup-ring-visualization').textContent).toBe('25');
    expect(screen.getByLabelText('25%')).toBeTruthy();
  });
});
