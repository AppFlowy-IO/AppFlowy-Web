import * as Y from 'yjs';

import {
  FORM_DECIDED_SENTINEL,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_VISIBLE,
  FORM_INCLUDED,
  FORM_LONG_ANSWER,
  FORM_ORDER,
  FORM_REQUIRED,
  readFormLayoutSnapshot,
} from '@/application/database-yjs/form-questions';
import { createFormWriter } from '@/application/database-yjs/form-writer';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  YDatabaseFormFieldSettings,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createFixture(fieldIds: readonly string[]) {
  const databaseDoc = new Y.Doc();
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map<unknown>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>();
  const settings = new Y.Map() as YDatabaseFormFieldSettings;
  const decided = new Y.Map<unknown>();

  fieldOrders.push(fieldIds.map((id) => ({ id })));
  decided.set(FORM_INCLUDED, false);
  settings.set(FORM_DECIDED_SENTINEL, decided);
  fieldIds.slice(0, 2).forEach((fieldId, index) => {
    const entry = new Y.Map<unknown>();

    entry.set(FORM_INCLUDED, true);
    entry.set(FORM_ORDER, index);
    settings.set(fieldId, entry);
  });
  view.set(YjsDatabaseKey.id, 'form-view-id');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Form);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.form_field_settings, settings);
  views.set('form-view-id', view);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return { databaseDoc, settings, view };
}

describe('Form writer database history', () => {
  it('undoes and redoes question add, remove, and reorder actions', () => {
    const { databaseDoc, view } = createFixture(['field-a', 'field-b', 'field-c']);
    const writer = createFormWriter(view);
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);
    const questionIds = () => readFormLayoutSnapshot(view).questions.map(({ fieldId }) => fieldId);

    writer.addQuestion('field-c');
    expect(questionIds()).toEqual(['field-a', 'field-b', 'field-c']);
    history.undo();
    expect(questionIds()).toEqual(['field-a', 'field-b']);
    history.redo();
    expect(questionIds()).toEqual(['field-a', 'field-b', 'field-c']);

    history.clear();
    writer.removeQuestion('field-a');
    expect(questionIds()).toEqual(['field-b', 'field-c']);
    history.undo();
    expect(questionIds()).toEqual(['field-a', 'field-b', 'field-c']);

    history.clear();
    writer.reorderQuestion('field-a', 2, ['field-a', 'field-b', 'field-c']);
    expect(questionIds()).toEqual(['field-b', 'field-c', 'field-a']);
    history.undo();
    expect(questionIds()).toEqual(['field-a', 'field-b', 'field-c']);
    history.redo();
    expect(questionIds()).toEqual(['field-b', 'field-c', 'field-a']);

    databaseDoc.destroy();
  });

  it('tracks each Form question toggle as a database history action', () => {
    const { databaseDoc, settings, view } = createFixture(['field-a', 'field-b']);
    const writer = createFormWriter(view);
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);
    const entry = settings.get('field-a');

    writer.setRequired('field-a', true);
    expect(entry?.get(FORM_REQUIRED)).toBe(true);
    history.undo();
    expect(entry?.get(FORM_REQUIRED)).toBeUndefined();

    history.clear();
    writer.setDescriptionVisible('field-a', true);
    expect(entry?.get(FORM_DESCRIPTION_VISIBLE)).toBe(true);
    history.undo();
    expect(entry?.get(FORM_DESCRIPTION_VISIBLE)).toBeUndefined();

    history.clear();
    writer.setLongAnswer('field-a', true);
    expect(entry?.get(FORM_LONG_ANSWER)).toBe(true);
    history.undo();
    expect(entry?.get(FORM_LONG_ANSWER)).toBeUndefined();

    databaseDoc.destroy();
  });

  it('resolves auto-create membership and the decided sentinel as one undoable action', () => {
    const { databaseDoc, settings, view } = createFixture(['field-a', 'field-b']);

    // Model an unresolved legacy Form whose default-included fields are
    // waiting for the one-time auto-create choice.
    settings.delete(FORM_DECIDED_SENTINEL);
    const writer = createFormWriter(view);
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    writer.resolveAutoCreate(['field-b']);
    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: true,
      questions: [{ fieldId: 'field-b' }],
    });
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: false,
      questions: [{ fieldId: 'field-a' }, { fieldId: 'field-b' }],
    });
    expect(history.canUndo()).toBe(false);

    history.redo();
    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: true,
      questions: [{ fieldId: 'field-b' }],
    });

    databaseDoc.destroy();
  });

  it('preserves legacy question attributes while materializing explicit membership', () => {
    const { databaseDoc, settings, view } = createFixture(['field-a', 'field-b']);
    const legacyEntry = settings.get('field-b');

    settings.delete(FORM_DECIDED_SENTINEL);
    legacyEntry?.set(FORM_REQUIRED, true);
    legacyEntry?.set(FORM_DESCRIPTION_VISIBLE, true);
    legacyEntry?.set(FORM_DESCRIPTION, 'Keep this guidance');
    legacyEntry?.set(FORM_LONG_ANSWER, true);

    createFormWriter(view).resolveAutoCreate(['field-b']);

    expect(settings.get('field-b')).toBe(legacyEntry);
    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: true,
      questions: [
        {
          fieldId: 'field-b',
          required: true,
          descriptionVisible: true,
          description: 'Keep this guidance',
          longAnswer: true,
        },
      ],
    });

    databaseDoc.destroy();
  });

  it('materializes every visible legacy question before the first override edit', () => {
    const { databaseDoc, settings, view } = createFixture(['field-a', 'field-b', 'field-c']);

    settings.delete(FORM_DECIDED_SENTINEL);
    createFormWriter(view).setRequired('field-c', true);

    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: true,
      questions: [{ fieldId: 'field-a' }, { fieldId: 'field-b' }, { fieldId: 'field-c', required: true }],
    });
    expect(settings.get('field-c')?.get(FORM_INCLUDED)).toBe(true);

    databaseDoc.destroy();
  });

  it('materializes the remaining legacy projection when removing a synthesized question', () => {
    const { databaseDoc, settings, view } = createFixture(['field-a', 'field-b', 'field-c']);

    settings.delete(FORM_DECIDED_SENTINEL);
    createFormWriter(view).removeQuestion('field-c');

    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: true,
      questions: [{ fieldId: 'field-a' }, { fieldId: 'field-b' }],
    });
    expect(settings.has('field-c')).toBe(false);

    databaseDoc.destroy();
  });
});
