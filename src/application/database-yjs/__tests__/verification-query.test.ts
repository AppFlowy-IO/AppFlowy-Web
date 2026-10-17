import * as Y from 'yjs';

import { FieldType, FilterType, SortCondition } from '../database.type';
import { applyFilterUpdate } from '../dispatch/filter-update';
import { registerExternalDatabaseFields } from '../external-fields';
import { NumberFilterCondition } from '../fields';
import {
  compareVerificationSnapshots,
  matchesVerificationFilter,
  parseVerificationFilter,
  serializeVerificationFilter,
  VerificationFilterCondition as C,
  VerificationFilterStatus as S,
  VerificationPredicate,
  VerificationSnapshot,
  verificationTimestampMicros,
} from '../fields/verification';
import { filterBy, filterFillData, getDefaultFilterCondition } from '../filter';
import { sortBy } from '../sort';
import {
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseSorts,
  YjsDatabaseKey as K,
} from '@/application/types';

import { createCell, createField, createRowDoc } from './test-helpers';

const predicate = (
  condition = C.Is,
  status = S.Verified,
  lower: bigint | null = null,
  upper: bigint | null = null
): VerificationPredicate => ({
  condition,
  status,
  expiresAfterMicros: lower,
  expiresBeforeMicros: upper,
});
const snapshot = (
  status: VerificationSnapshot['status'],
  expiresAtMicros: bigint | null = null
): VerificationSnapshot => ({ status, expiresAtMicros });
const leaf = (id: string, value = predicate()) => ({
  id,
  field_id: 'verification',
  [K.type]: FieldType.Verification,
  filter_type: FilterType.Data,
  condition: value.condition,
  content: serializeVerificationFilter(value),
});
const numberLeaf = {
  id: 'number-filter',
  field_id: 'number',
  [K.type]: FieldType.Number,
  filter_type: FilterType.Data,
  condition: NumberFilterCondition.GreaterThan,
  content: '5',
};
function filters(nodes: unknown[]) {
  const doc = new Y.Doc();
  const values = doc.getArray('filters') as YDatabaseFilters;
  values.push(nodes as YDatabaseFilter[]);
  return values;
}
function sorts(ids: string[], direction = SortCondition.Ascending) {
  const doc = new Y.Doc();
  const values = doc.getArray('sorts') as YDatabaseSorts;
  ids.forEach((id, index) => {
    const value = new Y.Map();
    value.set(K.id, `sort-${index}`);
    value.set(K.field_id, id);
    value.set(K.condition, direction);
    values.push([value as never]);
  });
  return values;
}

describe('Verification native wire codec', () => {
  it.each([C.Is, C.IsNot, C.IsEmpty, C.IsNotEmpty])('round trips condition %s with exact i64 bounds', (condition) => {
    for (const status of [S.Unverified, S.Verified, S.Expired]) {
      const value = predicate(condition, status, -(2n ** 63n), 2n ** 63n - 1n);
      const content = serializeVerificationFilter(value);
      expect(content).toContain('"expires_before_micros":9223372036854775807');
      expect(parseVerificationFilter(condition, content)).toEqual(value);
    }
  });
  it('matches Desktop enum names and outer-condition precedence', () => {
    const content =
      '{"condition":"IsNot","status":"Expired","expires_after_micros":1735689600000001,"expires_before_micros":1735775999999999}';
    expect(parseVerificationFilter(C.IsEmpty, content)).toEqual(
      predicate(C.IsEmpty, S.Expired, 1735689600000001n, 1735775999999999n)
    );
    expect(parseVerificationFilter(C.Is, '{"condition":"Is","status":"Verified"}')).toEqual(predicate());
  });
  it.each([
    'invalid',
    '{"status":"Verified"}',
    '{"condition":"Is","status":"FutureStatus"}',
    '{"condition":"Is","status":"Verified","expires_after_micros":"1"}',
    '{"condition":"Is","status":"Verified","expires_before_micros":9223372036854775808}',
    '{"condition":"Is","status":"Verified","expires_after_micros":1.5}',
  ])('defaults the entire malformed payload: %s', (content) => {
    expect(parseVerificationFilter(C.IsNotEmpty, content)).toEqual(predicate(C.IsNotEmpty, S.Unverified));
  });
  it('retains sub-millisecond precision and UTC offsets without accepting malformed dates', () => {
    expect(verificationTimestampMicros('2025-01-01T08:00:00.000001+08:00')).toBe(1735689600000001n);
    expect(verificationTimestampMicros('1969-12-31T23:59:59.999999Z')).toBe(-1n);
    expect(verificationTimestampMicros('2025-02-30T00:00:00Z')).toBeUndefined();
    expect(verificationTimestampMicros('2025-01-01T24:00:00Z')).toBeUndefined();
    expect(verificationTimestampMicros('2025-01-01')).toBeUndefined();
  });
  it('uses Is Verified for newly created filters', () => {
    const value = getDefaultFilterCondition(FieldType.Verification)!;
    expect(parseVerificationFilter(value.condition, value.content!)).toEqual(predicate());
  });
  it('unknown never matches, unverified alone is empty, expired is filled', () => {
    for (const condition of [C.Is, C.IsNot, C.IsEmpty, C.IsNotEmpty]) {
      expect(matchesVerificationFilter(undefined, predicate(condition))).toBe(false);
    }
    expect(matchesVerificationFilter(snapshot('unverified'), predicate(C.IsEmpty))).toBe(true);
    expect(matchesVerificationFilter(snapshot('expired'), predicate(C.IsEmpty))).toBe(false);
    expect(matchesVerificationFilter(snapshot('expired'), predicate(C.IsNotEmpty))).toBe(true);
    expect(matchesVerificationFilter(snapshot('unverified'), predicate(C.IsNot))).toBe(true);
  });
  it('uses inclusive microsecond bounds and rejects indefinite expiry for bounded predicates', () => {
    const value = predicate(C.Is, S.Verified, 1735689600000001n, 1735689600000001n);
    expect(matchesVerificationFilter(snapshot('verified', 1735689600000001n), value)).toBe(true);
    expect(matchesVerificationFilter(snapshot('verified', 1735689600000000n), value)).toBe(false);
    expect(matchesVerificationFilter(snapshot('verified', 1735689600000002n), value)).toBe(false);
    expect(matchesVerificationFilter(snapshot('verified'), value)).toBe(false);
  });
});

