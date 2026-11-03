import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseContext, DatabaseContextState, DatabaseSearchQueryContext } from '@/application/database-yjs/context';
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
jest.mock('@/components/database/components/grid/grid-calculation-cell', () => ({
  CalculationCell: ({ cell }: { cell?: { value: string } }) => (
    <output data-testid='calculation-value'>{cell?.value}</output>
  ),
}));

const fieldId = 'amount';
const rowOrders = ['a', 'b', 'c'].map((id) => ({ id, height: 36 }));
const completeCells = new Map<string, unknown>([
  ['a', '10'],
  ['b', '20'],
  ['c', '30'],
]);
const documents: YDoc[] = [];

function fixture(readOnly = false, isDashboardWidget = false) {
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
    isDashboardWidget,
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

  describe('inside a dashboard widget (WP07 P0-5)', () => {
    it('inside a dashboard widget a writer never writes calculation_value', async () => {
      const { Wrapper, calculation, databaseDoc } = fixture(false, true);
      const updates = jest.fn();

      databaseDoc.on('update', updates);
      render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map([['a', '10']])} ready />, {
        wrapper: Wrapper,
      });
      await waitFor(() => expect(screen.getByTestId('calculation-value').textContent).toBe('10'));
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
      expect(updates).not.toHaveBeenCalled();
    });

    it('shows the value computed from the widget rows', async () => {
      const { Wrapper } = fixture(true, true);
      const { rerender } = render(
        <GridCalculateRowCellWithValues
          fieldId={fieldId}
          cells={
            new Map([
              ['a', '10'],
              ['c', '30'],
            ])
          }
          ready
        />,
        { wrapper: Wrapper }
      );

      // Readers see the widget's own total too, not the shared one.
      await waitFor(() => expect(screen.getByTestId('calculation-value').textContent).toBe('40'));
      rerender(<GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map([['a', '10']])} ready={false} />);
      expect(screen.getByTestId('calculation-value').textContent).toBe('');
    });

    it('outside widgets it still persists as before', async () => {
      const { Wrapper, calculation } = fixture(false, false);

      render(<GridCalculateRowCellWithValues fieldId={fieldId} cells={new Map([['a', '10']])} ready />, {
        wrapper: Wrapper,
      });
      await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('10'));
      expect(screen.getByTestId('calculation-value').textContent).toBe('10');
    });
  });

  describe('while a row search is active (WP09 §1.2)', () => {
    it('never writes calculation_value and shows the value of the searched rows', async () => {
      const { Wrapper, calculation, databaseDoc } = fixture(false, false);
      const updates = jest.fn();

      databaseDoc.on('update', updates);
      render(
        <Wrapper>
          <DatabaseSearchQueryContext.Provider value='launch'>
            <GridCalculateRowCellWithValues
              fieldId={fieldId}
              cells={
                new Map([
                  ['a', '10'],
                  ['b', '20'],
                ])
              }
              ready
            />
          </DatabaseSearchQueryContext.Provider>
        </Wrapper>
      );
      await waitFor(() => expect(screen.getByTestId('calculation-value').textContent).toBe('30'));
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
      expect(updates).not.toHaveBeenCalled();
    });

    it('persists again once the search is cleared', async () => {
      const { Wrapper, calculation } = fixture(false, false);
      const cells = new Map([['a', '10']]);
      const { rerender } = render(
        <Wrapper>
          <DatabaseSearchQueryContext.Provider value='launch'>
            <GridCalculateRowCellWithValues fieldId={fieldId} cells={cells} ready />
          </DatabaseSearchQueryContext.Provider>
        </Wrapper>
      );

      await waitFor(() => expect(screen.getByTestId('calculation-value').textContent).toBe('10'));
      expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('60');
      rerender(
        <Wrapper>
          <DatabaseSearchQueryContext.Provider value=''>
            <GridCalculateRowCellWithValues fieldId={fieldId} cells={cells} ready />
          </DatabaseSearchQueryContext.Provider>
        </Wrapper>
      );
      await waitFor(() => expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('10'));
    });
  });
});
