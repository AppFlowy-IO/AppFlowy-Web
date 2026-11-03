import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useGlobalFilterSources, UseGlobalFilterSourcesOptions } from '../useGlobalFilterSources';

import { addField, createSourceDoc, option, setFieldOptions } from './source-doc.fixture';

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});

const todo = option('o-todo', 'Todo');
const done = option('o-done', 'Done');

function createDocs() {
  return {
    'db-a': createSourceDoc('db-a', [
      { id: 'a-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
      { id: 'a-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
    ]),
    'db-b': createSourceDoc('db-b', [
      { id: 'b-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
      { id: 'b-state', name: 'State', type: FieldType.SingleSelect, options: [todo] },
    ]),
    'db-c': createSourceDoc('db-c', [{ id: 'c-title', name: 'Title', type: FieldType.RichText, isPrimary: true }]),
  } as Record<string, YDoc>;
}

function fieldsMap(doc: YDoc) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;

  return database.get(YjsDatabaseKey.fields) as Y.Map<Y.Map<unknown>>;
}

interface Props {
  sourceDocs: Record<string, YDoc>;
  options?: UseGlobalFilterSourcesOptions;
}

function renderSources(initialProps: Props) {
  const renders = jest.fn();
  const hook = renderHook(
    ({ sourceDocs, options }: Props) => {
      renders();
      return useGlobalFilterSources(sourceDocs, {}, options);
    },
    { initialProps }
  );

  return { ...hook, renders };
}

/** Lets a deferred observer detach run. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useGlobalFilterSources', () => {
  it('lists the mounted sources without an extra render on mount', () => {
    const docs = createDocs();
    const { result, renders } = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-b', 'db-a'] } });

    expect(renders).toHaveBeenCalledTimes(1);
    expect(result.current.map((source) => source.databaseId)).toEqual(['db-b', 'db-a']);
    expect(result.current[1].fields.map((field) => field.id)).toEqual(['a-name', 'a-status']);
    expect(result.current[1].name).toBe('Untitled');
  });

  it('re-reads only the changed doc and keeps the other property lists', () => {
    const docs = createDocs();
    const { result } = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a', 'db-b'] } });
    const [a, b] = result.current;

    act(() => setFieldOptions(docs['db-a'], 'a-status', FieldType.SingleSelect, [todo, { ...done, name: 'Finished' }]));

    expect(result.current[0].fields).not.toBe(a.fields);
    expect(result.current[0].fields[1].options.map((item) => item.name)).toEqual(['Todo', 'Finished']);
    expect(result.current[1].fields).toBe(b.fields);

    act(() => addField(docs['db-b'], { id: 'b-points', name: 'Points', type: FieldType.Number }));
    expect(result.current[1].fields.map((field) => field.id)).toEqual(['b-title', 'b-state', 'b-points']);
  });

  it('ignores changes that leave the property lists equal', () => {
    const docs = createDocs();
    const { result, renders } = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });
    const lists = result.current;

    // An unrelated key inside a field (e.g. a column width) changes nothing listed.
    act(() => {
      fieldsMap(docs['db-a']).get('a-name')?.set('width', 200);
    });

    expect(renders).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(lists);
  });

  it('observes only the listed docs', () => {
    const docs = createDocs();
    const unlisted = jest.spyOn(fieldsMap(docs['db-c']), 'observeDeep');
    const { renders } = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });

    act(() => setFieldOptions(docs['db-b'], 'b-state', FieldType.SingleSelect, [done]));
    expect(unlisted).not.toHaveBeenCalled();
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('shares one set of observers per doc between components', () => {
    const docs = createDocs();
    const observe = jest.spyOn(fieldsMap(docs['db-a']), 'observeDeep');
    const first = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });
    const second = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });

    expect(observe).toHaveBeenCalledTimes(1);
    expect(second.result.current[0].fields).toBe(first.result.current[0].fields);

    act(() => setFieldOptions(docs['db-a'], 'a-status', FieldType.SingleSelect, [todo]));
    expect(first.result.current[0].fields[1].options).toEqual([todo]);
    expect(second.result.current[0].fields).toBe(first.result.current[0].fields);
  });

  it('keeps observers and lists of registered docs when another doc registers', async () => {
    const docs = createDocs();
    const observe = jest.spyOn(fieldsMap(docs['db-a']), 'observeDeep');
    const unobserve = jest.spyOn(fieldsMap(docs['db-a']), 'unobserveDeep');
    const { result, rerender, renders } = renderSources({ sourceDocs: { 'db-a': docs['db-a'] } });
    const a = result.current[0];

    rerender({ sourceDocs: { 'db-a': docs['db-a'], 'db-b': docs['db-b'] } });
    await flushMicrotasks();

    expect(result.current.map((source) => source.databaseId)).toEqual(['db-a', 'db-b']);
    expect(result.current[0].fields).toBe(a.fields);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(unobserve).not.toHaveBeenCalled();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('follows a replaced column-order array and a change of the reference view', () => {
    const doc = createSourceDoc('db-x', [
      { id: 'x-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
      { id: 'x-status', name: 'Status', type: FieldType.SingleSelect, options: [todo] },
      { id: 'x-points', name: 'Points', type: FieldType.Number },
    ]);
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const inlineView = views.get('db-x-view') as Y.Map<unknown>;
    const { result } = renderSources({ sourceDocs: { 'db-x': doc } });

    expect(result.current[0].fields.map((field) => field.id)).toEqual(['x-name', 'x-status', 'x-points']);

    // Desktop replaces the whole array instead of moving items inside it.
    act(() => {
      doc.transact(() => {
        const orders = new Y.Array<{ id: string }>();

        inlineView.set(YjsDatabaseKey.field_orders, orders);
        orders.push([{ id: 'x-points' }, { id: 'x-status' }, { id: 'x-name' }]);
      });
    });
    expect(result.current[0].fields.map((field) => field.id)).toEqual(['x-name', 'x-points', 'x-status']);

    // Another view becomes the reference: its order wins from then on.
    act(() => {
      doc.transact(() => {
        const view = new Y.Map<unknown>();
        const orders = new Y.Array<{ id: string }>();

        inlineView.set(YjsDatabaseKey.is_inline, false);
        views.set('db-x-other', view);
        view.set(YjsDatabaseKey.is_inline, true);
        view.set(YjsDatabaseKey.field_orders, orders);
        orders.push([{ id: 'x-status' }, { id: 'x-points' }, { id: 'x-name' }]);
      });
    });
    expect(result.current[0].fields.map((field) => field.id)).toEqual(['x-name', 'x-status', 'x-points']);

    // The new reference's array is what is observed now.
    act(() => {
      (views.get('db-x-other')?.get(YjsDatabaseKey.field_orders) as Y.Array<{ id: string }>).delete(0, 1);
    });
    expect(result.current[0].fields.map((field) => field.id)).toEqual(['x-name', 'x-points', 'x-status']);
  });

  it('detaches after the last listener leaves and catches up on changes made meanwhile', async () => {
    const docs = createDocs();
    const unobserve = jest.spyOn(fieldsMap(docs['db-a']), 'unobserveDeep');
    const first = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });

    first.unmount();
    await flushMicrotasks();
    expect(unobserve).toHaveBeenCalledTimes(1);

    act(() => addField(docs['db-a'], { id: 'a-points', name: 'Points', type: FieldType.Number }));
    const second = renderSources({ sourceDocs: docs, options: { databaseIds: ['db-a'] } });

    expect(second.result.current[0].fields.map((field) => field.id)).toEqual(['a-name', 'a-status', 'a-points']);
  });
});
