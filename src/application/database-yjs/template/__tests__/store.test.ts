import { createHash } from 'crypto';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseField, YDatabaseMetas, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  DatabaseRowTemplateStore,
  getDatabaseRowTemplateSnapshot,
  readDatabaseRowTemplateState,
  subscribeDatabaseRowTemplates,
} from '../store';
import { serializeDatabaseRowTemplate } from '../codec';
import { DATABASE_DEFAULT_ROW_TEMPLATE_KEY, DATABASE_ROW_TEMPLATES_KEY, DatabaseRowTemplate } from '../types';

// The repository's manual isEqual mock always returns true, hiding real writes.
jest.unmock('lodash-es/isEqual');

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

  it('keeps transient migration sources Desktop-readable but hidden from template lists', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);

    store.upsert(createTemplate('visible'));
    store.upsertTransientMigrationSource(createTemplate('staging'));

    expect(store.read().templates.map(({ templateId }) => templateId)).toEqual(['visible']);
    const persisted = JSON.parse(String(database.get(YjsDatabaseKey.metas)?.get(DATABASE_ROW_TEMPLATES_KEY))) as Array<{
      template_id: string;
      name: string;
    }>;

    expect(persisted).toContainEqual(expect.objectContaining({ template_id: 'staging', name: '' }));

    store.upsert({ ...createTemplate('visible'), name: 'Updated' });
    store.upsert(createTemplate('second'));
    store.move('second', 'visible');
    store.delete('second');

    const afterVisibleWrites = JSON.parse(
      String(database.get(YjsDatabaseKey.metas)?.get(DATABASE_ROW_TEMPLATES_KEY))
    ) as Array<{ template_id: string; name: string }>;

    expect(afterVisibleWrites).toContainEqual(expect.objectContaining({ template_id: 'staging', name: '' }));
    expect(store.setDefault('staging')).toBe(false);
    expect(store.deleteTransientMigrationSource('staging')).toBe(true);
    expect(store.deleteTransientMigrationSource('staging')).toBe(false);
    expect(JSON.parse(String(database.get(YjsDatabaseKey.metas)?.get(DATABASE_ROW_TEMPLATES_KEY)))).toEqual([
      expect.objectContaining({ template_id: 'visible', name: 'Updated' }),
    ]);
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

    expect(updated.createdAtMs).toBe(1);
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

describe('database template replication and legacy compatibility', () => {
  function fork(database: YDatabase) {
    const doc = new Y.Doc();

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(database.doc!));
    return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  }

  function sync(left: YDatabase, right: YDatabase) {
    const leftUpdate = Y.encodeStateAsUpdate(left.doc!);
    const rightUpdate = Y.encodeStateAsUpdate(right.doc!);

    Y.applyUpdate(left.doc!, rightUpdate);
    Y.applyUpdate(right.doc!, leftUpdate);
  }

  it('merges edits to different templates during the first upgrade of a legacy database', () => {
    const left = createDatabase();
    const records = ['first', 'second'].map((id) => serializeDatabaseRowTemplate(createTemplate(id)));

    // A legacy field map must not cause an unrelated record to be rewritten
    // as a side effect of decoding and serializing the template list.
    left.get(YjsDatabaseKey.metas)?.set(
      DATABASE_ROW_TEMPLATES_KEY,
      JSON.stringify(records.map((record) => ({ ...record, default_cells: { deleted: 'Kept in storage' } })))
    );
    const right = fork(left);
    const leftStore = new DatabaseRowTemplateStore(left);
    const rightStore = new DatabaseRowTemplateStore(right);

    leftStore.upsert({ ...leftStore.read().templates[0], name: 'Left edit' });
    rightStore.upsert({ ...rightStore.read().templates[1], name: 'Right edit' });
    sync(left, right);

    expect(leftStore.read().templates.map(({ name }) => name)).toEqual(['Left edit', 'Right edit']);
    expect(rightStore.read()).toEqual(leftStore.read());
  });

  it('merges a deletion with a concurrent insertion without resurrecting the deleted template', () => {
    const left = createDatabase();
    const leftStore = new DatabaseRowTemplateStore(left);

    leftStore.upsert(createTemplate('first'));
    const right = fork(left);
    const rightStore = new DatabaseRowTemplateStore(right);

    leftStore.delete('first');
    rightStore.upsert(createTemplate('second'));
    sync(left, right);

    expect(leftStore.read().templates.map(({ templateId }) => templateId)).toEqual(['second']);
    expect(rightStore.read()).toEqual(leftStore.read());
    expect((left.get(YjsDatabaseKey.metas) as Y.Map<unknown>).get('row_template_v2:first')).toBe('null');
  });

  it('imports edits and deletions from an older client before the next upgraded save', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);
    const metas = database.get(YjsDatabaseKey.metas) as Y.Map<unknown>;

    store.upsert(createTemplate('first'));
    store.upsert(createTemplate('second'));
    metas.set(DATABASE_ROW_TEMPLATES_KEY, JSON.stringify([
      { ...serializeDatabaseRowTemplate(createTemplate('first')), name: 'Older client edit', future_field: 7 },
    ]));
    expect(store.read().templates.map(({ name }) => name)).toEqual(['Older client edit']);

    store.upsert(createTemplate('third'));
    expect(store.read().templates.map(({ name }) => name)).toEqual(['Older client edit', 'third']);
    expect(JSON.parse(metas.get('row_template_v2:first') as string)).toMatchObject({ future_field: 7 });
    expect(metas.get('row_template_v2:second')).toBe('null');
    const projection = metas.get(DATABASE_ROW_TEMPLATES_KEY) as string;

    expect(metas.get('row_templates_projection_sha256')).toBe(createHash('sha256').update(projection).digest('hex'));
  });

  it('updates React snapshots for a per-template change without a projection change', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);
    const metas = database.get(YjsDatabaseKey.metas) as Y.Map<unknown>;

    store.upsert(createTemplate('first'));
    const before = getDatabaseRowTemplateSnapshot(database);
    const listener = jest.fn();
    const unsubscribe = subscribeDatabaseRowTemplates(database, listener);

    metas.set('row_template_v2:first', JSON.stringify({
      ...serializeDatabaseRowTemplate(createTemplate('first')), name: 'Desktop edit 🧭',
    }));
    const after = getDatabaseRowTemplateSnapshot(database);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(after).not.toBe(before);
    expect(readDatabaseRowTemplateState(database, after).templates[0].name).toBe('Desktop edit 🧭');
    // Preparing a row also makes the merged record visible to old cloud workers.
    expect(store.prepareForRowCreation('first')?.name).toBe('Desktop edit 🧭');
    expect(JSON.parse(metas.get(DATABASE_ROW_TEMPLATES_KEY) as string)[0].name).toBe('Desktop edit 🧭');
    unsubscribe();
  });

  it('preserves missing decorations from old payloads while accepting explicit removal', () => {
    const database = createDatabase();
    const store = new DatabaseRowTemplateStore(database);
    const template = createTemplate('first');

    store.upsert({ ...template, icon: '📘', cover: '{"data":"#123456","cover_type":0}' });
    store.upsert({ ...template, name: 'Older client rename' });
    expect(store.read().templates[0]).toMatchObject({ icon: '📘', cover: '{"data":"#123456","cover_type":0}' });
    store.upsert({ ...template, icon: '', cover: '' });
    expect(store.read().templates[0]).toMatchObject({ icon: '', cover: '' });
  });
});
