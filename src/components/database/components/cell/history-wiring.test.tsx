import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import {
  YDatabase,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDatabaseFields,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';
import AITextCellActions from '@/components/database/components/cell/ai-text/AITextCellActions';
import SelectOptionCellMenu from '@/components/database/components/cell/select-option/SelectOptionCellMenu';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
import { AFConfigContext } from '@/components/main/app.hooks';

import type { ReactNode } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: () => null,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

// Option dragging is unrelated to create-from-cell wiring and requires browser
// drag-and-drop APIs that jsdom does not provide.
jest.mock('@/components/database/components/property/select/Options', () => () => null);

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'generated-field-id';
const sourceFieldId = 'source-field-id';

type Fixture = {
  database: YDatabase;
  databaseDoc: YDoc;
  fields: YDatabaseFields;
  view: YDatabaseView;
};

function createField(id: string, name: string, type: FieldType): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, type);
  return field;
}

function createSelectField(): YDatabaseField {
  const field = createField(fieldId, 'Status', FieldType.SingleSelect);
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  typeOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

function createFixture(initialFields: Array<[string, YDatabaseField]>): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.groups, new Y.Array() as YDatabaseGroups);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  initialFields.forEach(([id, field]) => {
    fields.set(id, field);
  });

  return { database, databaseDoc, fields, view };
}

function createRowDoc(cellValues: Array<[string, FieldType, string]> = []): YDoc {
  const rowDoc = new Y.Doc() as YDoc;
  const sharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.created_at, '0');
  row.set(YjsDatabaseKey.last_modified, '0');
  sharedRoot.set(YjsEditorKey.database_row, row);

  cellValues.forEach(([id, fieldType, data]) => {
    const cell = new Y.Map();

    cell.set(YjsDatabaseKey.field_type, fieldType);
    cell.set(YjsDatabaseKey.data, data);
    cells.set(id, cell);
  });

  return rowDoc;
}

function addSelectGroup(view: YDatabaseView): YDatabaseGroupColumns {
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;

  group.set(YjsDatabaseKey.id, 'group-id');
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  view.get(YjsDatabaseKey.groups).push([group]);
  return columns;
}

function getCellData(rowDoc: YDoc): unknown {
  const row = rowDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId)?.get(YjsDatabaseKey.data);
}

function getSelectOptions(field: YDatabaseField): Array<{ id: string; name: string }> {
  const content = field
    .get(YjsDatabaseKey.type_option)
    .get(String(FieldType.SingleSelect))
    .get(YjsDatabaseKey.content);

  return (JSON.parse(content) as { options: Array<{ id: string; name: string }> }).options;
}

function dispatchUndo(target: HTMLElement) {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };

  fireEvent.keyDown(target, {
    bubbles: true,
    cancelable: true,
    code: 'KeyZ',
    key: 'z',
    keyCode: 90,
    which: 90,
    ...modifier,
  });
}

