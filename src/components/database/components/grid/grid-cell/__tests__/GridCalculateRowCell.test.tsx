import { cleanup, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
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

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/components/grid/grid-calculation-cell/CalcationMenu', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-calculation-cell', () => ({ CalculationCell: () => null }));

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

  return { context, Wrapper, calculation, liveRows, databaseDoc };
}

describe('GridCalculateRowCellWithValues', () => {
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
});
