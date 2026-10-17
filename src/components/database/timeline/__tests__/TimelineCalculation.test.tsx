import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { publishExternalDatabaseFields, registerExternalDatabaseFields } from '@/application/database-yjs/external-fields';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { TimelineRowValuesProvider } from '@/application/database-yjs/hooks/TimelineRowValuesProvider';
import { Row } from '@/application/database-yjs/selector';
import { VerificationViewSettings } from '@/application/page-verification/types';
import {
  YDatabase, YDatabaseCalculation, YDatabaseCalculations, YDatabaseFields, YDatabaseView, YDatabaseViews,
  YDoc, YjsDatabaseKey as K, YjsEditorKey,
} from '@/application/types';

import { TimelineCalculation } from '../TimelineCalculation';

let mockSettings: VerificationViewSettings = {};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/page-verification/database', () => ({
  useDatabaseVerification: () => ({ settings: mockSettings }),
}));
jest.mock('@/components/database/components/grid/grid-calculation-cell/CalcationMenu', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/database/components/grid/grid-calculation-cell', () => ({
  CalculationCell: ({ cell }: { cell?: { value: string } }) => <span data-testid='calculation'>{cell?.value ?? 'loading'}</span>,
}));

const fieldId = 'value';
const rowOrders = ['a', 'b', 'c'].map((id) => ({ id, height: 36 }));
const disposers: Array<() => void> = [];

function fixture({ withRows = true, type = FieldType.Verification } = {}) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([{
    id: fieldId, name: 'Value', type,
    typeOption: type === FieldType.Verification ? { property_id: 'generation' } : undefined,
  }]).clone() as YDatabaseFields;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const calculations = new Y.Array() as YDatabaseCalculations;
  const calculation = new Y.Map() as YDatabaseCalculation;

  calculation.set(K.id, 'calculation');
  calculation.set(K.field_id, fieldId);
  calculation.set(K.type, type === FieldType.Verification ? CalculationType.CountNonEmpty : CalculationType.Sum);
  calculation.set(K.calculation_value, '777');
  calculations.push([calculation]);
  view.set(K.id, 'view');
  view.set(K.calculations, calculations);
  view.set(K.row_orders, Y.Array.from(rowOrders));
  views.set('view', view);
  database.set(K.id, databaseDoc.guid);
  database.set(K.fields, fields);
  database.set(K.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const docs = Object.fromEntries(rowOrders.map(({ id }, index) => [id, createRow(id, {
    [fieldId]: { type: type === FieldType.Verification ? FieldType.RichText : type, data: String((index + 1) * 10) },
  }).doc]));
  const context: DatabaseContextState = {
    databaseDoc, databasePageId: 'view', activeViewId: 'view', workspaceId: 'workspace',
    readOnly: false, rowMap: withRows ? docs : {},
  };
  const values = new Map<string, string>();
  const unregister = registerExternalDatabaseFields(fields, type === FieldType.Verification ? [{
    field: fields.get(fieldId), readValue: (id) => values.get(id),
  }] : []);

  disposers.push(unregister, () => databaseDoc.destroy(), ...Object.values(docs).map((doc) => () => doc.destroy()));
  const tree = (orders: Row[] | undefined) => (
    <DatabaseContext.Provider value={context}>
      <TimelineRowValuesProvider rowOrders={orders}>
        <TimelineCalculation fieldId={fieldId} />
      </TimelineRowValuesProvider>
    </DatabaseContext.Provider>
  );
  const publish = () => act(async () => {
    publishExternalDatabaseFields(fields);
    await Promise.resolve();
  });

  return { context, fields, docs, calculation, values, unregister, tree, publish };
}

beforeEach(() => { mockSettings = { calculation: 'count_non_empty' }; });
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => dispose());
});

it.each([false, true])('counts authoritative values without using source cells (row documents loaded: %s)', async (withRows) => {
  const f = fixture({ withRows });
  const originalRows = Object.values(f.docs).map((doc) => doc.toJSON());

  f.values.set('a', 'Verified').set('b', 'Expired').set('c', '');
  render(f.tree(rowOrders));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('2'));
  expect(f.calculation.get(K.calculation_value)).toBe('777');
  expect(Object.values(f.docs).map((doc) => doc.toJSON())).toEqual(originalRows);
});

it('waits for every visible Cloud value and refreshes after claim changes and disconnection', async () => {
  const f = fixture();

  f.values.set('a', 'Verified').set('b', '');
  render(f.tree(rowOrders));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('loading'));
  f.values.set('c', 'Expired');
  await f.publish();
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('2'));
  f.values.set('a', '');
  await f.publish();
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('1'));
  await act(async () => { f.unregister(); await Promise.resolve(); });
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('loading'));
  expect(f.calculation.get(K.calculation_value)).toBe('777');
});

it('recalculates on an expiry publication without any native row change', async () => {
  const f = fixture();
  const before = Object.values(f.docs).map((doc) => doc.toJSON());

  mockSettings = { calculation: 'count_unique' };
  f.values.set('a', 'Verified').set('b', 'Verified').set('c', '');
  render(f.tree(rowOrders));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('1'));
  f.values.set('a', 'Expired');
  await f.publish();
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('2'));
  expect(Object.values(f.docs).map((doc) => doc.toJSON())).toEqual(before);
});

it('uses current visible membership and keeps an unresolved row order unknown', async () => {
  const f = fixture();

  f.values.set('a', 'Verified');
  const app = render(f.tree(undefined));

  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('loading'));
  app.rerender(f.tree(rowOrders.slice(0, 1)));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('1'));
  app.rerender(f.tree(rowOrders));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('loading'));
  app.rerender(f.tree([]));
  await waitFor(() => expect(screen.getByTestId('calculation').textContent).toBe('0'));
});

it('retains the complete native row source for ordinary Timeline calculations', async () => {
  const f = fixture({ type: FieldType.Number });

  mockSettings = {};
  f.context.rowMap = { a: f.docs.a };
  const app = render(f.tree(rowOrders));

  expect(f.calculation.get(K.calculation_value)).toBe('777');
  f.context.rowMap = f.docs;
  app.rerender(f.tree(rowOrders));
  await waitFor(() => expect(String(f.calculation.get(K.calculation_value))).toBe('60'));
});
