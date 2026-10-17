import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, FieldType, SelectOptionColor } from '@/application/database-yjs';
import type { DatabaseContextState } from '@/application/database-yjs';
import { createCell, createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { resolveBoardGroupVisibilityRows } from '@/application/database-yjs/board-grouping';
import type { BoardGroupVisibilityRow } from '@/application/database-yjs/board-grouping';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetBoardColumnRenderedDispatch,
  useToggleHideEmptyGroups,
  useToggleHideUnGrouped,
} from '@/application/database-yjs/dispatch';
import { createYDatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { DatabaseViewLayout, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import type {
  YDatabase,
  YDatabaseField,
  YDatabaseFieldOrders,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YDatabaseFilters,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseLayoutSettings,
  YDatabaseRowOrders,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YMapFieldTypeOption,
} from '@/application/types';
import BoardSettingGroup from '@/components/database/components/settings/BoardSettingGroup';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';
import type { DatabaseSettingGroupProps } from '@/components/database/components/settings/GridSettingGroup';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import type { ComponentProps } from 'react';

// Contract tests record the props Board hands the shared menu; the integration
// tests flip this on to render the real menu around those props.
let mockRenderRealMenu = false;

jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useClearGroupByFieldDispatch: jest.fn(),
  useGroupByFieldDispatch: jest.fn(),
  useSetBoardColumnRenderedDispatch: jest.fn(),
  useToggleHideEmptyGroups: jest.fn(),
  useToggleHideUnGrouped: jest.fn(),
}));

jest.mock('@/components/database/components/settings/GridSettingGroup', () => {
  const actual = jest.requireActual<typeof import('@/components/database/components/settings/GridSettingGroup')>(
    '@/components/database/components/settings/GridSettingGroup'
  );
  const ActualDatabaseSettingGroup = actual.DatabaseSettingGroup;

  return {
    ...actual,
    DatabaseSettingGroup: jest.fn((props: DatabaseSettingGroupProps) =>
      mockRenderRealMenu ? <ActualDatabaseSettingGroup {...props} /> : null
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key),
  }),
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, ...props }: ComponentProps<'input'>) => (
    <input {...props} checked={checked} readOnly type='checkbox' />
  ),
}));

type BoardMenuProps = DatabaseSettingGroupProps & { grouping: { groups: BoardGroupVisibilityRow[] } };

const mockDatabaseSettingGroup = DatabaseSettingGroup as unknown as jest.Mock<unknown, [BoardMenuProps]>;
const mockUseSetBoardColumnRenderedDispatch = useSetBoardColumnRenderedDispatch as jest.MockedFunction<
  typeof useSetBoardColumnRenderedDispatch
>;
const mockUseToggleHideEmptyGroups = useToggleHideEmptyGroups as jest.MockedFunction<typeof useToggleHideEmptyGroups>;
const mockUseGroupByFieldDispatch = useGroupByFieldDispatch as jest.MockedFunction<typeof useGroupByFieldDispatch>;
const mockUseClearGroupByFieldDispatch = useClearGroupByFieldDispatch as jest.MockedFunction<
  typeof useClearGroupByFieldDispatch
>;
const mockUseToggleHideUnGrouped = useToggleHideUnGrouped as jest.MockedFunction<typeof useToggleHideUnGrouped>;

const VIEW_ID = 'board-view';
const GROUP_ID = 'board-group';
const STATUS_FIELD_ID = 'status';
const TITLE_FIELD_ID = 'title';
const CHECKBOX_FIELD_ID = 'checkbox';
const STATUS_OPTIONS = [
  { color: SelectOptionColor.OptionColor1, id: 'todo', name: 'To do' },
  { color: SelectOptionColor.OptionColor2, id: 'done', name: 'Done' },
  { color: SelectOptionColor.OptionColor3, id: 'empty', name: 'Empty' },
];

let fixtureCount = 0;

function createYField(id: string, name: string, type: FieldType, typeOptionContent?: unknown) {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, type);
  if (typeOptionContent !== undefined) {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    typeOption.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
    typeOptions.set(String(type), typeOption);
    field.set(YjsDatabaseKey.type_option, typeOptions);
  }

  return field;
}