describe('Verification in the normal native query pipeline', () => {
  const rows = ['unknown', 'expired', 'verified', 'unverified'].map((id) => ({ id, height: 0 }));
  let fields: YDatabaseFields;
  let unregister: () => void;
  const snapshots = new Map<string, VerificationSnapshot>([
    ['expired', snapshot('expired', 1n)],
    ['verified', snapshot('verified', 20n)],
    ['unverified', snapshot('unverified')],
  ]);
  const rowMetas = Object.fromEntries(
    rows.map(({ id }, index) => [
      id,
      createRowDoc(id, 'db', {
        number: createCell(FieldType.Number, index === 0 || index === 3 ? '10' : '1'),
        // Previous native values and forged raw data cannot become verified claims.
        verification: createCell(FieldType.RichText, 'Verified'),
      }),
    ])
  );
  beforeEach(() => {
    fields = new Map() as unknown as YDatabaseFields;
    const field = createField('verification', FieldType.Verification);
    fields.set('verification', field);
    fields.set('number', createField('number', FieldType.Number));
    unregister = registerExternalDatabaseFields(fields, [
      { field, readValue: () => 'forged text', readVerificationSnapshot: (id) => snapshots.get(id) },
    ]);
  });
  afterEach(() => unregister());
  const ids = (result: { id: string }[]) => result.map(({ id }) => id);
  it('evaluates a full OR tree, restoring rows excluded by the ordinary predicate', () => {
    const tree = filters([{ id: 'or', filter_type: FilterType.Or, children: [numberLeaf, leaf('verified')] }]);
    expect(ids(filterBy(rows, tree, fields, rowMetas))).toEqual(['unknown', 'verified', 'unverified']);
  });
  it('evaluates nested AND/OR groups and multiple predicates on the same native field', () => {
    const tree = filters([
      {
        id: 'and',
        filter_type: FilterType.And,
        children: [
          leaf('filled', predicate(C.IsNotEmpty)),
          {
            id: 'or',
            filter_type: FilterType.Or,
            children: [leaf('expired', predicate(C.Is, S.Expired)), leaf('bounded', predicate(C.Is, S.Verified, 21n))],
          },
        ],
      },
    ]);
    expect(ids(filterBy(rows, tree, fields, rowMetas))).toEqual(['expired']);
  });
  it('reads Cloud snapshots without row documents and never treats unknown raw cells as known', () => {
    expect(ids(filterBy(rows, filters([leaf('verified')]), fields, {}))).toEqual(['verified']);
    expect(ids(filterBy(rows, filters([leaf('negative', predicate(C.IsNot))]), fields, rowMetas))).toEqual([
      'expired',
      'unverified',
    ]);
    unregister();
    expect(filterBy(rows, filters([leaf('empty', predicate(C.IsEmpty))]), fields, rowMetas)).toEqual([]);
  });
  it('preserves but ignores predicates of a different native type after conversion', () => {
    const tree = filters([leaf('verified')]);
    const field = fields.get('verification');

    field.set(K.type, FieldType.RichText);
    expect(filterBy(rows, tree, fields, rowMetas)).toEqual(rows);
    const stored = tree.toArray()[0] as unknown as Record<string, unknown>;
    const wrapped = { get: (key: string) => stored[key] } as YDatabaseFilter;
    expect(filterFillData(wrapped, field)).toBeNull();
    field.set(K.type, FieldType.Verification);
    expect(ids(filterBy(rows, tree, fields, rowMetas))).toEqual(['verified']);
    const textRule = { ...leaf('old-text'), [K.type]: FieldType.RichText, condition: 0, content: 'Verified' };
    expect(filterBy(rows, filters([textRule]), fields, rowMetas)).toEqual(rows);
  });
  it('honors native sort list position, including ordinary ties after Verification', () => {
    expect(ids(sortBy(rows, sorts(['number', 'verification']), fields, rowMetas))).toEqual([
      'verified',
      'expired',
      'unverified',
      'unknown',
    ]);
    expect(ids(sortBy(rows, sorts(['verification', 'number']), fields, rowMetas))).toEqual([
      'unverified',
      'verified',
      'expired',
      'unknown',
    ]);
    expect(ids(sortBy(rows, sorts(['verification', 'number'], SortCondition.Descending), fields, rowMetas))).toEqual([
      'expired',
      'verified',
      'unverified',
      'unknown',
    ]);
    expect(ids(sortBy(rows, sorts(['verification']), fields, {}))).toEqual([
      'unverified',
      'verified',
      'expired',
      'unknown',
    ]);
  });
  it('reverses only known order and compares exact expiry before the next native sort', () => {
    const finite = snapshot('verified', 9007199254740993n);
    const later = snapshot('verified', 9007199254740994n);
    expect(compareVerificationSnapshots(finite, later, SortCondition.Ascending)).toBeLessThan(0);
    expect(compareVerificationSnapshots(finite, snapshot('verified'), SortCondition.Ascending)).toBeLessThan(0);
    expect(compareVerificationSnapshots(finite, snapshot('verified'), SortCondition.Descending)).toBeGreaterThan(0);
    expect(compareVerificationSnapshots(undefined, finite, SortCondition.Descending)).toBeGreaterThan(0);
    expect(compareVerificationSnapshots(undefined, undefined, SortCondition.Descending)).toBe(0);
  });
  it('round trips real Yjs filter trees and ordered sorts for reopening another client', () => {
    const tree = filters([{ id: 'or', filter_type: FilterType.Or, children: [numberLeaf, leaf('verified')] }]);
    const order = sorts(['verification', 'number']);
    const next = new Y.Doc();
    Y.applyUpdate(next, Y.encodeStateAsUpdate(tree.doc!));
    Y.applyUpdate(next, Y.encodeStateAsUpdate(order.doc!));
    expect(ids(filterBy(rows, next.getArray('filters') as YDatabaseFilters, fields, rowMetas))).toEqual([
      'unknown',
      'verified',
      'unverified',
    ]);
    expect(ids(sortBy(rows, next.getArray('sorts') as YDatabaseSorts, fields, rowMetas))).toEqual([
      'unverified',
      'verified',
      'expired',
      'unknown',
    ]);
  });
  it('updates one nested native predicate and clears bounds only when selecting IsEmpty', () => {
    const original = leaf('target', predicate(C.Is, S.Verified, 9007199254740993n, 9007199254740994n));
    const tree = filters([{ id: 'or', filter_type: FilterType.Or, children: [numberLeaf, original] }]);
    applyFilterUpdate(tree, fields, { filterId: 'target', condition: C.IsNot });
    const target = () => (tree.toArray()[0] as unknown as { children: Record<string, unknown>[] }).children[1];
    expect(parseVerificationFilter(Number(target().condition), String(target().content))).toEqual(
      predicate(C.IsNot, S.Verified, 9007199254740993n, 9007199254740994n)
    );
    applyFilterUpdate(tree, fields, { filterId: 'target', condition: C.IsEmpty });
    expect(parseVerificationFilter(Number(target().condition), String(target().content))).toEqual(predicate(C.IsEmpty));
    expect((tree.toArray()[0] as unknown as { children: unknown[] }).children[0]).toEqual(numberLeaf);
  });
});
