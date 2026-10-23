import { fireEvent, render, screen, within } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { BoardNoGroup } from '@/components/database/components/board/group/BoardNoGroup';

const mockGroupBy = jest.fn();
const mockCreateGroupingField = jest.fn();

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useCreateBoardGroupingFieldDispatch: () => mockCreateGroupingField,
  useGroupByFieldDispatch: () => mockGroupBy,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key),
  }),
}));

const viewId = 'board-view-id';

function createContext(fieldSpecs: { id: string; name: string; type: FieldType }[], readOnly = false) {
  const databaseDoc = new Y.Doc({ guid: `board-no-group-${fieldSpecs.length}-${readOnly}` }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldSpecs.forEach(({ id, name, type }) => {
    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.id, id);
    field.set(YjsDatabaseKey.name, name);
    field.set(YjsDatabaseKey.type, type);
    fields.set(id, field);
  });
  fieldOrders.push(fieldSpecs.map(({ id }) => ({ id })));
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
  view.set(YjsDatabaseKey.field_orders, fieldOrders as never);
  view.set(YjsDatabaseKey.field_settings, new Y.Map() as never);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

function openGroupByMenu() {
  const trigger = screen.getByTestId('board-no-group-group-by');

  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.getByTestId('board-no-group-menu');
}

beforeEach(() => {
  mockGroupBy.mockClear();
  mockCreateGroupingField.mockClear();
});

describe('BoardNoGroup', () => {
  it('names a grouping the web Board cannot draw and regroups it by a Select property', () => {
    const wrapper = createContext([
      { id: 'name', name: 'Name', type: FieldType.RichText },
      { id: 'due', name: 'Due date', type: FieldType.DateTime },
      { id: 'type', name: 'Type', type: FieldType.SingleSelect },
      { id: 'done', name: 'Done', type: FieldType.Checkbox },
    ]);

    render(<BoardNoGroup fieldId='due' />, { wrapper });

    expect(screen.getByTestId('board-no-group-description').textContent).toBe('board.noGroupUnsupported(Due date)');
    const menu = openGroupByMenu();

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('data-testid'))
    ).toEqual(['board-no-group-field-type', 'board-no-group-field-done']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Type' }));
    expect(mockGroupBy).toHaveBeenCalledWith('type');
    expect(mockCreateGroupingField).not.toHaveBeenCalled();
  });

  it('offers a new Status property when nothing can group the Board', () => {
    const wrapper = createContext([
      { id: 'name', name: 'Name', type: FieldType.RichText },
      { id: 'due', name: 'Due date', type: FieldType.DateTime },
    ]);

    render(<BoardNoGroup fieldId='due' />, { wrapper });
    fireEvent.click(within(openGroupByMenu()).getByTestId('board-no-group-create-status'));
    expect(mockCreateGroupingField).toHaveBeenCalledTimes(1);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it('only explains the empty Board to readers', () => {
    const wrapper = createContext([{ id: 'name', name: 'Name', type: FieldType.RichText }], true);

    render(<BoardNoGroup />, { wrapper });

    expect(screen.getByTestId('board-no-group-description').textContent).toBe('board.noGroupDesc');
    expect(screen.queryByTestId('board-no-group-group-by')).toBeNull();
  });
});