/**
 * A Board grouped by Status with the persisted columns
 * No Status (empty) / To do (1 row) / Done (1 row, explicitly hidden) / Empty (0 rows).
 */
function createBoardFixture({
  hideEmptyGroups = true,
  missingRowDocs = [] as string[],
  shownEmptyGroupIds = [] as string[],
} = {}) {
  // The background row loader shares one store per database id, so every
  // fixture gets its own id to keep cached row docs from leaking between tests.
  const databaseId = `board-group-settings-database-${++fixtureCount}`;
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>() as YDatabaseFieldOrders;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const filters = new Y.Array() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;
  const groups = new Y.Array<YDatabaseGroup>() as YDatabaseGroups;
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const boardLayoutSetting = new Y.Map();

  fields.set(STATUS_FIELD_ID, createYField(STATUS_FIELD_ID, 'Status', FieldType.SingleSelect, {
    disable_color: false,
    options: STATUS_OPTIONS,
  }));
  fields.set(TITLE_FIELD_ID, createYField(TITLE_FIELD_ID, 'Title', FieldType.RichText));
  fields.set(CHECKBOX_FIELD_ID, createYField(CHECKBOX_FIELD_ID, 'Checkbox', FieldType.Checkbox));
  fieldOrders.push([{ id: STATUS_FIELD_ID }, { id: TITLE_FIELD_ID }, { id: CHECKBOX_FIELD_ID }]);

  columns.push([
    createYDatabaseGroupColumn({ id: STATUS_FIELD_ID }),
    createYDatabaseGroupColumn({ id: 'todo' }),
    createYDatabaseGroupColumn({ id: 'done', visible: false }),
    createYDatabaseGroupColumn({ id: 'empty' }),
  ]);
  group.set(YjsDatabaseKey.id, GROUP_ID);
  group.set(YjsDatabaseKey.field_id, STATUS_FIELD_ID);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.content, '');
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  boardLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, hideEmptyGroups);
  boardLayoutSetting.set(YjsDatabaseKey.shown_empty_group_ids, shownEmptyGroupIds);
  layoutSettings.set('1', boardLayoutSetting);

  rowOrders.push([
    { height: 36, id: 'row-a' },
    { height: 36, id: 'row-b' },
  ]);
  view.set(YjsDatabaseKey.id, VIEW_ID);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(VIEW_ID, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowDocs: Record<string, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, { [STATUS_FIELD_ID]: createCell(FieldType.SingleSelect, 'todo') }),
    'row-b': createRowDoc('row-b', databaseId, { [STATUS_FIELD_ID]: createCell(FieldType.SingleSelect, 'done') }),
  };
  const rowMap = Object.fromEntries(Object.entries(rowDocs).filter(([rowId]) => !missingRowDocs.includes(rowId)));
  const contextValue: DatabaseContextState = {
    activeViewId: VIEW_ID,
    blobPrefetchComplete: true,
    databaseDoc,
    databasePageId: databaseId,
    readOnly: false,
    rowMap,
    seedsReady: true,
    workspaceId: 'workspace-id',
  };

  return {
    contextValue,
    destroy: () => {
      databaseDoc.destroy();
      Object.values(rowDocs).forEach((rowDoc) => rowDoc.destroy());
    },
  };
}

function lastMenuProps(): BoardMenuProps {
  const { calls } = mockDatabaseSettingGroup.mock;

  return calls[calls.length - 1][0];
}

function renderBoardSettingGroup(contextValue: DatabaseContextState) {
  return render(
    <DatabaseContext.Provider value={contextValue}>
      <BoardSettingGroup />
    </DatabaseContext.Provider>
  );
}

async function waitForGroups(visible: boolean[]) {
  await waitFor(() => {
    expect(lastMenuProps().grouping.groups.map((group) => group.visible)).toEqual(visible);
  });
}

const setColumnRendered = jest.fn();
const toggleHideEmpty = jest.fn();
const groupBy = jest.fn();
const clearGrouping = jest.fn();
const toggleHideUnGrouped = jest.fn();

