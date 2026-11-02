import { act, render, renderHook } from '@testing-library/react';
import { memo, useLayoutEffect, useMemo } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DatabaseViewOverlayContext,
  useDatabase,
} from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import {
  useDatabaseIdFromField,
  useFieldSelector,
  useFieldType,
  useFieldVisibility,
  useFieldWrap,
} from '@/application/database-yjs/selector';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import {
  YDatabase,
  YDatabaseFields,
  YDatabaseViews,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createField, createFieldWithTypeOption } from './test-helpers';

function fixture() {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  views.set('other-view', view);
  fields.set('title', createField('title', FieldType.RichText).clone());
  fields.set('other', createField('other', FieldType.Number).clone());
  const context = {
    databaseDoc,
    activeViewId: 'active-view',
    databasePageId: 'page',
    rowMap: {},
    workspaceId: '',
    readOnly: true,
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { databaseDoc, database, fields, view, context, wrapper };
}

it('does not render memoized field consumers for an unrelated view or field edit', () => {
  const { fields, view, wrapper: Wrapper } = fixture();
  let renders = 0;
  const Consumer = memo(() => {
    useFieldType('title');
    useFieldSelector('title');
    useDatabaseFieldsVersion(false);
    renders++;
    return null;
  });

  render(
    <Wrapper>
      {Array.from({ length: 100 }, (_, index) => (
        <Consumer key={index} />
      ))}
    </Wrapper>
  );
  const before = renders;

  act(() => {
    view.set(YjsDatabaseKey.name, 'Renamed unrelated view');
  });
  act(() => {
    fields.get('other').set(YjsDatabaseKey.name, 'Renamed unrelated field');
  });
  expect(renders).toBe(before);

  act(() => {
    fields.get('title').set(YjsDatabaseKey.name, 'Renamed selected field');
  });
  expect(renders).toBe(before + 100);
});

it('keeps legacy database consumers subscribed to deep changes', () => {
  const { view, wrapper } = fixture();
  let renders = 0;

  renderHook(
    () => {
      useDatabase();
      renders++;
    },
    { wrapper }
  );
  const before = renders;

  act(() => {
    view.set(YjsDatabaseKey.name, 'Renamed view');
  });
  expect(renders).toBeGreaterThan(before);
});

it('tracks selected field hydration, field/schema/root replacement and field option edits', () => {
  const { databaseDoc, database, fields, wrapper } = fixture();
  const { result } = renderHook(() => ({ type: useFieldType('late'), selected: useFieldSelector('late') }), { wrapper });

  expect(result.current.selected.field).toBeUndefined();
  act(() => {
    fields.set(
      'late',
      createField('late', FieldType.SingleSelect, { options: [{ id: 'ready', name: 'Ready' }] }).clone()
    );
  });
  expect(result.current.type).toBe(FieldType.SingleSelect);
  const first = result.current.selected.field!;
  const clock = result.current.selected.clock;

  act(() => {
    first
      .get(YjsDatabaseKey.type_option)
      .get(String(FieldType.SingleSelect))
      .set(YjsDatabaseKey.content, '{"options":[]}');
  });
  expect(result.current.selected.clock).toBeGreaterThan(clock);

  const replacement = createField('late', FieldType.Number).clone();

  act(() => {
    fields.set('late', replacement);
  });
  expect(result.current.selected.field).toBe(replacement);
  expect(result.current.type).toBe(FieldType.Number);

  const replacementFields = new Y.Map() as YDatabaseFields;
  const hydratedField = createField('late', FieldType.Checkbox).clone();

  replacementFields.set('late', hydratedField);
  act(() => {
    database.set(YjsDatabaseKey.fields, replacementFields);
  });
  expect(result.current.selected.field).toBe(hydratedField);
  expect(result.current.type).toBe(FieldType.Checkbox);

  const replacementDatabase = new Y.Map() as YDatabase;
  const rootFields = new Y.Map() as YDatabaseFields;
  const rootField = createField('late', FieldType.RichText).clone();

  rootFields.set('late', rootField);
  replacementDatabase.set(YjsDatabaseKey.fields, rootFields);
  act(() => {
    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, replacementDatabase);
  });
  expect(result.current.selected.field).toBe(rootField);
  expect(result.current.type).toBe(FieldType.RichText);
});

