import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { compileFormula } from '../compile';
import {
  formulaSchemaSignature,
  hasFormulaSchemaSource,
  readFormulaSchema,
  readFormulaSchemaForVersion,
  refreshFormulaSchema,
  resolveFormulaField,
} from '../schema';

import { createFields } from './fixture';

describe('formula schema freshness', () => {
  afterEach(() => jest.restoreAllMocks());

  it('signs synced BigInt type options without losing precision or missing changes', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number, typeOption: { format: 0 } }]);
    const typeOptions = fields.get('price').get(YjsDatabaseKey.type_option);
    // Native Yrs integers arrive as BigInts, which Yjs cannot insert directly.
    const serialized = jest.spyOn(typeOptions, 'toJSON').mockReturnValue({
      [FieldType.Number]: { format: 0n, metadata: { revision: 9007199254740992n } },
    });
    const first = readFormulaSchemaForVersion(fields, 0);
    const signature = formulaSchemaSignature(first);

    expect(formulaSchemaSignature(first.slice())).toBe(signature);
    expect(readFormulaSchemaForVersion(fields, 0)).toBe(first);
    serialized.mockReturnValue({
      [FieldType.Number]: { format: 0n, metadata: { revision: 9007199254740993n } },
    });
    const changed = refreshFormulaSchema(first);

    expect(changed).not.toBe(first);
    expect(formulaSchemaSignature(changed)).not.toBe(signature);
  });

  it('tracks source provenance only for snapshots returned by its readers', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const original = readFormulaSchema(fields);

    expect(hasFormulaSchemaSource(original)).toBe(true);
    expect(hasFormulaSchemaSource(original.slice())).toBe(false);
    fields.get('price').set(YjsDatabaseKey.name, 'Cost');
    expect(hasFormulaSchemaSource(refreshFormulaSchema(original))).toBe(true);
  });

  it('shares validated snapshots until their version or content changes', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const first = readFormulaSchemaForVersion(fields, 1);

    expect(readFormulaSchemaForVersion(fields, 1)).toBe(first);
    expect(readFormulaSchema(fields)).toBe(first);
    expect(refreshFormulaSchema(first)).toBe(first);

    const nextVersion = readFormulaSchemaForVersion(fields, 2);

    expect(nextVersion).not.toBe(first);
    expect(readFormulaSchemaForVersion(fields, 2)).toBe(nextVersion);
    expect(refreshFormulaSchema(first)).toBe(nextVersion);
  });

  it('captures type options before their live handles change, even if the signature was never requested', () => {
    const fields = createFields([
      { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: '1' } },
    ]);
    const first = readFormulaSchemaForVersion(fields, 0);
    const option = fields.get('total').get(YjsDatabaseKey.type_option).get(String(FieldType.Formula));

    option.set(YjsDatabaseKey.expression, '2');
    const updated = readFormulaSchemaForVersion(fields, 0);

    expect(updated).not.toBe(first);
    expect(JSON.parse(formulaSchemaSignature(first))[0][3]).toEqual({
      [FieldType.Formula]: { expression: '1' },
    });
    expect(JSON.parse(formulaSchemaSignature(updated))[0][3]).toEqual({
      [FieldType.Formula]: { expression: '2' },
    });
    expect(refreshFormulaSchema(first)).toBe(updated);
  });

  it('refreshes names, types and cached lookups without subscribers or a new version', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const first = readFormulaSchemaForVersion(fields, 0);

    expect(resolveFormulaField(first, 'Price')?.id).toBe('price');
    fields.get('price').set(YjsDatabaseKey.name, 'Cost');
    fields.get('price').set(YjsDatabaseKey.type, FieldType.RichText);
    const reopened = readFormulaSchemaForVersion(fields, 0);

    expect(reopened).not.toBe(first);
    expect(resolveFormulaField(reopened, 'Price')).toBeUndefined();
    expect(resolveFormulaField(reopened, 'Cost')?.type).toBe(FieldType.RichText);
    expect(refreshFormulaSchema(first)).toBe(reopened);
  });

  it('recompiles a retained schema when a nested formula changes its inferred type', () => {
    const fields = createFields([
      { id: 'nested', name: 'Nested', type: FieldType.Formula, typeOption: { expression: '1' } },
      { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: 'prop("nested")' } },
    ]);
    const schema = readFormulaSchema(fields);
    const expression = 'prop("nested")';

    expect(compileFormula(expression, schema, 'total').resultType).toBe('number');
    fields
      .get('nested')
      .get(YjsDatabaseKey.type_option)
      .get(String(FieldType.Formula))
      .set(YjsDatabaseKey.expression, '"text"');
    const compiled = compileFormula(expression, schema, 'total');

    expect(compiled.error).toBeUndefined();
    expect(compiled.resultType).toBe('text');
  });

  it('refreshes standalone compilation lookups and types when its retained schema changes', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const schema = readFormulaSchema(fields);

    expect(compileFormula('prop("Price")', schema).resultType).toBe('number');
    expect(compileFormula('prop("price")', schema).resultType).toBe('number');
    fields.doc!.transact(() => {
      fields.get('price').set(YjsDatabaseKey.name, 'Cost');
      fields.get('price').set(YjsDatabaseKey.type, FieldType.RichText);
    });
    expect(compileFormula('prop("Price")', schema).error?.missingPropertyRef).toBe('Price');
    expect(compileFormula('prop("price")', schema).resultType).toBe('text');
    expect(compileFormula('prop("Cost")', schema).resultType).toBe('text');
  });

  it('keeps empty schema provenance across additions and deletions', () => {
    const fields = createFields([]);
    const empty = readFormulaSchema(fields);
    const field = new Y.Map() as YDatabaseField;

    fields.set('price', field);
    field.set(YjsDatabaseKey.name, 'Price');
    field.set(YjsDatabaseKey.type, FieldType.Number);
    const added = refreshFormulaSchema(empty);

    expect(added.map((entry) => entry.id)).toEqual(['price']);
    fields.delete('price');
    const removed = refreshFormulaSchema(added);

    expect(removed).toEqual([]);
    expect(removed).not.toBe(added);
    expect(refreshFormulaSchema(empty)).toBe(removed);
    expect(resolveFormulaField(removed, 'price')).toBeUndefined();
  });

  it('replaces detached field handles even when all serialized contents match', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const first = readFormulaSchemaForVersion(fields, 0);
    const replacement = new Y.Map(Object.entries(fields.get('price').toJSON())) as YDatabaseField;

    fields.set('price', replacement);
    const replaced = refreshFormulaSchema(first);

    expect(formulaSchemaSignature(replaced)).toBe(formulaSchemaSignature(first));
    expect(replaced).not.toBe(first);
    expect(replaced[0].field).toBe(replacement);
    replacement.set(YjsDatabaseKey.name, 'Cost');
    expect(refreshFormulaSchema(first)[0].name).toBe('Cost');
  });

  it('reads every mutation made between schema accesses inside one transaction', () => {
    const fields = createFields([
      { id: 'total', name: 'Total', type: FieldType.Formula, typeOption: { expression: '1' } },
    ]);
    const initial = readFormulaSchemaForVersion(fields, 0);
    const option = fields.get('total').get(YjsDatabaseKey.type_option).get(String(FieldType.Formula));

    fields.doc!.transact(() => {
      option.set(YjsDatabaseKey.expression, '2');
      const second = readFormulaSchemaForVersion(fields, 0);

      expect(formulaSchemaSignature(second)).not.toBe(formulaSchemaSignature(initial));
      option.set(YjsDatabaseKey.expression, '3');
      const third = refreshFormulaSchema(initial);

      expect(formulaSchemaSignature(third)).not.toBe(formulaSchemaSignature(second));
      expect(JSON.parse(formulaSchemaSignature(third))[0][3][FieldType.Formula].expression).toBe('3');
    });
  });

  it('supports the first schema read occurring inside an already open transaction', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);

    fields.doc!.transact(() => {
      const first = readFormulaSchemaForVersion(fields, 0);

      fields.get('price').set(YjsDatabaseKey.name, 'Cost');
      const updated = refreshFormulaSchema(first);

      expect(updated).not.toBe(first);
      expect(updated[0].name).toBe('Cost');
    });
  });

  it('refreshes synchronously inside an observer registered before the first schema read', () => {
    const fields = createFields([{ id: 'price', name: 'Price', type: FieldType.Number }]);
    const names: string[] = [];
    const observer = () => {
      names.push(refreshFormulaSchema(first)[0].name);
    };

    fields.observeDeep(observer);
    const first = readFormulaSchemaForVersion(fields, 0);

    fields.get('price').set(YjsDatabaseKey.name, 'Cost');
    expect(names).toEqual(['Cost']);
    fields.unobserveDeep(observer);
  });

  it('does not conflate identical schemas belonging to different fields maps', () => {
    const specs = [{ id: 'price', name: 'Price', type: FieldType.Number }];
    const firstFields = createFields(specs);
    const secondFields = createFields(specs);
    const first = readFormulaSchema(firstFields);
    const second = readFormulaSchema(secondFields);

    expect(second).not.toBe(first);
    firstFields.get('price').set(YjsDatabaseKey.name, 'Cost');
    expect(refreshFormulaSchema(first)[0].name).toBe('Cost');
    expect(refreshFormulaSchema(second)).toBe(second);
    expect(second[0].name).toBe('Price');
  });
});