beforeEach(() => {
  mockDatabaseSettingGroup.mockClear();
  [setColumnRendered, toggleHideEmpty, groupBy, clearGrouping, toggleHideUnGrouped].forEach((fn) => fn.mockClear());
  mockUseSetBoardColumnRenderedDispatch.mockReset().mockReturnValue(setColumnRendered);
  mockUseToggleHideEmptyGroups.mockReset().mockReturnValue(toggleHideEmpty);
  mockUseGroupByFieldDispatch.mockReset().mockReturnValue(groupBy);
  mockUseClearGroupByFieldDispatch.mockReset().mockReturnValue(clearGrouping);
  mockUseToggleHideUnGrouped.mockReset().mockReturnValue(toggleHideUnGrouped);
});

describe('BoardSettingGroup', () => {
  it('hands the shared menu the Board contract without the removed ungrouped switch', async () => {
    const fixture = createBoardFixture();
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitForGroups([false, true, false, false]);

    const props = lastMenuProps();

    expect(props.layout).toBe(DatabaseViewLayout.Board);
    expect(props.testIdPrefix).toBe('board');
    expect(props.groupByFieldTestId?.(STATUS_FIELD_ID)).toBe('board-group-by-field');
    expect(props.groupByFieldTestId?.(CHECKBOX_FIELD_ID)).toBe('board-group-by-field');
    expect(props.groupBy).toBe(groupBy);
    expect(props.clearGrouping).toBe(clearGrouping);
    expect(props.toggleHideEmpty).toBe(toggleHideEmpty);
    expect(props.updateDateCondition).toBeUndefined();
    expect(props.updateNumberConfiguration).toBeUndefined();
    // Only select and checkbox fields can group the web Board.
    expect(props.properties.map((property) => property.id)).toEqual([STATUS_FIELD_ID, CHECKBOX_FIELD_ID]);
    expect(props.grouping).toMatchObject({
      fieldId: STATUS_FIELD_ID,
      fieldName: 'Status',
      fieldType: FieldType.SingleSelect,
      hideEmptyGroups: true,
      isGrouped: true,
    });
    expect(mockUseSetBoardColumnRenderedDispatch).toHaveBeenLastCalledWith(GROUP_ID, STATUS_FIELD_ID);
    // The "Show ungrouped items" row is gone; the default column is a Groups row instead.
    expect(mockUseToggleHideUnGrouped).not.toHaveBeenCalled();
    expect(toggleHideUnGrouped).not.toHaveBeenCalled();

    unmount();
    fixture.destroy();
  });

  it('lists every persisted column with the eye reflecting the rendered Board columns', async () => {
    const fixture = createBoardFixture();
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitForGroups([false, true, false, false]);

    const { groups } = lastMenuProps().grouping;

    expect(groups.map((group) => group.id)).toEqual([STATUS_FIELD_ID, 'todo', 'done', 'empty']);
    expect(groups.map((group) => group.label)).toEqual(['No Status', 'To do', 'Done', 'Empty']);
    expect(groups.map((group) => group.isDefault)).toEqual([true, false, false, false]);
    expect(groups.map((group) => group.option)).toEqual([undefined, ...STATUS_OPTIONS]);
    expect(groups.map((group) => group.rows.length)).toEqual([0, 1, 1, 0]);

    unmount();
    fixture.destroy();
  });

  it('shows an explicitly revealed empty column as rendered while hide empty groups is on', async () => {
    const fixture = createBoardFixture({ shownEmptyGroupIds: ['empty'] });
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitForGroups([false, true, false, true]);

    unmount();
    fixture.destroy();
  });

  it('lists empty columns as rendered once hide empty groups is off', async () => {
    const fixture = createBoardFixture({ hideEmptyGroups: false });
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitForGroups([true, true, false, true]);
    expect(lastMenuProps().grouping.hideEmptyGroups).toBe(false);

    act(() => lastMenuProps().setVisibility('empty', false));
    expect(setColumnRendered).toHaveBeenLastCalledWith('empty', false, false);

    unmount();
    fixture.destroy();
  });

  it('toggles columns through the render override with the auto-hidden flag', async () => {
    const fixture = createBoardFixture();
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitForGroups([false, true, false, false]);

    act(() => lastMenuProps().setVisibility('empty', true));
    expect(setColumnRendered).toHaveBeenLastCalledWith('empty', true, true);

    act(() => lastMenuProps().setVisibility(STATUS_FIELD_ID, true));
    expect(setColumnRendered).toHaveBeenLastCalledWith(STATUS_FIELD_ID, true, true);

    act(() => lastMenuProps().setVisibility('todo', false));
    expect(setColumnRendered).toHaveBeenLastCalledWith('todo', false, false);

    act(() => lastMenuProps().setVisibility('done', true));
    expect(setColumnRendered).toHaveBeenLastCalledWith('done', true, false);

    unmount();
    fixture.destroy();
  });

  it('falls back to the persisted visibility flags until the Board rows hydrate', async () => {
    // The background loader falls back to IndexedDB for the missing row doc, which jsdom lacks.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = createBoardFixture({ missingRowDocs: ['row-b'] });
    const { unmount } = renderBoardSettingGroup(fixture.contextValue);

    await waitFor(() => expect(lastMenuProps().grouping.groups).toHaveLength(4));
    await act(async () => {
      await Promise.resolve();
    });

    expect(lastMenuProps().grouping.groups.map((group) => group.visible)).toEqual([true, true, false, true]);

    act(() => lastMenuProps().setVisibility('empty', true));
    expect(setColumnRendered).toHaveBeenLastCalledWith('empty', true, false);

    unmount();
    fixture.destroy();
    warn.mockRestore();
  });
});

