/** Published workflows and explicit product-specific guards are recorded in the
 * shared dataset. Every input tuple runs through the stored Yjs cell adapter. */
import Decimal from 'big.js';

import { FieldType } from '@/application/database-yjs/database.type';

import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import { CellSpec, createFields, createRow, FieldSpec, selectOptions } from './fixture';
import dataset from './researched-scenarios.json';

type Input = null | string | number | boolean | string[];
interface Scenario {
  id: string;
  inputs: Record<string, Input[]>;
  case_count: number;
}

const now = () => Date.parse(dataset.now_utc);
const field = (id: string, type: FieldType): FieldSpec => ({ id, name: id, type });
const formula = (id: string, expression: string): FieldSpec => ({
  ...field(id, FieldType.Formula),
  typeOption: { expression },
});
const numeric = (cells: Record<string, CellSpec>, id: string, value: Input) => {
  if (value !== null) cells[id] = { type: FieldType.Number, data: String(value) };
};

function products(id: string, dimensions: string[]) {
  const scenario = dataset.scenarios.find((scenario) => scenario.id === id) as unknown as Scenario;
  const result = dimensions.reduce<Input[][]>(
    (rows, key) => rows.flatMap((row) => scenario.inputs[key].map((value) => [...row, value])),
    [[]]
  );

  expect(result.length).toBe(scenario.case_count);
  return result;
}