function renderWithDatabase(
  children: ReactNode,
  fixture: Fixture,
  rowDoc: YDoc,
  overrides: Partial<DatabaseContextState> = {}
) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
    ...overrides,
  };

  return render(
    <AFConfigContext.Provider
      value={{
        currentUser: {
          avatar: null,
          email: 'test@appflowy.io',
          latestWorkspaceId: 'workspace-id',
          name: 'Test User',
          uid: 'user-id',
          uuid: 'user-uuid',
        },
        isAuthenticated: true,
        openLoginModal: jest.fn(),
        updateCurrentUser: jest.fn().mockResolvedValue(undefined),
      }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

describe('database cell component history wiring', () => {
  it('routes undo to database history after creating a select option from an empty search input', async () => {
    const selectField = createSelectField();
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view);
    const rowDoc = createRowDoc();

    renderWithDatabase(
      <DatabaseHistoryScope>
        <SelectOptionCellMenu
          fieldId={fieldId}
          onOpenChange={jest.fn()}
          open
          rowId={rowId}
          selectOptionIds={[]}
        />
      </DatabaseHistoryScope>,
      fixture,
      rowDoc
    );

    const searchInput = screen.getByRole('textbox');

    fireEvent.pointerDown(searchInput);
    expect(searchInput.getAttribute('data-database-history-hotkeys')).toBe('true');

    fireEvent.change(searchInput, { target: { value: 'Keyboard option' } });
    expect(searchInput.hasAttribute('data-database-history-hotkeys')).toBe(false);
    fireEvent.click(await screen.findByText('button.create'));

    await waitFor(() => {
      expect(getSelectOptions(selectField).map(({ id }) => id)).toEqual(['Keyboard option']);
      expect(columns.toJSON().map(({ id }) => id)).toEqual(['Keyboard option']);
      expect(getCellData(rowDoc)).toBe('Keyboard option');
      expect(searchInput.getAttribute('data-database-history-hotkeys')).toBe('true');
    });

    dispatchUndo(searchInput);

    await waitFor(() => {
      expect(getSelectOptions(selectField)).toEqual([]);
      expect(columns.toJSON()).toEqual([]);
      expect(getCellData(rowDoc)).toBeUndefined();
    });
  });

  it('creates and selects a new option as one undoable menu action', async () => {
    const selectField = createSelectField();
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view);
    const rowDoc = createRowDoc();

    renderWithDatabase(
      <SelectOptionCellMenu
        fieldId={fieldId}
        onOpenChange={jest.fn()}
        open
        rowId={rowId}
        selectOptionIds={[]}
      />,
      fixture,
      rowDoc
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cell option' } });
    fireEvent.click(await screen.findByText('button.create'));

    await waitFor(() => {
      expect(getSelectOptions(selectField).map(({ id }) => id)).toEqual(['Cell option']);
      expect(columns.toJSON().map(({ id }) => id)).toEqual(['Cell option']);
      expect(getCellData(rowDoc)).toBe('Cell option');
    });

    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(history.canUndo()).toBe(true);
    act(() => {
      history.undo();
    });
    expect(getSelectOptions(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    expect(getCellData(rowDoc)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    act(() => {
      history.redo();
    });
    expect(getSelectOptions(selectField).map(({ id }) => id)).toEqual(['Cell option']);
    expect(columns.toJSON().map(({ id }) => id)).toEqual(['Cell option']);
    expect(getCellData(rowDoc)).toBe('Cell option');
  });

  it.each([
    { fieldType: FieldType.Summary, label: 'Summary', result: 'Generated summary' },
    { fieldType: FieldType.Translate, label: 'Translate', result: 'Generated translation' },
  ])('$label generation skips history and preserves an existing redo action', async ({ fieldType, result }) => {
    const sourceField = createField(sourceFieldId, 'Source', FieldType.RichText);
    const generatedField = createField(fieldId, 'Generated', fieldType);
    const fixture = createFixture([
      [sourceFieldId, sourceField],
      [fieldId, generatedField],
    ]);
    const rowDoc = createRowDoc([[sourceFieldId, FieldType.RichText, 'Source value']]);
    const generateAISummaryForRow = jest.fn().mockResolvedValue(result);
    const generateAITranslateForRow = jest.fn().mockResolvedValue(result);
    const setLoading = jest.fn();
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    runDatabaseAction(fixture.databaseDoc, { type: 'database.test-marker' }, () => {
      (fixture.database as Y.Map<unknown>).set('history-marker', true);
    });
    history.undo();
    expect(history.canRedo()).toBe(true);

    renderWithDatabase(
      <AITextCellActions
        fieldId={fieldId}
        loading={false}
        rowId={rowId}
        setLoading={setLoading}
      />,
      fixture,
      rowDoc,
      { generateAISummaryForRow, generateAITranslateForRow }
    );

    fireEvent.click(screen.getByTestId(`ai-generate-button-${rowId}-${fieldId}`));

    await waitFor(() => {
      expect(getCellData(rowDoc)).toBe(result);
      expect(setLoading).toHaveBeenLastCalledWith(false);
    });

    if (fieldType === FieldType.Summary) {
      expect(generateAISummaryForRow).toHaveBeenCalledWith({
        Content: {
          Generated: '',
          Source: 'Source value',
        },
      });
      expect(generateAITranslateForRow).not.toHaveBeenCalled();
    } else {
      expect(generateAITranslateForRow).toHaveBeenCalledWith({
        cells: [
          { content: 'Source value', title: 'Source' },
          { content: '', title: 'Generated' },
        ],
        include_header: false,
        language: 'English',
      });
      expect(generateAISummaryForRow).not.toHaveBeenCalled();
    }

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    act(() => {
      history.redo();
    });
    expect((fixture.database as Y.Map<unknown>).get('history-marker')).toBe(true);
    expect(getCellData(rowDoc)).toBe(result);
  });
});