it('follows shared field settings through a conditions overlay and settings replacement', () => {
  const { context, database, wrapper: Wrapper } = fixture();
  const view = new Y.Map() as YDatabaseView;
  const settings = new Y.Map();
  const setting = new Y.Map();

  setting.set(YjsDatabaseKey.wrap, false);
  setting.set(YjsDatabaseKey.visibility, 0);
  settings.set('title', setting);
  view.set(YjsDatabaseKey.field_settings, settings as never);
  database.get(YjsDatabaseKey.views).set(context.activeViewId, view);
  const overlay = createViewConditionsOverlay(view);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseViewOverlayContext.Provider value={overlay.view}>
      <Wrapper>{children}</Wrapper>
    </DatabaseViewOverlayContext.Provider>
  );
  const { result, unmount } = renderHook(
    () => ({ wrap: useFieldWrap('title'), visibility: useFieldVisibility('title') }),
    { wrapper }
  );

  expect(result.current).toEqual({ wrap: false, visibility: 0 });
  act(() => {
    // Only filters and sorts are private: this setting writes through to the source.
    const sharedSetting = overlay.view.get(YjsDatabaseKey.field_settings).get('title');

    sharedSetting.set(YjsDatabaseKey.wrap, true);
    sharedSetting.set(YjsDatabaseKey.visibility, 2);
  });
  expect(result.current).toEqual({ wrap: true, visibility: 2 });

  const replacement = new Y.Map();
  const replacementSetting = new Y.Map();

  replacementSetting.set(YjsDatabaseKey.wrap, false);
  replacementSetting.set(YjsDatabaseKey.visibility, 1);
  replacement.set('title', replacementSetting);
  act(() => {
    view.set(YjsDatabaseKey.field_settings, replacement as never);
  });
  expect(result.current).toEqual({ wrap: false, visibility: 1 });
  unmount();
  overlay.destroy();
});

it('reads selected field edits made by a child before the field observer subscribes', () => {
  const { fields, wrapper: Wrapper } = fixture();
  const field = fields.get('title');
  const observe = jest.spyOn(field, 'observeDeep');
  const unobserve = jest.spyOn(field, 'unobserveDeep');

  function Mutation() {
    useLayoutEffect(() => {
      field.set(YjsDatabaseKey.name, 'After');
    }, []);
    return null;
  }

  function Consumer() {
    const { field: selected, clock } = useFieldSelector('title');
    const name = useMemo(() => {
      void clock;
      return selected?.get(YjsDatabaseKey.name);
    }, [selected, clock]);

    return (
      <>
        <output data-testid='field-name'>{name}</output>
        <Mutation />
      </>
    );
  }

  const { getByTestId, unmount } = render(
    <Wrapper>
      <Consumer />
    </Wrapper>
  );

  expect(getByTestId('field-name').textContent).toBe('After');
  expect(observe).toHaveBeenCalledTimes(1);
  unmount();
  expect(unobserve).toHaveBeenCalledTimes(1);
});

it('follows missing relation fields and nested target option changes', () => {
  const { fields, wrapper } = fixture();
  const { result } = renderHook(() => useDatabaseIdFromField('relation'), { wrapper });

  expect(result.current).toBeUndefined();
  act(() => {
    fields.set('relation', createFieldWithTypeOption('relation', FieldType.Relation, { database_id: 'first' }).clone());
  });
  expect(result.current).toBe('first');
  act(() => {
    fields.get('relation').get(YjsDatabaseKey.type_option).get(String(FieldType.Relation)).set('database_id', 'second');
  });
  expect(result.current).toBe('second');
  act(() => {
    fields.delete('relation');
  });
  expect(result.current).toBeUndefined();
});