function run(fields: FieldSpec[]) {
  const storedFields = createFields(fields);
  const schema = readFormulaSchema(storedFields);

  return {
    close: () => storedFields.doc?.destroy(),
    row: (
      cells: Record<string, CellSpec>,
      assertions: (read: (id: string) => ReturnType<typeof evaluateFormulaCell>) => void,
      caseId: string
    ) => {
      const fixture = createRow('research-case', cells);

      try {
        assertions((id) => {
          const result = evaluateFormulaCell({
            schema,
            field: storedFields.get(id),
            fieldId: id,
            row: fixture.row,
            rowId: 'research-case',
            now,
          });

          expect(result.error).toBeUndefined();
          return result;
        });
      } catch (error) {
        throw new Error(`${caseId}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        fixture.doc.destroy();
      }
    },
  };
}

it('combines every published project-deadline start/status case', () => {
  const db = run([
    field('Start', FieldType.DateTime),
    {
      ...field('Status', FieldType.SingleSelect),
      typeOption: { content: selectOptions(['To do', 'In progress', 'Done'].map((value) => [value, value])) },
    },
    formula('Due', 'if(empty(prop("Start")), empty(), dateAdd(prop("Start"), 2, "weeks"))'),
    formula('Due text', 'if(empty(prop("Due")), "", formatDate(prop("Due"), "YYYY-MM-DD"))'),
    formula(
      'Outcome',
      'if(empty(prop("Due")), "Unscheduled", if(prop("Status") == "Done", "Complete", if(prop("Due") < now(), "Overdue", "On track")))'
    ),
  ]);

  try {
    for (const [start, status] of products('project-deadlines', ['start', 'status'])) {
      const cells: Record<string, CellSpec> = {};
      const due = start === null ? undefined : Date.parse(`${String(start)}T00:00:00Z`) + 14 * 86400000;

      if (start !== null)
        cells.Start = {
          type: FieldType.DateTime,
          data: String(Date.parse(`${String(start)}T00:00:00Z`) / 1000),
          extra: { include_time: false },
        };
      if (status !== null) cells.Status = { type: FieldType.SingleSelect, data: String(status) };
      const expected =
        due === undefined ? 'Unscheduled' : status === 'Done' ? 'Complete' : due < now() ? 'Overdue' : 'On track';

      db.row(
        cells,
        (read) => {
          expect(read('Due').value).toEqual(
            due === undefined
              ? { type: 'empty' }
              : {
                  type: 'date',
                  value: { start: due, end: undefined, includeTime: false },
                }
          );
          expect(read('Due text').text).toBe(due === undefined ? '' : new Date(due).toISOString().slice(0, 10));
          expect(read('Outcome').text).toBe(expected);
        },
        `project-deadlines/${JSON.stringify([start, status])}`
      );
    }
  } finally {
    db.close();
  }
});

it('combines all RICE inputs and voter lists with a zero-effort guard', () => {
  const db = run([
    ...['Reach', 'Impact', 'Confidence', 'Effort'].map((id) => field(id, FieldType.Number)),
    field('Voters', FieldType.Person),
    formula(
      'Score',
      'if(empty(prop("Reach")) or empty(prop("Impact")) or empty(prop("Confidence")) or empty(prop("Effort")), 0, prop("Reach") * prop("Impact") * prop("Confidence") / prop("Effort"))'
    ),
    formula('Score copy', 'prop("Score")'),
    formula('Votes', 'length(prop("Voters"))'),
  ]);

  try {
    for (const values of products('rice-prioritization', ['reach', 'impact', 'confidence', 'effort', 'voters'])) {
      const cells: Record<string, CellSpec> = {};

      ['Reach', 'Impact', 'Confidence', 'Effort'].forEach((id, index) => numeric(cells, id, values[index]));
      const voters = values[4] as string[];
      const ids = voters.map((name) =>
        name === 'Ada Lovelace' ? '10000000-0000-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000002'
      );

      cells.Voters = { type: FieldType.Person, data: JSON.stringify(ids) };
      const numbers = values.slice(0, 4).map((value) => new Decimal(Number(value ?? 0)));
      const expected = numbers.some((value) => value.eq(0))
        ? 0
        : numbers[0].times(numbers[1]).times(numbers[2]).div(numbers[3]).toNumber();

      db.row(
        cells,
        (read) => {
          expect(read('Score').rawNumeric).toBe(expected);
          expect(read('Score copy').rawNumeric).toBe(expected);
          expect(read('Votes').rawNumeric).toBe(voters.length);
        },
        `rice-prioritization/${JSON.stringify(values)}`
      );
    }
  } finally {
    db.close();
  }
});

it('combines every order price, quantity, discount, tax, cancellation and payment', () => {
  const db = run([
    ...['Price', 'Quantity', 'Discount', 'Tax'].map((id) => field(id, FieldType.Number)),
    field('Cancelled', FieldType.Checkbox),
    field('Paid', FieldType.Checkbox),
    formula(
      'Total',
      'if(prop("Cancelled") or empty(prop("Price")) or empty(prop("Quantity")), 0, round(prop("Price") * prop("Quantity") * (1 - prop("Discount")) * (1 + prop("Tax")) * 100) / 100)'
    ),
    formula('Outstanding', 'if(prop("Paid"), 0, prop("Total"))'),
  ]);

  try {
    for (const values of products('order-invoice', ['price', 'quantity', 'discount', 'tax', 'cancelled', 'paid'])) {
      const cells: Record<string, CellSpec> = {};

      ['Price', 'Quantity', 'Discount', 'Tax'].forEach((id, index) => numeric(cells, id, values[index]));
      cells.Cancelled = { type: FieldType.Checkbox, data: values[4] ? 'Yes' : 'No' };
      cells.Paid = { type: FieldType.Checkbox, data: values[5] ? 'Yes' : 'No' };
      // Decimal arithmetic is independent of the engine's binary-number path.
      const numbers = values.slice(0, 4).map((value) => new Decimal(Number(value ?? 0)));
      const unrounded = numbers[0]
        .times(numbers[1])
        .times(new Decimal(1).minus(numbers[2]))
        .times(new Decimal(1).plus(numbers[3]));
      // Formula round resolves half ties toward +infinity, including refunds.
      const cents = unrounded.times(100);
      const wholeCents = cents.round(0, Decimal.roundDown);
      const fractionalCents = cents.minus(wholeCents);
      const rounded = fractionalCents.gte('0.5')
        ? wholeCents.plus(1)
        : fractionalCents.lt('-0.5')
        ? wholeCents.minus(1)
        : wholeCents;
      const expected = values[4] || numbers[0].eq(0) || numbers[1].eq(0) ? 0 : rounded.div(100).toNumber();

      db.row(
        cells,
        (read) => {
          expect(read('Total').rawNumeric).toBe(expected);
          expect(read('Outstanding').rawNumeric).toBe(values[5] ? 0 : expected);
        },
        `order-invoice/${JSON.stringify(values)}`
      );
    }
  } finally {
    db.close();
  }
});
