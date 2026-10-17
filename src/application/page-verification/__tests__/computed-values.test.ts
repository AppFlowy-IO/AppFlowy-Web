import { YjsDatabaseKey } from '@/application/types';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { calculateFieldValue } from '@/application/database-yjs/calculation';
import {
  registerExternalDatabaseFields,
  subscribeExternalDatabaseFields,
  publishExternalDatabaseFields,
} from '@/application/database-yjs/external-fields';
import {
  evaluateFormulaCell,
  evaluateFormulaExpression,
  readFormulaSchema,
  toStorageExpression,
} from '@/application/database-yjs/fields/formula';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { VerificationRecord, verificationCellValue } from '../types';

const record: VerificationRecord = {
  id: 'record',
  verified_by: { uid: 1, name: 'Annie' },
  verified_at: '2026-10-15T00:00:00Z',
  expires_at: '2026-10-23T00:00:00Z',
};

function fixture() {
  const fields = createFields([
    {
      id: 'formula',
      name: 'Result',
      type: FieldType.Formula,
      typeOption: { expression: 'if(prop("Verification") == "Verified", 1, 0)' },
    },
  ]);
  const field = createFields([{ id: 'verification', name: 'Verification', type: FieldType.Verification }]).get('verification')!.clone();
  fields.set('verification', field);
  const values = new Map<string, string | undefined>([['row', 'Verified']]);
  const unregister = registerExternalDatabaseFields(fields, [{ field, readValue: (id) => values.get(id) }]);
  const { row } = createRow('row', {});
  const options = {
    schema: readFormulaSchema(fields),
    field: fields.get('formula')!,
    fieldId: 'formula',
    row,
    rowId: 'row',
  };
  return { fields, values, unregister, options };
}

it('counts visible verified and expired cells as filled, but unverified cells as empty', () => {
  const values = [
    verificationCellValue(record, Date.parse('2026-10-15T00:00:00Z')),
    verificationCellValue(record, Date.parse(record.expires_at!)),
    verificationCellValue(null),
  ];
  expect(values).toEqual(['Verified', 'Expired', '']);
  const calculate = (calculationType: CalculationType, cellValues = values) =>
    calculateFieldValue({ fieldType: FieldType.Verification, calculationType, cellValues });
  expect(calculate(CalculationType.CountNonEmpty)).toBe(2);
  expect(calculate(CalculationType.CountEmpty)).toBe(1);
  expect(calculate(CalculationType.Count)).toBe(3);
  expect(calculate(CalculationType.CountUnique)).toBe(2);
  expect(calculate(CalculationType.PercentNotEmpty)).toBeCloseTo(200 / 3);
  expect(calculate(CalculationType.PercentEmpty, [])).toBe(0);
  expect(calculate(CalculationType.CountNonEmpty, values.slice(1))).toBe(1);
});

it('exposes a stable property reference and recomputes formulas on verify, expiry, removal and permission loss', () => {
  const { values, unregister, options } = fixture();
  expect(toStorageExpression('prop("Verification")', options.schema)).toBe('prop("verification")');
  expect(evaluateFormulaCell(options).rawNumeric).toBe(1);
  values.set('row', 'Expired');
  expect(evaluateFormulaCell(options).rawNumeric).toBe(0);
  expect(evaluateFormulaExpression({ ...options, expression: 'prop("Verification")' }).text).toBe('Expired');
  values.set('row', '');
  expect(evaluateFormulaExpression({ ...options, expression: 'empty(prop("Verification"))' }).rawBoolean).toBe(true);
  values.set('row', undefined);
  expect(evaluateFormulaCell(options).error).toContain('unavailable');
  values.set('row', 'Verified');
  expect(evaluateFormulaCell(options).rawNumeric).toBe(1);
  unregister();
  expect(evaluateFormulaCell(options).error).toContain('unavailable');
});

it('keeps metadata out of the content document and scopes it to the owning database', async () => {
  const { fields, unregister, options } = fixture();
  expect(fields.get('verification')?.get(YjsDatabaseKey.type)).toBe(FieldType.Verification);
  expect(readFormulaSchema(createFields([]))).toEqual([]);
  const changes = jest.fn();
  const stop = subscribeExternalDatabaseFields(fields, changes);
  publishExternalDatabaseFields(fields);
  publishExternalDatabaseFields(fields);
  await Promise.resolve();
  expect(changes).toHaveBeenCalledTimes(1);
  expect(options.row.toJSON()).toEqual({ id: 'row', cells: {} });
  stop();
  unregister();
});
