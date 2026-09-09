import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, FieldVisibility, useFieldsSelector } from '@/application/database-yjs';
import { createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { useHidePropertyDispatch, useReorderColumnDispatch, useShowPropertyDispatch } from '@/application/database-yjs/dispatch';
import { generateFeedFieldSettings } from '@/application/database-yjs/feed-layout';
import { DatabaseViewLayout, YDatabase, YDatabaseFieldOrders, YDatabaseFields, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { FeedCardProperties } from '../FeedCardProperties';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/components/cell/Cell', () => ({ Cell: () => null }));

function createFixture(readOnly = false) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  fields.set('title', createField('title', FieldType.RichText).clone());
  fields.get('title').set(YjsDatabaseKey.is_primary, true);
  fields.set('status', createField('status', FieldType.SingleSelect, {
    options: [{ id: 'todo', name: 'Todo', color: 'Purple' }],
  }).clone());
  fields.set('done', createField('done', FieldType.Checkbox).clone());
  fields.set('estimate', createField('estimate', FieldType.Time).clone());
  for (const id of ['feed', 'other-view']) {
    const view = new Y.Map() as YDatabaseView;
    const orders = new Y.Array() as YDatabaseFieldOrders;

    orders.push([...fields.keys()].map((id) => ({ id })));
    views.set(id, view);
    view.set(YjsDatabaseKey.id, id);
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Feed);
    view.set(YjsDatabaseKey.field_orders, orders);
    view.set(YjsDatabaseKey.field_settings, generateFeedFieldSettings(database, orders));
  }

  const rowDoc = createRowDoc('row', 'database', {
    title: { fieldType: FieldType.RichText, data: 'Title' },
    status: { fieldType: FieldType.SingleSelect, data: 'todo' },
    done: { fieldType: FieldType.Checkbox, data: 'No' },
    estimate: { fieldType: FieldType.Time, data: '90' },
  });
  const context = {
    databaseDoc,
    databasePageId: 'database',
    activeViewId: 'feed',
    readOnly,
    rowMap: { row: rowDoc },
    workspaceId: '',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { rowDoc, databaseDoc, fields, views, wrapper };
}

function Card({ onNavigate }: { onNavigate?: () => void }) {
  const fields = useFieldsSelector();
  const show = useShowPropertyDispatch();
  const hide = useHidePropertyDispatch();
  const reorder = useReorderColumnDispatch();

  return (
    <>
      <button onClick={() => show('status')}>Show status</button>
      <button onClick={() => show('estimate')}>Show estimate</button>
      <button onClick={() => show('done')}>Show done</button>
      <button onClick={() => hide('status')}>Hide status</button>
      <button onClick={() => reorder('estimate', 'title')}>Move estimate first</button>
      <div onClick={onNavigate}>
        <FeedCardProperties fields={fields} primaryFieldId='title' rowId='row' />
      </div>
    </>
  );
}

describe('Feed card properties', () => {
  it('uses saved visibility and order, updates values live and keeps settings specific to the view', () => {
    const { rowDoc, fields, views, wrapper } = createFixture();
    const { unmount } = render(<Card />, { wrapper });

    expect(screen.queryByTestId('feed-card-properties-row')).toBeNull();
    fireEvent.click(screen.getByText('Show status'));
    fireEvent.click(screen.getByText('Show estimate'));
    expect(screen.getByTestId('feed-card-properties-row').textContent).toBe('statusTodoestimate1h 30m');
    expect(screen.queryByTestId('feed-field-title-row')).toBeNull();
    fireEvent.click(screen.getByText('Move estimate first'));
    expect(screen.getByTestId('feed-card-properties-row').textContent).toBe('estimate1h 30mstatusTodo');
    act(() => {
      fields.get('estimate').set(YjsDatabaseKey.name, 'Effort');
      rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!
        .get(YjsDatabaseKey.cells).get('estimate')!.set(YjsDatabaseKey.data, '120');
    });
    expect(screen.getByTestId('feed-field-estimate-row').textContent).toBe('Effort2h');
    fireEvent.click(screen.getByText('Hide status'));
    expect(screen.queryByTestId('feed-field-status-row')).toBeNull();
    expect(views.get('feed').get(YjsDatabaseKey.field_settings).get('estimate')
      .get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    expect(views.get('other-view').get(YjsDatabaseKey.field_settings).get('estimate')
      .get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);
    unmount();
    render(<Card />, { wrapper });
    expect(screen.getByTestId('feed-card-properties-row').textContent).toBe('Effort2h');
    expect(screen.queryByTestId('feed-field-status-row')).toBeNull();
  });

  it.each([false, true])('honors read-only access (%s) for inline checkboxes and does not navigate', async (readOnly) => {
    const { rowDoc, databaseDoc, views, wrapper } = createFixture(readOnly);
    const onNavigate = jest.fn();

    views.get('feed').get(YjsDatabaseKey.field_settings).get('done')
      .set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    const rowBefore = Y.encodeStateAsUpdate(rowDoc);
    const databaseBefore = Y.encodeStateAsUpdate(databaseDoc);

    render(<Card onNavigate={onNavigate} />, { wrapper });
    expect(Y.encodeStateAsUpdate(rowDoc)).toEqual(rowBefore);
    expect(Y.encodeStateAsUpdate(databaseDoc)).toEqual(databaseBefore);
    const checkbox = screen.getByRole('checkbox');

    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId('feed-field-done-row'));
    await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe(String(!readOnly)));
    expect(onNavigate).not.toHaveBeenCalled();
    if (readOnly) {
      expect((checkbox as HTMLButtonElement).disabled).toBe(true);
      expect(Y.encodeStateAsUpdate(rowDoc)).toEqual(rowBefore);
    }
  });
});
