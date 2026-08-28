import * as Y from 'yjs';

import {
  FORM_DECIDED_SENTINEL,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_SENTINEL,
  FORM_INCLUDED,
  FORM_ORDER,
  FORM_REQUIRED,
  readFormLayoutSnapshot,
} from '@/application/database-yjs/form-questions';
import { createFormWriter } from '@/application/database-yjs/form-writer';
import type { YDatabaseFormFieldSettings, YDatabaseView } from '@/application/types';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';

function createView(fieldIds: readonly string[]): YDatabaseView {
  const doc = new Y.Doc();
  const view = doc.getMap('view') as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(fieldIds.map((id) => ({ id })));
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Form);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  return view;
}

function ensureSettings(view: YDatabaseView): YDatabaseFormFieldSettings {
  let settings = view.get(YjsDatabaseKey.form_field_settings);

  if (!settings) {
    settings = new Y.Map() as YDatabaseFormFieldSettings;
    view.set(YjsDatabaseKey.form_field_settings, settings);
  }
  return settings;
}

function setEntry(view: YDatabaseView, fieldId: string, values: Record<string, unknown> = {}): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();

  Object.entries(values).forEach(([key, value]) => entry.set(key, value));
  ensureSettings(view).set(fieldId, entry);
  return entry;
}

function markBuilderMode(view: YDatabaseView): void {
  setEntry(view, FORM_DECIDED_SENTINEL, { [FORM_INCLUDED]: false });
}

describe('form projection compatibility contract', () => {
  it('does not synthesize form questions for another database layout', () => {
    const view = createView(['field-a']);

    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);

    expect(readFormLayoutSnapshot(view).questions).toEqual([]);
  });

  it('materializes legacy default-included questions from field order when the settings map is missing', () => {
    const view = createView(['field-b', 'field-a']);

    expect(readFormLayoutSnapshot(view)).toMatchObject({
      decided: false,
      questions: [
        { fieldId: 'field-b', included: true, required: false },
        { fieldId: 'field-a', included: true, required: false },
      ],
    });
  });

  it('merges partial legacy overrides, honors explicit exclusions, and drops orphan settings', () => {
    const view = createView(['field-b', 'field-a', 'field-c']);

    setEntry(view, 'field-a', { [FORM_REQUIRED]: true });
    setEntry(view, 'field-c', { [FORM_INCLUDED]: false });
    setEntry(view, 'deleted-field', { [FORM_REQUIRED]: true, [FORM_ORDER]: 0 });
    setEntry(view, FORM_DESCRIPTION_SENTINEL, { [FORM_DESCRIPTION]: 'Legacy form' });

    const snapshot = readFormLayoutSnapshot(view);

    expect(snapshot.decided).toBe(false);
    expect(snapshot.description).toBe('Legacy form');
    expect(snapshot.questions.map(({ fieldId }) => fieldId)).toEqual(['field-b', 'field-a']);
    expect(snapshot.questions[1].required).toBe(true);
  });

  it('uses explicit opt-in semantics once the decided sentinel exists', () => {
    const view = createView(['field-a', 'field-b']);

    markBuilderMode(view);
    setEntry(view, 'field-b', { [FORM_INCLUDED]: true, [FORM_ORDER]: 0 });
    setEntry(view, 'deleted-field', { [FORM_INCLUDED]: true, [FORM_ORDER]: 1 });

    const snapshot = readFormLayoutSnapshot(view);

    expect(snapshot.decided).toBe(true);
    expect(snapshot.questions.map(({ fieldId }) => fieldId)).toEqual(['field-b']);
  });

  it('persists a false override when removing a legacy-defaulted question', () => {
    const view = createView(['field-a', 'field-b']);
    const writer = createFormWriter(view);

    writer.removeQuestion('field-a');

    expect(view.get(YjsDatabaseKey.form_field_settings)?.get('field-a')?.get(FORM_INCLUDED)).toBe(false);
    expect(readFormLayoutSnapshot(view).questions.map(({ fieldId }) => fieldId)).toEqual(['field-b']);
  });

  it('reorders only the caller-resolved visible IDs', () => {
    const view = createView(['field-a', 'hidden-field', 'field-b']);

    markBuilderMode(view);
    setEntry(view, 'field-a', { [FORM_INCLUDED]: true, [FORM_ORDER]: 0 });
    const hidden = setEntry(view, 'hidden-field', { [FORM_INCLUDED]: false, [FORM_ORDER]: 1 });
    setEntry(view, 'field-b', { [FORM_INCLUDED]: true, [FORM_ORDER]: 2 });
    const orphan = setEntry(view, 'deleted-field', { [FORM_INCLUDED]: true, [FORM_ORDER]: 0 });

    createFormWriter(view).reorderQuestion('field-a', 1, ['field-a', 'field-b']);

    expect(readFormLayoutSnapshot(view).questions.map(({ fieldId }) => fieldId)).toEqual(['field-b', 'field-a']);
    expect(hidden.get(FORM_ORDER)).toBe(1);
    expect(orphan.get(FORM_ORDER)).toBe(0);
  });
});
