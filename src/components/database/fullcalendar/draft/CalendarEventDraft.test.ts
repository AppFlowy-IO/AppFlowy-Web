import dayjs from 'dayjs';
import * as Y from 'yjs';

import { DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { DatabaseRowTemplateStore } from '@/application/database-yjs/template/store';
import { DatabaseRowTemplate } from '@/application/database-yjs/template/types';
import { YDatabase, YDatabaseCell, YDatabaseField, YDatabaseRowOrders, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { CalendarDraftSelection, CalendarDraftSnapshot, CalendarEventDraft } from './CalendarEventDraft';

jest.unmock('lodash-es/isEqual');

const selection: CalendarDraftSelection = { start: new Date(2026, 8, 11), end: new Date(2026, 8, 12), allDay: true };
const drafts: CalendarEventDraft[] = [];
const docs: Y.Doc[] = [];
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function field(id: string, type: FieldType): YDatabaseField {
  const value = new Y.Map() as YDatabaseField;

  value.set(YjsDatabaseKey.id, id);
  value.set(YjsDatabaseKey.name, id);
  value.set(YjsDatabaseKey.type, type);
  value.set(YjsDatabaseKey.is_primary, id === 'title');
  if (type === FieldType.MultiSelect) {
    const options = new Y.Map<Y.Map<unknown>>();
    const content = new Y.Map<unknown>();

    content.set(YjsDatabaseKey.content, JSON.stringify({ options: [{ id: 'existing', name: 'Existing', color: 0 }] }));
    options.set(String(type), content);
    value.set(YjsDatabaseKey.type_option, options);
  }

  return value;
}

function fixture(template?: DatabaseRowTemplate) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map<YDatabaseView>();
  const orders: YDatabaseRowOrders = Y.Array.from([{ id: 'existing-row', height: 36 }]);

  docs.push(databaseDoc);
  fields.set('title', field('title', FieldType.RichText));
  fields.set('notes', field('notes', FieldType.RichText));
  fields.set('date', field('date', FieldType.DateTime));
  fields.set('check', field('check', FieldType.Checkbox));
  fields.set('tags', field('tags', FieldType.MultiSelect));
  fields.set('relation', field('relation', FieldType.Relation));
  fields.set('person', field('person', FieldType.Person));
  fields.set('media', field('media', FieldType.Media));
  fields.set('checklist', field('checklist', FieldType.Checklist));
  view.set(YjsDatabaseKey.row_orders, orders);
  views.set('calendar-view', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  if (template) {
    const store = new DatabaseRowTemplateStore(database);

    store.upsert(template);
    store.setDefault(template.templateId);
  }

  const source: DatabaseContextState = {
    readOnly: false, canWrite: true, databaseDoc, databasePageId: 'calendar-page',
    activeViewId: 'calendar-view', workspaceId: 'workspace-id', rowMap: {},
    ensureRow: jest.fn(), bindRowSync: jest.fn(), bindViewSync: jest.fn(),
    createRow: jest.fn(), loadRowDocument: jest.fn(), createRowDocument: jest.fn(),
    duplicateRowDocument: jest.fn(), markCellLocalMutation: jest.fn(),
    uploadFile: jest.fn().mockResolvedValue('https://files.appflowy.io/uploaded'),
  };

  return { source, database, orders };
}

function createDraft(source: DatabaseContextState, dates = selection) {
  const draft = new CalendarEventDraft(source, 'date', dates);

  drafts.push(draft);
  return draft;
}

function setCell(draft: CalendarEventDraft, id: string, data: unknown) {
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.field_type, draft.database.get(YjsDatabaseKey.fields).get(id).get(YjsDatabaseKey.type));
  cell.set(YjsDatabaseKey.data, data);
  draft.cells.set(id, cell);
  return cell;
}

afterEach(() => {
  drafts.splice(0).forEach((draft) => draft.dispose());
  docs.splice(0).forEach((doc) => doc.destroy());
  jest.restoreAllMocks();
  if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('CalendarEventDraft persistence boundary', () => {
  it('edits isolated documents without publishing row orders, row bindings, or metadata changes', async () => {
    const { source, database, orders } = fixture();
    const before = Y.encodeStateAsUpdate(source.databaseDoc);
    const liveUpdate = jest.fn();

    source.databaseDoc.on('update', liveUpdate);
    const draft = createDraft(source);

    setCell(draft, 'title', 'Local title');
    setCell(draft, 'relation', Y.Array.from(['related-row']));
    draft.meta.set(getMetaIdMap(draft.id).get(RowMetaKey.IconId)!, '📆');
    draft.database.get(YjsDatabaseKey.fields).get('title').set(YjsDatabaseKey.name, 'Local name');

    expect(draft.databaseDoc).not.toBe(source.databaseDoc);
    expect(draft.context.rowMap).toEqual({ [draft.id]: draft.rowDoc });
    expect(draft.context.templateEditingRowId).toBe(draft.id);
    await expect(draft.context.ensureRow?.(draft.id)).resolves.toBe(draft.rowDoc);
    await expect(draft.context.ensureRow?.('existing-row')).resolves.toBeUndefined();
    expect(source.ensureRow).not.toHaveBeenCalled();
    expect(draft.context.bindRowSync).toBeUndefined();
    expect(draft.context.bindViewSync).toBeUndefined();
    await expect(draft.context.createRow?.(`${source.databaseDoc.guid}_rows_${draft.id}`)).resolves.toBe(draft.rowDoc);
    expect(draft.context.markCellLocalMutation).toBeUndefined();
    expect(source.createRow).not.toHaveBeenCalled();
    expect(source.rowMap).toEqual({});
    expect(orders.toArray()).toEqual([{ id: 'existing-row', height: 36 }]);
    expect(draft.database.get(YjsDatabaseKey.views).get('calendar-view').get(YjsDatabaseKey.row_orders).length).toBe(0);
    expect(database.get(YjsDatabaseKey.fields).get('title').get(YjsDatabaseKey.name)).toBe('title');
    expect(liveUpdate).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(source.databaseDoc)).toEqual(before);
  });

  it('loads existing related rows while keeping its own row entirely local', async () => {
    const { source, orders } = fixture();
    const relatedDoc = new Y.Doc() as YDoc;

    docs.push(relatedDoc);
    source.createRow = jest.fn().mockResolvedValue(relatedDoc);
    const draft = createDraft(source);

    await expect(draft.context.createRow?.(`related-view_rows_${draft.id}`)).resolves.toBe(draft.rowDoc);
    expect(source.createRow).not.toHaveBeenCalled();
    await expect(draft.context.createRow?.('related-view_rows_existing-related-row')).resolves.toBe(relatedDoc);
    expect(source.createRow).toHaveBeenCalledTimes(1);
    expect(source.createRow).toHaveBeenCalledWith('related-view_rows_existing-related-row');
    expect(orders.toArray()).toEqual([{ id: 'existing-row', height: 36 }]);
    expect(draft.dirty).toBe(false);
  });

  it('discards an untouched draft but allows explicit submission of an untitled card', async () => {
    const draft = createDraft(fixture().source);
    const persist = jest.fn(async (snapshot: CalendarDraftSnapshot) => snapshot.id);

    expect(draft.dirty).toBe(false);
    await expect(draft.commit(persist)).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
    await expect(draft.commit(persist, true)).resolves.toBe(draft.id);
    await expect(draft.commit(persist, true)).resolves.toBe(draft.id);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('ignores timestamp bookkeeping but recognizes a property-only edit', async () => {
    const draft = createDraft(fixture().source);
    const date = draft.cells.get('date')!;

    date.set(YjsDatabaseKey.created_at, '999');
    date.set(YjsDatabaseKey.last_modified, '999');
    expect(draft.dirty).toBe(false);
    date.set(YjsDatabaseKey.include_time, true);
    expect(draft.dirty).toBe(true);
    const persist = jest.fn(async (snapshot: CalendarDraftSnapshot) => snapshot.id);

    await expect(draft.commit(persist)).resolves.toBe(draft.id);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping close and submit requests into one save', async () => {
    const draft = createDraft(fixture().source);

    setCell(draft, 'title', 'Edited');
    let resolveSave!: (id: string) => void;
    const persist = jest.fn(() => new Promise<string>((resolve) => { resolveSave = resolve; }));
    const first = draft.commit(persist);
    const second = draft.commit(persist, true);

    expect(first).toBe(second);
    expect(draft.saving).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    resolveSave(draft.id);
    await expect(first).resolves.toBe(draft.id);
    expect(draft.saving).toBe(false);
  });

  it('retains edits and the same row ID after a rejected or empty save result', async () => {
    const draft = createDraft(fixture().source);

    setCell(draft, 'title', 'Retry me');
    const attempts: string[] = [];
    const persist = jest.fn(async (snapshot: CalendarDraftSnapshot) => {
      attempts.push(snapshot.id);
      if (attempts.length === 1) throw new Error('Offline');
      if (attempts.length === 2) return null;
      expect(snapshot.cells.get('title')?.get(YjsDatabaseKey.data)).toBe('Retry me');
      return snapshot.id;
    });

    await expect(draft.commit(persist)).rejects.toThrow('Offline');
    expect(draft.saving).toBe(false);
    expect(draft.savedId).toBeNull();
    expect(draft.dirty).toBe(true);
    await expect(draft.commit(persist)).rejects.toThrow('could not be saved');
    await expect(draft.commit(persist)).resolves.toBe(draft.id);
    expect(attempts).toEqual([draft.id, draft.id, draft.id]);
  });
});

describe('CalendarEventDraft defaults and properties', () => {
  it('copies cloud bigint filter values without copying row orders or changing the live schema', () => {
    const { source, database, orders } = fixture();
    const filters = Y.Array.from([
      { id: 'notes-filter', field_id: 'notes', filter_type: BigInt(2), condition: BigInt(0), ty: BigInt(0), content: 'Inherited' },
      { id: 'title-filter', field_id: 'title', filter_type: BigInt(2), condition: BigInt(0), ty: BigInt(0), content: 'Filtered title' },
    ]);

    database.get(YjsDatabaseKey.views).get('calendar-view').set(YjsDatabaseKey.filters, filters);
    const before = Y.encodeStateAsUpdate(source.databaseDoc);
    const draft = createDraft(source);

    expect(draft.cells.get('notes')?.get(YjsDatabaseKey.data)).toBe('Inherited');
    expect(draft.cells.has('title')).toBe(false);
    expect(draft.dirty).toBe(false);
    expect(draft.database.get(YjsDatabaseKey.views).get('calendar-view').get(YjsDatabaseKey.row_orders).length).toBe(0);
    expect(orders.toArray()).toEqual([{ id: 'existing-row', height: 36 }]);
    expect(Y.encodeStateAsUpdate(source.databaseDoc)).toEqual(before);
  });

  it('normalizes exclusive all-day ranges and expands a short timed click to one hour', () => {
    const { source } = fixture();
    const oneDay = createDraft(source);
    const range = createDraft(source, { ...selection, end: new Date(2026, 8, 15) });
    const start = new Date(2026, 8, 11, 17);
    const timed = createDraft(source, { start, end: new Date(2026, 8, 11, 17, 30), allDay: false });

    expect(oneDay.cells.get('date')?.toJSON()).toMatchObject({
      data: String(dayjs(selection.start).unix()), is_range: false, include_time: false,
    });
    expect(oneDay.cells.get('date')?.get(YjsDatabaseKey.end_timestamp)).toBeUndefined();
    expect(range.cells.get('date')?.toJSON()).toMatchObject({
      end_timestamp: String(dayjs(new Date(2026, 8, 14, 23, 59)).unix()), is_range: true, include_time: false,
    });
    expect(timed.cells.get('date')?.toJSON()).toMatchObject({
      data: String(dayjs(start).unix()), end_timestamp: String(dayjs(new Date(2026, 8, 11, 18)).unix()),
      is_range: true, include_time: true,
    });
  });

  it('treats template defaults as untouched without loading or copying template documents', async () => {
    const { source } = fixture({
      templateId: 'template-id', name: 'Default', docViewId: 'template-document',
      isDocumentEmpty: false, embeddedDatabases: [], createdAtMs: 1, updatedAtMs: 1,
      icon: '📆', cover: '{"data":"#123456","cover_type":0}',
      defaultCells: { title: { type: 'text', value: 'Template title' }, check: { type: 'checkbox', value: true } },
    });
    const draft = createDraft(source);
    const persist = jest.fn();

    expect(draft.templateId).toBe('template-id');
    expect(draft.cells.get('title')?.get(YjsDatabaseKey.data)).toBe('Template title');
    expect(draft.cells.get('check')?.get(YjsDatabaseKey.data)).toBe('true');
    expect(draft.meta.get(getMetaIdMap(draft.id).get(RowMetaKey.IconId)!)).toBe('📆');
    expect(draft.dirty).toBe(false);
    await expect(draft.commit(persist)).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(source.loadRowDocument).not.toHaveBeenCalled();
    expect(source.createRowDocument).not.toHaveBeenCalled();
    expect(source.duplicateRowDocument).not.toHaveBeenCalled();
  });

  it('keeps nested advanced cell values and explicit empty properties in the save snapshot', async () => {
    const draft = createDraft(fixture().source);
    const related = ['0a67d8f8-4e07-4a2f-9c26-1b8a34cfd6b1'];
    const tasks = [JSON.stringify({ id: 'task-1', name: 'Check card', isSelected: true })];

    setCell(draft, 'relation', Y.Array.from(related));
    setCell(draft, 'checklist', Y.Array.from(tasks));
    setCell(draft, 'person', JSON.stringify(['cloud-person-id']));
    setCell(draft, 'title', '');
    const persist = jest.fn(async (snapshot: CalendarDraftSnapshot) => {
      expect(snapshot.cells).not.toBe(draft.cells);
      expect(snapshot.cells.toJSON()).toEqual(draft.cells.toJSON());
      expect(snapshot.cells.get('relation')?.get(YjsDatabaseKey.data)).toBeInstanceOf(Y.Array);
      expect(snapshot.cells.get('checklist')?.get(YjsDatabaseKey.data)).toBeInstanceOf(Y.Array);
      expect(snapshot.cells.get('title')?.get(YjsDatabaseKey.data)).toBe('');
      return snapshot.id;
    });

    await expect(draft.commit(persist)).resolves.toBe(draft.id);
  });

  it('uploads staged files only on commit and reuses completed uploads on save retry', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:calendar-file') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    const { source } = fixture();
    const draft = createDraft(source);
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const localUrl = await draft.context.uploadFile!(file);

    setCell(draft, 'media', Y.Array.from([JSON.stringify({ name: 'image.png', url: localUrl, file_type: 0 })]));
    expect(source.uploadFile).not.toHaveBeenCalled();
    const persist = jest.fn(async (snapshot: CalendarDraftSnapshot) => {
      const data = snapshot.cells.get('media')?.get(YjsDatabaseKey.data) as Y.Array<string>;

      expect(JSON.parse(data.get(0)).url).toBe('https://files.appflowy.io/uploaded');
      if (persist.mock.calls.length === 1) throw new Error('Save failed after upload');
      return snapshot.id;
    });

    await expect(draft.commit(persist)).rejects.toThrow('Save failed after upload');
    await expect(draft.commit(persist)).resolves.toBe(draft.id);
    expect(source.uploadFile).toHaveBeenCalledTimes(1);
    expect(source.uploadFile).toHaveBeenCalledWith(file);
    const localData = draft.cells.get('media')?.get(YjsDatabaseKey.data) as Y.Array<string>;

    expect(JSON.parse(localData.get(0)).url).toBe(localUrl);
  });

  it('releases a discarded file preview without uploading the attachment', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:discarded') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    const { source } = fixture();
    const draft = createDraft(source);

    await draft.context.uploadFile!(new File(['image'], 'discard.png'));
    draft.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:discarded');
    expect(source.uploadFile).not.toHaveBeenCalled();
    drafts.splice(drafts.indexOf(draft), 1);
  });

  it('stages new select options and preserves concurrently added remote options when saved', async () => {
    const { source, database } = fixture();
    const draft = createDraft(source);
    const localField = draft.database.get(YjsDatabaseKey.fields).get('tags');
    const liveField = database.get(YjsDatabaseKey.fields).get('tags');
    const existing = { id: 'existing', name: 'Existing', color: 0 };
    const local = { id: 'local', name: 'Local', color: 1 };
    const remote = { id: 'remote', name: 'Remote', color: 2 };

    getTypeOptions(localField)!.set(YjsDatabaseKey.content, JSON.stringify({ options: [existing, local] }));
    setCell(draft, 'tags', 'local');
    expect(parseSelectOptionTypeOptions(liveField).options).toEqual([existing]);
    getTypeOptions(liveField)!.set(YjsDatabaseKey.content, JSON.stringify({ options: [existing, remote] }));
    await draft.commit(async (snapshot) => snapshot.id);
    expect(parseSelectOptionTypeOptions(liveField).options).toEqual([existing, remote, local]);
  });
});
