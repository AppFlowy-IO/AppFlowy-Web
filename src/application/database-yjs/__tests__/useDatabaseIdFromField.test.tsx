import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  type DatabaseContextState,
  useDatabaseIdFromField,
} from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import {
  type YDatabase,
  type YDatabaseFields,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

describe('useDatabaseIdFromField', () => {
  it('returns the relation database synchronously and tracks field updates', () => {
    const databaseDoc = new Y.Doc() as YDoc;
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map() as YDatabaseFields;
    const relationField = createRelationField('relation', { database_id: 'database-b' });

    fields.set('relation', relationField);
    database.set(YjsDatabaseKey.fields, fields);
    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

    const context: DatabaseContextState = {
      activeViewId: 'database-a-view',
      databaseDoc,
      databasePageId: 'database-a-view',
      readOnly: false,
      rowMap: null,
      workspaceId: 'workspace',
    };
    const { result } = renderHook(() => useDatabaseIdFromField('relation'), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });

    expect(result.current).toBe('database-b');

    act(() => {
      relationField
        .get(YjsDatabaseKey.type_option)
        .get(String(FieldType.Relation))
        .set(YjsDatabaseKey.database_id, 'database-c');
    });

    expect(result.current).toBe('database-c');
  });
});
