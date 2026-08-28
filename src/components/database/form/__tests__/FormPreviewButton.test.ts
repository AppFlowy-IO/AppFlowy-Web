import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { buildFormPreviewSchema } from '../FormPreviewButton';

describe('form respondent preview schema', () => {
  it('matches the public title/description contract while preserving question descriptions', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;
    const field = new Y.Map<unknown>() as YDatabaseField;

    field.set(YjsDatabaseKey.name, 'Question title');
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('question-id', field);

    const snapshot: FormLayoutSnapshot = {
      decided: true,
      description: 'Local form description',
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

    expect(schema.title).toBe('Untitled form');
    expect(schema).not.toHaveProperty('description');
    expect(schema.questions[0]).toMatchObject({
      label: 'Question title',
      description: 'Public question description',
    });
  });
});
