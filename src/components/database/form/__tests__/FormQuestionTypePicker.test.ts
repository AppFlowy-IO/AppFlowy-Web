import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { buildExistingQuestionCandidates } from '../FormQuestionTypePicker';

function addField(fields: YDatabaseFields, id: string, name: string, type = FieldType.RichText) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, type);
  fields.set(id, field);
}

describe('buildExistingQuestionCandidates', () => {
  it('follows Form field order while skipping selected, unsupported, and orphaned fields', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;

    // Deliberately insert in a different order than the Form view.
    addField(fields, 'field-a', 'A');
    addField(fields, 'field-b', 'B');
    addField(fields, 'unsupported', 'Computed', FieldType.Rollup);
    addField(fields, 'selected', 'Selected');

    const candidates = buildExistingQuestionCandidates(
      fields,
      ['field-b', 'missing', 'unsupported', 'selected', 'field-a'],
      new Set(['selected'])
    );

    expect(candidates.map(({ id }) => id)).toEqual(['field-b', 'field-a']);
  });

  it('returns no candidates while Form field order is unresolved', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;

    addField(fields, 'field-a', 'A');

    expect(buildExistingQuestionCandidates(fields, null, new Set())).toEqual([]);
  });
});