describe('BoardSettingGroup inside the shared menu', () => {
  beforeEach(() => {
    mockRenderRealMenu = true;
  });

  afterEach(() => {
    mockRenderRealMenu = false;
  });

  async function openBoardGroupMenu(contextValue: DatabaseContextState) {
    const rendered = render(
      <DatabaseContext.Provider value={contextValue}>
        <DropdownMenu>
          <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
          <DropdownMenuContent>
            <BoardSettingGroup />
          </DropdownMenuContent>
        </DropdownMenu>
      </DatabaseContext.Provider>
    );
    const settingsTrigger = screen.getByRole('button', { name: 'Settings' });

    settingsTrigger.focus();
    fireEvent.keyDown(settingsTrigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByTestId('board-group-settings-trigger'));

    return { ...rendered, menu: await screen.findByTestId('board-group-settings-menu') };
  }

  it('renders the desktop Board menu: eye rows for every column, no None, no Delete grouping, no ungrouped switch', async () => {
    const fixture = createBoardFixture();
    const { menu, unmount } = await openBoardGroupMenu(fixture.contextValue);

    await waitFor(() => expect(screen.getByTestId('board-group-visibility-shown-todo')).toBeTruthy());

    expect(screen.getByTestId('board-group-settings-field').textContent).toBe('Status');
    expect(within(menu).queryByRole('menuitem', { name: 'None' })).toBeNull();
    expect(within(menu).queryByText('Delete grouping')).toBeNull();
    expect(screen.queryByTestId('board-remove-grouping')).toBeNull();
    expect(within(menu).queryByText(/ungrouped/i)).toBeNull();
    expect(screen.getByTestId('board-hide-empty-groups-toggle').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId<HTMLInputElement>('board-hide-empty-groups-switch').checked).toBe(true);

    const rows = within(menu)
      .getAllByRole('menuitemcheckbox')
      .filter((row) => row.getAttribute('data-testid')?.startsWith('board-group-visibility-'));

    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'board-group-visibility-status',
      'board-group-visibility-todo',
      'board-group-visibility-done',
      'board-group-visibility-empty',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    expect(screen.getByTestId('board-group-visibility-status').textContent).toContain('No Status');
    expect(screen.getByTestId('board-group-visibility-hidden-status')).toBeTruthy();
    expect(screen.getByTestId('board-group-visibility-option-tag-todo')).toBeTruthy();
    expect(screen.getByTestId('board-group-visibility-hidden-done')).toBeTruthy();
    expect(screen.getByTestId('board-group-visibility-hidden-empty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('board-group-visibility-empty'));
    expect(setColumnRendered).toHaveBeenLastCalledWith('empty', true, true);
    fireEvent.click(screen.getByTestId('board-group-visibility-todo'));
    expect(setColumnRendered).toHaveBeenLastCalledWith('todo', false, false);
    fireEvent.click(screen.getByTestId('board-hide-empty-groups-toggle'));
    expect(toggleHideEmpty).toHaveBeenLastCalledWith(false);

    unmount();
    fixture.destroy();
  });

  it('keeps the constant Board field ids inside the nested Group by submenu, limited to select and checkbox fields', async () => {
    const fixture = createBoardFixture();
    const { unmount } = await openBoardGroupMenu(fixture.contextValue);

    expect(screen.getByTestId('board-group-by-current-field').textContent).toBe('Status');
    fireEvent.click(screen.getByTestId('board-group-by-trigger'));

    const groupByMenu = await screen.findByTestId('board-group-by-menu');
    const fieldRows = within(groupByMenu).getAllByTestId('board-group-by-field');

    expect(within(groupByMenu).queryByTestId('board-group-by-none')).toBeNull();
    expect(fieldRows).toHaveLength(2);
    expect(within(groupByMenu).getAllByTestId('board-group-by-field-name').map((name) => name.textContent)).toEqual([
      'Status',
      'Checkbox',
    ]);
    expect(within(groupByMenu).getAllByTestId('board-group-by-field-selected')).toHaveLength(1);
    expect(within(fieldRows[0]).getByTestId('board-group-by-field-selected')).toBeTruthy();

    fireEvent.click(fieldRows[1]);
    expect(groupBy).toHaveBeenLastCalledWith(CHECKBOX_FIELD_ID);

    unmount();
    fixture.destroy();
  });
});

describe('resolveBoardGroupVisibilityRows', () => {
  it('names checkbox columns by their group id like desktop and carries no option tag', () => {
    const field = createField('checkbox', FieldType.Checkbox);
    const rows = resolveBoardGroupVisibilityRows({
      columns: [
        { id: 'Yes', visible: true, visibleExplicit: false },
        { id: 'No', visible: true, visibleExplicit: false },
      ],
      field,
      fieldId: 'checkbox',
      getRows: (columnId) => (columnId === 'Yes' ? [{ height: 36, id: 'row-a' }] : []),
      renderedColumnIds: new Set(['Yes']),
    });

    expect(rows).toEqual([
      { id: 'Yes', isDefault: false, label: 'Yes', option: undefined, rows: [{ height: 36, id: 'row-a' }], visible: true },
      { id: 'No', isDefault: false, label: 'No', option: undefined, rows: [], visible: false },
    ]);
  });

  it('keeps hidden and empty select columns in persisted order with the default group first', () => {
    const field = createField('status', FieldType.SingleSelect, { disable_color: false, options: STATUS_OPTIONS });
    const rows = resolveBoardGroupVisibilityRows({
      columns: [
        { id: 'empty', visible: true, visibleExplicit: true },
        { id: 'status', visible: true, visibleExplicit: false },
        { id: 'done', visible: false, visibleExplicit: true },
      ],
      field,
      fieldId: 'status',
      getRows: () => [],
      renderedColumnIds: new Set(['status']),
    });

    expect(rows.map((row) => [row.id, row.label, row.isDefault, row.visible])).toEqual([
      ['empty', 'Empty', false, false],
      ['status', 'No status', true, true],
      ['done', 'Done', false, false],
    ]);
    expect(rows[0].option).toEqual(STATUS_OPTIONS[2]);
    expect(rows[1].option).toBeUndefined();
  });

  it('lists nothing without a grouping field', () => {
    expect(
      resolveBoardGroupVisibilityRows({
        columns: [{ id: 'todo', visible: true, visibleExplicit: false }],
        field: undefined,
        fieldId: 'status',
        getRows: () => [],
        renderedColumnIds: new Set(['todo']),
      })
    ).toEqual([]);
  });
});
