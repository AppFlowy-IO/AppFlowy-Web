import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseField, YDatabaseMetas, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  DatabaseRowTemplateStore,
  getDatabaseRowTemplateSnapshot,
  readDatabaseRowTemplateState,
  subscribeDatabaseRowTemplates,
} from '../store';
import { DATABASE_DEFAULT_ROW_TEMPLATE_KEY, DATABASE_ROW_TEMPLATES_KEY, DatabaseRowTemplate } from '../types';

function createTemplate(id: string): DatabaseRowTemplate {
  return {
    templateId: id,
    name: id,
    docViewId: `${id}-document`,
    isDocumentEmpty: true,
    embeddedDatabases: [],
    defaultCells: {},
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function createDatabase() {
  const doc = new Y.Doc();
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const metas = new Y.Map() as YDatabaseMetas;

  database.set(YjsDatabaseKey.metas, metas);
  root.set(YjsEditorKey.database, database);

  return database;
}

describe('DatabaseRowTemplateStore', () => {
  it('uses the exact Desktop metadata keys', () => {
    expect(DATABASE_ROW_TEMPLATES_KEY).toBe('row_templates');
    expect(DATABASE_DEFAULT_ROW_TEMPLATE_KEY).toBe('default_row_template');
  });

  it('creates, updates, reorders, and deletes templates transactionally', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);

    store.upsert(createTemplate('first'));
    store.upsert(createTemplate('second'));
    store.upsert({ ...createTemplate('first'), name: 'Updated' });
    expect(store.read().templates.map(({ templateId, name }) => [templateId, name])).toEqual([
      ['first', 'Updated'],
      ['second', 'second'],
    ]);

    expect(store.move('second', 'first')).toBe(true);
    expect(store.read().templates.map(({ templateId }) => templateId)).toEqual(['second', 'first']);

    expect(store.delete('second')).toBe(true);
    expect(store.delete('missing')).toBe(false);
    expect(readDatabaseRowTemplateState(database).templates.map(({ templateId }) => templateId)).toEqual(['first']);
  });

  it('deletes every template and clears a default that pointed at the deleted set', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);

    ['first', 'second', 'third'].forEach((id) => store.upsert(createTemplate(id)));
    store.setDefault('second');

    store.read().templates.forEach(({ templateId }) => {
      expect(store.delete(templateId)).toBe(true);
    });

    expect(store.read()).toEqual({ templates: [], defaultTemplateId: undefined });
    expect(database.get(YjsDatabaseKey.metas)?.get(DATABASE_DEFAULT_ROW_TEMPLATE_KEY)).toBe('');
  });

  it('validates and clears the default when its template is deleted', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);

    store.upsert(createTemplate('first'));
    expect(store.setDefault('missing')).toBe(false);
    expect(store.setDefault('first')).toBe(true);
    expect(store.read().defaultTemplateId).toBe('first');
    expect(database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.default_row_template)).toBe('first');

    store.delete('first');
    expect(store.read()).toEqual({ templates: [], defaultTemplateId: undefined });
    expect(database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.default_row_template)).toBe('');
  });

  it('creates a missing metas map and persists a Desktop-readable string', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    new DatabaseRowTemplateStore(database).upsert(createTemplate('first'));

    const raw = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.row_templates);

    expect(typeof raw).toBe('string');
    expect(JSON.parse(raw as string)[0]).toMatchObject({
      template_id: 'first',
      doc_view_id: 'first-document',
      default_cells: [],
    });
  });

  it('supports clearing defaults with undefined or an empty id', () => {
    const store = new DatabaseRowTemplateStore(createDatabase());

    store.upsert(createTemplate('first'));
    store.setDefault('first');
    expect(store.setDefault(undefined)).toBe(true);
    expect(store.read().defaultTemplateId).toBeUndefined();
    store.setDefault('first');
    expect(store.setDefault('')).toBe(true);
    expect(store.read().defaultTemplateId).toBeUndefined();
  });

  it('rejects invalid moves and treats moving onto itself as a no-op', () => {
    const store = new DatabaseRowTemplateStore(createDatabase());

    store.upsert(createTemplate('first'));
    store.upsert(createTemplate('second'));
    expect(store.move('missing', 'first')).toBe(false);
    expect(store.move('first', 'missing')).toBe(false);
    expect(store.move('first', 'first')).toBe(true);
    expect(store.read().templates.map((item) => item.templateId)).toEqual(['first', 'second']);
  });

  it('moves the first template to the end and the last template to the beginning', () => {
    const store = new DatabaseRowTemplateStore(createDatabase());

    ['first', 'second', 'third'].forEach((id) => store.upsert(createTemplate(id)));
    expect(store.move('first', 'third')).toBe(true);
    expect(store.read().templates.map(({ templateId }) => templateId)).toEqual(['second', 'third', 'first']);

    expect(store.move('first', 'second')).toBe(true);
    expect(store.read().templates.map(({ templateId }) => templateId)).toEqual(['first', 'second', 'third']);
  });

  it('notifies observers for template and default changes and can unsubscribe', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);
    const listener = jest.fn();
    const unsubscribe = subscribeDatabaseRowTemplates(database, listener);
    const initialSnapshot = getDatabaseRowTemplateSnapshot(database);

    store.upsert(createTemplate('first'));
    store.setDefault('first');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getDatabaseRowTemplateSnapshot(database)).not.toBe(initialSnapshot);

    unsubscribe();
    store.delete('first');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps insertion order and original creation time when updating', () => {
    const store = new DatabaseRowTemplateStore(createDatabase());

    store.upsert(createTemplate('first'));
    store.upsert(createTemplate('second'));
    const updated = store.upsert({ ...createTemplate('first'), name: 'Renamed', createdAtMs: 42 });

    expect(updated.createdAtMs).toBe(42);
    expect(updated.updatedAtMs).toBeGreaterThan(1);
    expect(store.read().templates.map((item) => item.templateId)).toEqual(['first', 'second']);
  });

  it('persists templates and their default through a fresh Yjs document', () => {
    const sourceDoc = new Y.Doc();
    const sourceDatabase = new Y.Map() as YDatabase;

    sourceDatabase.set(YjsDatabaseKey.metas, new Y.Map() as YDatabaseMetas);
    sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, sourceDatabase);
    const sourceStore = new DatabaseRowTemplateStore(sourceDatabase);

    sourceStore.upsert({
      ...createTemplate('persisted'),
      defaultCells: { title: { type: 'text', value: 'Saved value' } },
    });
    sourceStore.setDefault('persisted');

    const restoredDoc = new Y.Doc();

    Y.applyUpdate(restoredDoc, Y.encodeStateAsUpdate(sourceDoc));
    const restoredDatabase = restoredDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(new DatabaseRowTemplateStore(restoredDatabase).read()).toEqual(sourceStore.read());
  });

  it('sanitizes cells and embedded database snapshots on upsert like Desktop', () => {
    const database = createDatabase();
    const fields = new Y.Map<YDatabaseField>();
    const name = new Y.Map() as YDatabaseField;

    name.set(YjsDatabaseKey.id, 'name');
    name.set(YjsDatabaseKey.name, 'Name');
    name.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('name', name);
    database.set(YjsDatabaseKey.fields, fields);
    const stored = new DatabaseRowTemplateStore(database).upsert({
      ...createTemplate('sanitized'),
      defaultCells: {
        name: { type: 'text', value: '  Kept  ' },
        deleted: { type: 'text', value: 'Dropped' },
      },
      embeddedDatabases: [
        {
          sourceViewId: 'view',
          sourceDatabaseId: 'database',
          layoutType: 0,
          name: 'First',
          rawData: '{}',
        },
        {
          sourceViewId: 'view',
          sourceDatabaseId: 'database',
          layoutType: 0,
          name: 'Duplicate',
          rawData: '{}',
        },
        {
          sourceViewId: 'blank',
          sourceDatabaseId: '',
          layoutType: 0,
          name: 'Blank',
          rawData: '   ',
        },
      ],
    });

    expect(stored.defaultCells).toEqual({ name: { type: 'text', value: 'Kept' } });
    expect(stored.embeddedDatabases.map((snapshot) => snapshot.name)).toEqual(['First']);
  });

  it('re-sanitizes stored defaults when the field schema changes', () => {
    const database = createDatabase();
    const fields = new Y.Map<YDatabaseField>();
    const name = new Y.Map() as YDatabaseField;

    name.set(YjsDatabaseKey.id, 'name');
    name.set(YjsDatabaseKey.name, 'Name');
    name.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('name', name);
    database.set(YjsDatabaseKey.fields, fields);
    const store = new DatabaseRowTemplateStore(database);

    store.upsert({
      ...createTemplate('schema-change'),
      defaultCells: { name: { type: 'text', value: 'Before deletion' } },
    });
    expect(store.read().templates[0].defaultCells).toHaveProperty('name');

    fields.delete('name');
    expect(store.read().templates[0].defaultCells).toEqual({});
  });

  it('does not invent a value when a field is added after template creation', () => {
    const database = createDatabase();
    const fields = new Y.Map<YDatabaseField>();
    const name = new Y.Map() as YDatabaseField;

    name.set(YjsDatabaseKey.id, 'name');
    name.set(YjsDatabaseKey.name, 'Name');
    name.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('name', name);
    database.set(YjsDatabaseKey.fields, fields);
    const store = new DatabaseRowTemplateStore(database);

    store.upsert({
      ...createTemplate('schema-addition'),
      defaultCells: { name: { type: 'text', value: 'Existing value' } },
    });

    const checkbox = new Y.Map() as YDatabaseField;

    checkbox.set(YjsDatabaseKey.id, 'done');
    checkbox.set(YjsDatabaseKey.name, 'Done');
    checkbox.set(YjsDatabaseKey.type, FieldType.Checkbox);
    fields.set('done', checkbox);

    expect(store.read().templates[0].defaultCells).toEqual({
      name: { type: 'text', value: 'Existing value' },
    });

    store.upsert({
      ...store.read().templates[0],
      defaultCells: {
        ...store.read().templates[0].defaultCells,
        done: { type: 'checkbox', value: true },
      },
    });
    expect(store.read().templates[0].defaultCells.done).toEqual({ type: 'checkbox', value: true });
  });

  it('tracks only template-relevant field schema in the external-store snapshot', () => {
    const database = createDatabase();
    const fields = new Y.Map<YDatabaseField>();
    const name = new Y.Map() as YDatabaseField;

    name.set(YjsDatabaseKey.id, 'name');
    name.set(YjsDatabaseKey.name, 'Name');
    name.set(YjsDatabaseKey.type, FieldType.RichText);
    fields.set('name', name);
    database.set(YjsDatabaseKey.fields, fields);
    const initialSnapshot = getDatabaseRowTemplateSnapshot(database);

    name.set(YjsDatabaseKey.name, 'Renamed');
    expect(getDatabaseRowTemplateSnapshot(database)).toBe(initialSnapshot);

    name.set(YjsDatabaseKey.type, FieldType.Number);
    expect(getDatabaseRowTemplateSnapshot(database)).not.toBe(initialSnapshot);
  });
});
