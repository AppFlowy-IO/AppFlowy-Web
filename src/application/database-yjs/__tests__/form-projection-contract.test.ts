import * as Y from 'yjs';

import {
  FORM_DECIDED_SENTINEL,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_SENTINEL,
  FORM_DESCRIPTION_VISIBLE,
  FORM_INCLUDED,
  FORM_LONG_ANSWER,
  FORM_ORDER,
  FORM_REQUIRED,
  FORM_TITLE,
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
      fieldOrderIds: ['field-b', 'field-a'],
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
    setEntry(view, FORM_DESCRIPTION_SENTINEL, {
      [FORM_TITLE]: 'Customer feedback',
      [FORM_DESCRIPTION]: 'Legacy form',
    });

    const snapshot = readFormLayoutSnapshot(view);

    expect(snapshot.decided).toBe(false);
    expect(snapshot.respondentTitle).toBe('Customer feedback');
    expect(snapshot.description).toBe('Legacy form');
    expect(snapshot.questions.map(({ fieldId }) => fieldId)).toEqual(['field-b', 'field-a']);
    expect(snapshot.questions[1].required).toBe(true);
  });

  it('keeps respondent title authoring raw and defaults missing or malformed values to empty', () => {
    const view = createView([]);

    expect(readFormLayoutSnapshot(view).respondentTitle).toBe('');

    setEntry(view, FORM_DESCRIPTION_SENTINEL, { [FORM_TITLE]: 42 });
    expect(readFormLayoutSnapshot(view).respondentTitle).toBe('');

    ensureSettings(view).get(FORM_DESCRIPTION_SENTINEL)?.set(FORM_TITLE, '  ');
    expect(readFormLayoutSnapshot(view).respondentTitle).toBe('  ');
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

  it('atomically materializes legacy membership before removing a defaulted question', () => {
    const view = createView(['field-a', 'field-b']);
    const writer = createFormWriter(view);

    writer.removeQuestion('field-a');

    const settings = view.get(YjsDatabaseKey.form_field_settings);

    expect(settings?.has(FORM_DECIDED_SENTINEL)).toBe(true);
    expect(settings?.has('field-a')).toBe(false);
    expect(settings?.get('field-b')?.get(FORM_INCLUDED)).toBe(true);
    expect(settings?.get('field-b')?.get(FORM_ORDER)).toBe(0);
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

  it('does not resurrect a removed question through stale override callbacks', () => {
    const view = createView(['field-a']);

    markBuilderMode(view);
    setEntry(view, 'field-a', { [FORM_INCLUDED]: true, [FORM_ORDER]: 0 });
    const writer = createFormWriter(view);

    writer.removeQuestion('field-a');
    writer.setRequired('field-a', true);
    writer.setDescriptionVisible('field-a', true);
    writer.setDescription('field-a', 'Stale draft');
    writer.setLongAnswer('field-a', true);

    const settings = view.get(YjsDatabaseKey.form_field_settings);

    expect(settings?.has('field-a')).toBe(false);
    expect(settings?.get('field-a')?.get(FORM_REQUIRED)).toBeUndefined();
    expect(settings?.get('field-a')?.get(FORM_DESCRIPTION_VISIBLE)).toBeUndefined();
    expect(settings?.get('field-a')?.get(FORM_DESCRIPTION)).toBeUndefined();
    expect(settings?.get('field-a')?.get(FORM_LONG_ANSWER)).toBeUndefined();
  });
});
