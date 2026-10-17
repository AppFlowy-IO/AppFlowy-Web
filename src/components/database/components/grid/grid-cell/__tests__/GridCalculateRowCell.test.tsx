import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { VerificationViewSettings } from '@/application/page-verification/types';
import {
  YDatabase,
  YDatabaseCalculation,
  YDatabaseCalculations,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { GridCalculateRowCell, GridCalculateRowCellWithValues } from '../GridCalculateRowCell';

import type { ReactNode } from 'react';

const mockUpdateSettings = jest.fn();
let mockSettings: VerificationViewSettings;

jest.mock('@/application/page-verification/database', () => ({
  useDatabaseVerification: () => ({ settings: mockSettings, updateSettings: mockUpdateSettings }),
}));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/components/grid/grid-calculation-cell/CalcationMenu', () => ({
  __esModule: true,
  default: ({
    open,
    onChangeType,
    onClear,
  }: {
    open?: boolean;
    onChangeType: (type: CalculationType) => void;
    onClear: () => void;
  }) =>
    open ? (
      <>
        <button onClick={() => onChangeType(CalculationType.Count)}>Count</button>
        <button onClick={onClear}>Clear</button>
      </>
    ) : null,
}));
jest.mock('@/components/database/components/grid/grid-calculation-cell', () => ({
  CalculationCell: ({ cell }: { cell?: { type: CalculationType; value: string } }) =>
    cell ? (
      <span data-testid='calculation-value'>
        {cell.type}:{cell.value}
      </span>
    ) : null,
}));

const fieldId = 'amount';
const rowOrders = ['a', 'b', 'c'].map((id) => ({ id, height: 36 }));
const completeCells = new Map<string, unknown>([
  ['a', '10'],
  ['b', '20'],
  ['c', '30'],
]);
const documents: YDoc[] = [];

function fixture(readOnly = false) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const calculations = new Y.Array() as YDatabaseCalculations;
  const calculation = new Y.Map() as YDatabaseCalculation;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.Number);
  fields.set(fieldId, field);
  calculation.set(YjsDatabaseKey.id, 'sum');
  calculation.set(YjsDatabaseKey.field_id, fieldId);
  calculation.set(YjsDatabaseKey.type, CalculationType.Sum);
  calculation.set(YjsDatabaseKey.calculation_value, '60');
  calculations.push([calculation]);
  view.set(YjsDatabaseKey.calculations, calculations);
  views.set('view', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const liveRows = Object.fromEntries(
    Array.from(completeCells, ([id, data]) => [
      id,
      createRowDoc(id, 'database', { [fieldId]: { fieldType: FieldType.Number, data } }),
    ])
  );

  documents.push(databaseDoc, ...Object.values(liveRows));
  const context = {
    databaseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    workspaceId: 'workspace',
    rowMap: { a: liveRows.a },
    readOnly,
    ensureRow: jest.fn(),
  } as DatabaseContextState;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { context, Wrapper, calculation, liveRows, databaseDoc, field, calculations };
}

describe('GridCalculateRowCellWithValues', () => {
  beforeEach(() => {
    mockSettings = {};
    mockUpdateSettings.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    documents.splice(0).forEach((doc) => doc.destroy());
  });

  it('preserves a saved sum until the full snapshot is ready, without reading the live subset', async () => {
    const { Wrapper, calculation } = fixture();
    const { rerender } = render(
      <GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map([['a', '10']])} ready={false} />,
      { wrapper: Wrapper }
    );

    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />);
    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');

    const updated = new Map(completeCells).set('c', '60');

    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={updated} ready />);
    await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('90'));
  });

  it('preserves the last complete sum while an added row is loading', async () => {
    const { Wrapper, calculation } = fixture();
    const { rerender } = render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />, {
      wrapper: Wrapper,
    });

    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready={false} />);
    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map(completeCells).set('d', '40')} ready />);
    await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('100'));
  });

  it('does not persist calculations from read-only views', () => {
    const { Wrapper, calculation } = fixture(true);

    render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map([['a', '999']])} ready />, {
      wrapper: Wrapper,
    });
    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
  });

  it('retains the existing Grid live-row selector behavior', async () => {
    const { Wrapper, context, calculation, liveRows } = fixture();
    const { rerender } = render(<GridCalculateRowCell fieldId={fieldId} rowOrders={rowOrders} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('10'));
    context.rowMap = liveRows;
    rerender(<GridCalculateRowCell fieldId={fieldId} rowOrders={rowOrders} />);
    await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60'));
  });

  it.each([undefined, null])('does not use dormant Number Sum when the Verification selection is %s', (selection) => {
    const f = fixture();

    f.field.set(YjsDatabaseKey.type, FieldType.Verification);
    mockSettings = { calculation: selection };
    render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />, { wrapper: f.Wrapper });
    expect(screen.queryByTestId('calculation-value')).toBeNull();
    expect(f.calculation.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);
    expect(f.calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
  });

  it('clears only the Cloud selection and retains the dormant native calculation', async () => {
    const f = fixture();

    f.field.set(YjsDatabaseKey.type, FieldType.Verification);
    mockSettings = { calculation: 'count' };
    mockUpdateSettings.mockImplementation(async (patch: VerificationViewSettings) => {
      mockSettings = { ...mockSettings, ...patch };
    });
    const { rerender } = render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />, {
      wrapper: f.Wrapper,
    });

    expect(screen.getByTestId('calculation-value').textContent).toBe(`${CalculationType.Count}:3`);
    fireEvent.click(screen.getByTestId(`grid-calculate-cell-${fieldId}`));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ calculation: null }));
    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />);
    expect(screen.queryByTestId('calculation-value')).toBeNull();
    expect(f.calculations.length).toBe(1);
    expect(f.calculation.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);
  });

  it('restores the original Number calculation after a Verification roundtrip', () => {
    const f = fixture();

    f.field.set(YjsDatabaseKey.type, FieldType.Verification);
    mockSettings = { calculation: 'count' };
    const { rerender } = render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />, {
      wrapper: f.Wrapper,
    });

    expect(screen.getByTestId('calculation-value').textContent).toBe(`${CalculationType.Count}:3`);
    act(() => {
      f.field.set(YjsDatabaseKey.type, FieldType.Number);
    });
    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready />);
    expect(screen.getByTestId('calculation-value').textContent).toBe(`${CalculationType.Sum}:60`);
    expect(f.calculations.length).toBe(1);
  });

  it('does not delete Number Sum when an older Verification settings write finishes after conversion', async () => {
    const f = fixture();
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => {
      finish = resolve;
    });

    f.field.set(YjsDatabaseKey.type, FieldType.Verification);
    mockUpdateSettings.mockReturnValueOnce(saved);
    const { rerender } = render(
      <GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready={false} />,
      { wrapper: f.Wrapper }
    );

    fireEvent.click(screen.getByTestId(`grid-calculate-cell-${fieldId}`));
    fireEvent.click(screen.getByRole('button', { name: 'Count' }));
    expect(mockUpdateSettings).toHaveBeenCalledWith({ calculation: 'count' });
    act(() => {
      f.field.set(YjsDatabaseKey.type, FieldType.Number);
    });
    rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={completeCells} ready={false} />);
    await act(async () => {
      finish();
      await saved;
    });
    expect(f.calculations.length).toBe(1);
    expect(f.calculation.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);
    expect(f.calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
  });
});
