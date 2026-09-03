import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { buildFormPreviewSchema } from '../FormPreviewButton';

describe('form respondent preview schema', () => {
  it('projects authored respondent copy while preserving question descriptions', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;
    const field = new Y.Map<unknown>() as YDatabaseField;

    field.set(YjsDatabaseKey.name, 'Question title');
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('question-id', field);

    const snapshot: FormLayoutSnapshot = {
      decided: true,
      fieldOrderIds: ['question-id'],
      explicitlyExcludedFieldIds: [],
      respondentTitle: '  Customer feedback  ',
      description: '  Local form description  ',
      questions: [
        {
          fieldId: 'question-id',
          included: true,
          required: false,
          descriptionVisible: true,
          description: 'Public question description',
          longAnswer: false,
          order: 0,
        },
      ],
    };

    const schema = buildFormPreviewSchema(snapshot, fields);

    expect(schema.title).toBe('Customer feedback');
    expect(schema.description).toBe('Local form description');
    expect(schema.questions[0]).toMatchObject({
      label: 'Question title',
      description: 'Public question description',
    });
  });

  it('does not fabricate selectable answers for an empty select field', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;
    const field = new Y.Map<unknown>() as YDatabaseField;

    field.set(YjsDatabaseKey.name, 'Pick one');
    field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
    fields.set('select-id', field);
    const snapshot: FormLayoutSnapshot = {
      decided: true,
      fieldOrderIds: ['select-id'],
      explicitlyExcludedFieldIds: [],
      respondentTitle: '',
      description: '   ',
      questions: [
        {
          fieldId: 'select-id',
          included: true,
          required: false,
          descriptionVisible: false,
          description: '',
          longAnswer: false,
          order: 0,
        },
      ],
    };

    const schema = buildFormPreviewSchema(snapshot, fields);

    expect(schema.title).toBe('Untitled form');
    expect(schema.description).toBeUndefined();
    expect(schema.questions[0].options).toEqual([]);
  });
});
