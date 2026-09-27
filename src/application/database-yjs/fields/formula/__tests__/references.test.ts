import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';

import { formulaExternalReferencesKey } from '../references';
import { FormulaFieldSchema } from '../schema';

import { createFields } from './fixture';

describe('formula external reference keys', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['relation', 'rollup', 'rollup relation'] as const)('tracks synced BigInts in %s configuration', (source) => {
    const fields = createFields([
      { id: 'relation', name: 'Relation', type: FieldType.Relation, typeOption: { database_id: 'database' } },
      { id: 'rollup', name: 'Rollup', type: FieldType.Rollup, typeOption: { relation_field_id: 'relation' } },
    ]);
    const entry = (id: string, type: FieldType): FormulaFieldSchema => ({ id, name: id, type, field: fields.get(id) });
    const references = {
      people: false,
      relations: source === 'relation' ? [entry('relation', FieldType.Relation)] : [],
      rollups: source === 'relation' ? [] : [entry('rollup', FieldType.Rollup)],
    };
    const field = fields.get(source === 'rollup' ? 'rollup' : 'relation');
    const metadata = { revision: 9007199254740992n };

    if (source === 'rollup relation') {
      // The rollup key also includes the entire relation field, outside its type options.
      field.set('desktop_metadata', metadata);
    } else {
      const typeOptions = field.get(YjsDatabaseKey.type_option);
      const original = typeOptions.toJSON();

      jest.spyOn(typeOptions, 'toJSON').mockImplementation(() => ({ ...original, desktop_metadata: metadata }));
    }
    const first = formulaExternalReferencesKey(references);

    expect(formulaExternalReferencesKey(references)).toBe(first);
    metadata.revision = 9007199254740993n;
    expect(formulaExternalReferencesKey(references)).not.toBe(first);
  });
});
