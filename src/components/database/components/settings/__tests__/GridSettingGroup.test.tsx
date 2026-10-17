import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DateGroupCondition, FieldType, SelectOptionColor } from '@/application/database-yjs';
import type { DatabaseContextState, GridGroup } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { createYDatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { defaultNumberGroupConfiguration, NumberGroupMode } from '@/application/database-yjs/number-grouping';
import { DatabaseViewLayout, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import type {
  YDatabase,
  YDatabaseField,
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
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import {
  DatabaseSettingGroup,
  type DatabaseSettingGroupProps,
  type DatabaseSettingGroupVisibilityGroup,
  GRID_GROUP_VISIBILITY_LIMIT,
  GridGroupVisibilityList,
  getDatabaseGroupVisibilityGroups,
} from '@/components/database/components/settings/GridSettingGroup';
import { GridGroupingProvider, useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import type { ComponentProps } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);

      return Object.entries(typeof fallback === 'object' && fallback ? fallback : {}).reduce(
        (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
        template
      );
    },
  }),
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, ...props }: ComponentProps<'input'>) => (
    <input {...props} checked={checked} readOnly type='checkbox' />
  ),
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const FIELD_ID = 'status';
const OPTION_ID = 'todo';
const TODO_OPTION = { color: SelectOptionColor.OptionColor4, id: OPTION_ID, name: 'To do' };
const UNGROUPED: DatabaseSettingGroupProps['grouping'] = { groups: [], hideEmptyGroups: true, isGrouped: false };

function createGroup(index: number): GridGroup {
  return {
    automaticallyHidden: false,
    collapsed: false,
    hidden: index % 2 === 0,
    id: `group-${index}`,
    isDefault: false,
    label: `Group ${index}`,
    rows: [],
    visible: index % 2 !== 0,
  };
}

function createVisibilityGroup(
  id: string,
  overrides: Partial<DatabaseSettingGroupVisibilityGroup> = {}
): DatabaseSettingGroupVisibilityGroup {
  return { id, isDefault: false, label: id, rows: [], visible: true, ...overrides };
}

function createFixture({
  fieldName = 'Status',
  fieldType = FieldType.SingleSelect,
}: {
  fieldName?: string;
  fieldType?: FieldType;
} = {}) {
  const databaseId = 'grid-group-settings-database';
  const viewId = 'grid-view';
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const selectTypeOption = new Y.Map() as YMapFieldTypeOption;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const filters = new Y.Array() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;
  const groups = new Y.Array<YDatabaseGroup>() as YDatabaseGroups;
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
  const gridLayoutSetting = new Y.Map();
  const isSelect = fieldType === FieldType.SingleSelect;
  const setOptionColor = (color: SelectOptionColor) => {
    selectTypeOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [{ color, id: OPTION_ID, name: 'To do' }],
      })
    );
  };

  field.set(YjsDatabaseKey.id, FIELD_ID);
  field.set(YjsDatabaseKey.name, fieldName);
  field.set(YjsDatabaseKey.type, fieldType);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  if (isSelect) {
    typeOptions.set(String(FieldType.SingleSelect), selectTypeOption);
    setOptionColor(SelectOptionColor.OptionColor1);
  }

  fields.set(FIELD_ID, field);

  columns.push([createYDatabaseGroupColumn({ id: FIELD_ID })]);
  if (isSelect) columns.push([createYDatabaseGroupColumn({ id: OPTION_ID })]);
  group.set(YjsDatabaseKey.id, 'group-config');
  group.set(YjsDatabaseKey.field_id, FIELD_ID);
  group.set(YjsDatabaseKey.type, fieldType);
  group.set(
    YjsDatabaseKey.content,
    fieldType === FieldType.DateTime ? JSON.stringify({ condition: DateGroupCondition.Day, hide_empty: false }) : ''
  );
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  rowOrders.push([{ height: 36, id: 'row-a' }]);
  gridLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, true);
  layoutSettings.set('0', gridLayoutSetting);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc('row-a', databaseId, {
    [FIELD_ID]: createCell(fieldType, isSelect ? OPTION_ID : '1705312800'),
  });
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    blobPrefetchComplete: true,
    databaseDoc,
    databasePageId: databaseId,
    readOnly: true,
    rowMap: { 'row-a': rowDoc },
    seedsReady: true,
    workspaceId: 'workspace-id',
  };
  const destroy = () => {
    rowDoc.destroy();
    databaseDoc.destroy();
  };

  return { contextValue, destroy, setOptionColor };
}

function SettingGroupMenu(props: Partial<DatabaseSettingGroupProps>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DatabaseSettingGroup
          clearGrouping={jest.fn()}
          groupBy={jest.fn()}
          grouping={UNGROUPED}
          layout={DatabaseViewLayout.Grid}
          properties={[]}
          setVisibility={jest.fn()}
          testIdPrefix='grid'
          toggleHideEmpty={jest.fn()}
          updateDateCondition={jest.fn()}
          updateNumberConfiguration={jest.fn()}
          {...props}
        />
        <DropdownMenuItem>Other setting</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderSettingGroup(contextValue: DatabaseContextState, props: Partial<DatabaseSettingGroupProps>) {
  return render(
    <DatabaseContext.Provider value={contextValue}>
      <SettingGroupMenu {...props} />
    </DatabaseContext.Provider>
  );
}

async function openSettingGroup(prefix = 'grid') {
  const settingsTrigger = screen.getByRole('button', { name: 'Settings' });

  settingsTrigger.focus();
  fireEvent.keyDown(settingsTrigger, { key: 'ArrowDown' });
  const groupTrigger = await screen.findByTestId(`${prefix}-group-settings-trigger`);

  fireEvent.click(groupTrigger);
  const menu = await screen.findByTestId(`${prefix}-group-settings-menu`);

  return { groupTrigger, menu };
}

async function openGroupBySubmenu(prefix = 'grid') {
  fireEvent.click(screen.getByTestId(`${prefix}-group-by-trigger`));

  return screen.findByTestId(`${prefix}-group-by-menu`);
}

function expectDomOrder(elements: Element[]) {
  elements.slice(1).forEach((element, index) => {
    expect(elements[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
}

function hasTick(element: HTMLElement) {
  return element.querySelector('[data-slot="dropdown-menu-tick"]') !== null;
}

function VisibilityMenu({
  groups,
  setVisibility = jest.fn(),
  testIdPrefix,
}: {
  groups: DatabaseSettingGroupVisibilityGroup[];
  setVisibility?: (groupId: string, visible: boolean) => void;
  testIdPrefix?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open group visibility</DropdownMenuTrigger>
      <DropdownMenuContent>
        <GridGroupVisibilityList groups={groups} setVisibility={setVisibility} testIdPrefix={testIdPrefix} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveVisibilityMenu({ groupId }: { groupId: string }) {
  const grouping = useGridGrouping();

  return <VisibilityMenu groups={grouping.groups.filter((group) => group.id === groupId)} />;
}

async function openMenuWithKeyboard() {
  const trigger = screen.getByRole('button', { name: 'Open group visibility' });

  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}

describe('DatabaseSettingGroup submenu', () => {
  it('keeps the numeric draft and validation visible when the pointer enters its portaled editor', async () => {
    const fixture = createFixture();
    const updateNumberConfiguration = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      grouping: {
        content: JSON.stringify(defaultNumberGroupConfiguration(NumberGroupMode.Range)),
        fieldId: FIELD_ID,
        fieldName: 'Amount',
        fieldType: FieldType.Number,
        groups: [],
        hideEmptyGroups: true,
        isGrouped: true,
      },
      updateNumberConfiguration,
    });
    const { groupTrigger } = await openSettingGroup();
    const interval = await screen.findByRole('textbox', { name: 'Interval' });

    fireEvent.change(interval, { target: { value: '0' } });
    const apply = screen.getByRole('button', { name: 'Apply' });
    // A direct pointer transition can miss Radix's geometric hover grace area.
    const pointerOut = new MouseEvent('pointerout', { bubbles: true, relatedTarget: apply, clientX: 100, clientY: 100 });

    Object.defineProperty(pointerOut, 'pointerType', { value: 'mouse' });
    fireEvent(groupTrigger, pointerOut);
    await waitFor(() => expect(screen.getByTestId('grid-group-settings-menu')).toBeTruthy());
    fireEvent.click(apply);
    expect(screen.getByRole('alert').textContent).not.toBe('');
    expect(screen.getByRole('textbox', { name: 'Interval' }).value).toBe('0');
    expect(updateNumberConfiguration).not.toHaveBeenCalled();

    const otherSetting = screen.getByRole('menuitem', { name: 'Other setting' });

    act(() => otherSetting.focus());
    await waitFor(() => expect(screen.queryByTestId('grid-group-settings-menu')).toBeNull());
    expect(screen.getByRole('menuitem', { name: 'Other setting' })).toBeTruthy();
    fireEvent.keyDown(otherSetting, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    unmount();
    fixture.destroy();
  });

  it('lists Group by, a ticked None and the groupable fields while ungrouped, without grouped sections', async () => {
    const fixture = createFixture();
    const groupBy = jest.fn();
    const clearGrouping = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      clearGrouping,
      groupBy,
      properties: [{ id: FIELD_ID, type: FieldType.SingleSelect }],
    });
    const { groupTrigger, menu } = await openSettingGroup();

    expect(within(groupTrigger).queryByTestId('grid-group-settings-field')).toBeNull();
    expect(menu.className).toContain('w-[240px]');
    expect(menu.className).toContain('max-h-[280px]');
    const none = screen.getByTestId('grid-group-by-none');
    const fieldRow = screen.getByTestId(`grid-group-by-field-${FIELD_ID}`);

    expectDomOrder([within(menu).getByText('Group by'), none, fieldRow]);
    expect(hasTick(none)).toBe(true);
    expect(hasTick(fieldRow)).toBe(false);
    expect(within(fieldRow).getByTestId('grid-group-by-field-name').textContent).toBe('Status');
    expect(screen.queryByTestId('grid-group-by-trigger')).toBeNull();
    expect(screen.queryByTestId('grid-hide-empty-groups-toggle')).toBeNull();
    expect(within(menu).queryByText('Groups')).toBeNull();
    expect(screen.queryByTestId('grid-remove-grouping')).toBeNull();

    fireEvent.click(fieldRow);
    expect(groupBy).toHaveBeenCalledWith(FIELD_ID);
    fireEvent.click(none);
    expect(clearGrouping).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('grid-group-settings-menu')).toBeTruthy();
    unmount();
    fixture.destroy();
  });

  it('mirrors the desktop grouped order and nests the Group by list behind the current field', async () => {
    const fixture = createFixture();
    const groupBy = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      groupBy,
      grouping: {
        content: '',
        fieldId: FIELD_ID,
        fieldName: 'Status',
        fieldType: FieldType.SingleSelect,
        groups: [
          createVisibilityGroup(FIELD_ID, { isDefault: true, label: 'No Status', rows: [{}] }),
          createVisibilityGroup(OPTION_ID, { label: 'To do', option: TODO_OPTION, rows: [{}], visible: false }),
        ],
        hideEmptyGroups: true,
        isGrouped: true,
      },
      properties: [{ id: FIELD_ID, type: FieldType.SingleSelect }],
    });
    const { groupTrigger, menu } = await openSettingGroup();
    const trailingField = within(groupTrigger).getByTestId('grid-group-settings-field');

    expect(trailingField.textContent).toBe('Status');
    expect(trailingField.className).toContain('max-w-[80px]');
    expect(trailingField.className).toContain('text-xs');
    expect(trailingField.className).toContain('text-text-secondary');

    const groupByTrigger = screen.getByTestId('grid-group-by-trigger');

    expect(within(groupByTrigger).getByTestId('grid-group-by-current-field').textContent).toBe('Status');
    expectDomOrder([
      groupByTrigger,
      screen.getByTestId('grid-hide-empty-groups-toggle'),
      within(menu).getByText('Groups'),
      screen.getByTestId(`grid-group-visibility-${FIELD_ID}`),
      screen.getByTestId(`grid-group-visibility-${OPTION_ID}`),
      screen.getByTestId('grid-remove-grouping'),
    ]);
    // The inline "Group by" section label moved into the nested submenu.
    expect(within(menu).queryByText('Group by', { selector: '[data-slot="dropdown-menu-label"]' })).toBeNull();
    expect(screen.queryByTestId('grid-group-by-none')).toBeNull();
    expect(screen.queryByTestId('grid-show-all-groups')).toBeNull();
    expect(screen.queryByTestId('grid-hide-all-groups')).toBeNull();
    expect(screen.getByTestId(`grid-group-visibility-shown-${FIELD_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`grid-group-visibility-hidden-${OPTION_ID}`)).toBeTruthy();

    const groupByMenu = await openGroupBySubmenu();

    expect(groupByMenu.className).toContain('w-[240px]');
    expect(groupByMenu.className).toContain('max-h-[280px]');
    const none = within(groupByMenu).getByTestId('grid-group-by-none');
    const fieldRow = within(groupByMenu).getByTestId(`grid-group-by-field-${FIELD_ID}`);

    expectDomOrder([within(groupByMenu).getByText('Group by'), none, fieldRow]);
    expect(hasTick(none)).toBe(false);
    expect(within(fieldRow).getByTestId('grid-group-by-field-selected')).toBeTruthy();
    fireEvent.click(fieldRow);
    expect(groupBy).toHaveBeenCalledWith(FIELD_ID);
    unmount();
    fixture.destroy();
  });

  it('places the Number panel between separators under the Group by selector and widens the menu', async () => {
    const fixture = createFixture();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      grouping: {
        content: JSON.stringify(defaultNumberGroupConfiguration(NumberGroupMode.Range)),
        fieldId: FIELD_ID,
        fieldName: 'Amount',
        fieldType: FieldType.Number,
        groups: [createVisibilityGroup(FIELD_ID, { isDefault: true, label: 'No Number', rows: [{}] })],
        hideEmptyGroups: true,
        isGrouped: true,
      },
    });
    const { menu } = await openSettingGroup();
    const separators = menu.querySelectorAll('[data-slot="dropdown-menu-separator"]');

    expect(menu.className).toContain('max-h-[560px]');
    expect(separators.length).toBe(3);
    expectDomOrder([
      screen.getByTestId('grid-group-by-trigger'),
      separators[0],
      screen.getByTestId('grid-number-group-mode-exact'),
      screen.getByTestId('grid-number-group-sort-descending'),
      separators[1],
      screen.getByTestId('grid-hide-empty-groups-toggle'),
      within(menu).getByText('Groups'),
      screen.getByTestId(`grid-group-visibility-${FIELD_ID}`),
      separators[2],
      screen.getByTestId('grid-remove-grouping'),
    ]);
    unmount();
    fixture.destroy();
  });

  it('hides the Hide empty groups toggle for Checkbox groupings while keeping the Groups rows', async () => {
    const fixture = createFixture();
    const setVisibility = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      grouping: {
        content: '',
        fieldId: FIELD_ID,
        fieldName: 'Done',
        fieldType: FieldType.Checkbox,
        groups: [
          createVisibilityGroup('Yes', { label: 'Yes', rows: [{}] }),
          createVisibilityGroup('No', { label: 'No', rows: [{}], visible: false }),
        ],
        hideEmptyGroups: true,
        isGrouped: true,
      },
      setVisibility,
    });
    const { menu } = await openSettingGroup();

    expect(screen.queryByTestId('grid-hide-empty-groups-toggle')).toBeNull();
    expect(screen.queryByTestId('grid-hide-empty-groups-switch')).toBeNull();
    expect(within(menu).getByText('Groups')).toBeTruthy();
    expectDomOrder([screen.getByTestId('grid-group-visibility-Yes'), screen.getByTestId('grid-group-visibility-No')]);
    fireEvent.click(screen.getByTestId('grid-group-visibility-No'));
    expect(setVisibility).toHaveBeenCalledWith('No', true);
    expect(screen.getByTestId('grid-group-settings-menu')).toBeTruthy();
    unmount();
    fixture.destroy();
  });

  it('renders date conditions after the Groups rows with the field icon and dismisses the menu on select', async () => {
    const fixture = createFixture({ fieldName: 'Due', fieldType: FieldType.DateTime });
    const updateDateCondition = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      grouping: {
        content: JSON.stringify({ condition: DateGroupCondition.Day, hide_empty: false }),
        fieldId: FIELD_ID,
        fieldName: 'Due',
        fieldType: FieldType.DateTime,
        groups: [createVisibilityGroup('2024/01/15', { label: 'Jan 15, 2024', rows: [{}] })],
        hideEmptyGroups: true,
        isGrouped: true,
      },
      updateDateCondition,
    });
    const { menu } = await openSettingGroup();
    const conditionRows = [0, 1, 2, 3, 4].map((condition) =>
      screen.getByTestId(`grid-date-group-condition-${condition}`)
    );

    expectDomOrder([
      screen.getByTestId('grid-hide-empty-groups-toggle'),
      within(menu).getByText('Groups'),
      screen.getByTestId('grid-group-visibility-2024/01/15'),
      within(menu).getByText('Group condition'),
      ...conditionRows,
      screen.getByTestId('grid-remove-grouping'),
    ]);
    conditionRows.forEach((row, condition) => {
      expect(within(row).getByTestId('grid-date-group-condition-field-icon').querySelector('svg')).toBeTruthy();
      expect(hasTick(row)).toBe(condition === DateGroupCondition.Day);
    });
    expect(conditionRows.map((row) => row.textContent)).toEqual(['Relative', 'Day', 'Week', 'Month', 'Year']);

    fireEvent.click(conditionRows[DateGroupCondition.Month]);
    expect(updateDateCondition).toHaveBeenCalledWith(DateGroupCondition.Month);
    await waitFor(() => expect(screen.queryByTestId('grid-group-settings-menu')).toBeNull());
    unmount();
    fixture.destroy();
  });

  it('labels Delete grouping with the delete icon, turns error colored only on hover or focus, and clears grouping', async () => {
    const fixture = createFixture();
    const clearGrouping = jest.fn();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      clearGrouping,
      grouping: {
        content: '',
        fieldId: FIELD_ID,
        fieldName: 'Status',
        fieldType: FieldType.SingleSelect,
        groups: [],
        hideEmptyGroups: true,
        isGrouped: true,
      },
    });

    await openSettingGroup();
    const deleteRow = screen.getByTestId('grid-remove-grouping');
    const icon = deleteRow.querySelector('svg');

    expect(deleteRow.textContent).toBe('Delete grouping');
    expect(deleteRow.getAttribute('data-variant')).toBe('default');
    expect(deleteRow.className).toContain('group/delete-grouping');
    expect(deleteRow.className).toContain('hover:text-text-error');
    expect(deleteRow.className).toContain('focus:text-text-error');
    expect(icon?.getAttribute('class')).toContain('text-icon-primary');
    expect(icon?.getAttribute('class')).toContain('group-hover/delete-grouping:text-text-error');
    expect(icon?.getAttribute('class')).toContain('group-focus/delete-grouping:text-text-error');
    fireEvent.click(deleteRow);
    expect(clearGrouping).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('grid-group-settings-menu')).toBeNull());
    unmount();
    fixture.destroy();
  });

  it('hides None and Delete grouping on Board and keeps the constant field test id', async () => {
    const fixture = createFixture();
    const { unmount } = renderSettingGroup(fixture.contextValue, {
      groupByFieldTestId: () => 'board-group-by-field',
      grouping: {
        content: '',
        fieldId: FIELD_ID,
        fieldName: 'Status',
        fieldType: FieldType.SingleSelect,
        groups: [
          createVisibilityGroup(FIELD_ID, { isDefault: true, label: 'No Status', visible: false }),
          createVisibilityGroup(OPTION_ID, { label: 'To do', option: TODO_OPTION, rows: [{}] }),
        ],
        hideEmptyGroups: false,
        isGrouped: true,
      },
      layout: DatabaseViewLayout.Board,
      properties: [{ id: FIELD_ID, type: FieldType.SingleSelect }],
      testIdPrefix: 'board',
    });
    const { menu } = await openSettingGroup('board');

    expect(screen.getByTestId('board-hide-empty-groups-toggle')).toBeTruthy();
    expect(within(menu).getByText('Groups')).toBeTruthy();
    expect(screen.getByTestId(`board-group-visibility-hidden-${FIELD_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`board-group-visibility-shown-${OPTION_ID}`)).toBeTruthy();
    expect(screen.queryByTestId('board-remove-grouping')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete grouping' })).toBeNull();

    const groupByMenu = await openGroupBySubmenu('board');

    expect(within(groupByMenu).queryByTestId('board-group-by-none')).toBeNull();
    expect(within(groupByMenu).queryByRole('menuitem', { name: 'None' })).toBeNull();
    const fieldRow = within(groupByMenu).getByTestId('board-group-by-field');

    expect(within(fieldRow).getByTestId('board-group-by-field-name').textContent).toBe('Status');
    expect(within(fieldRow).getByTestId('board-group-by-field-selected')).toBeTruthy();
    unmount();
    fixture.destroy();
  });
});

describe('getDatabaseGroupVisibilityGroups', () => {
  const populated = { ...createGroup(1), id: 'populated', rows: [{ height: 36, id: 'row-a' }] };
  const hiddenPopulated = { ...createGroup(0), id: 'hidden-populated', rows: [{ height: 36, id: 'row-b' }] };
  const emptyDefault = { ...createGroup(2), id: 'field-id', isDefault: true };
  const emptyOption = { ...createGroup(3), id: 'empty-option' };
  const staleDynamic = { ...createGroup(4), automaticallyHidden: true, id: 'stale', visible: false };

  it('lists only non-empty groups while hiding empty groups, matching the desktop backend', () => {
    const groups = [emptyDefault, populated, hiddenPopulated, emptyOption, staleDynamic];

    expect(getDatabaseGroupVisibilityGroups({ groups, hideEmptyGroups: true }).map((group) => group.id)).toEqual([
      'populated',
      'hidden-populated',
    ]);
  });

  it('lists every real group, empty ones included, while empty groups are shown', () => {
    const groups = [emptyDefault, populated, hiddenPopulated, emptyOption, staleDynamic];

    expect(getDatabaseGroupVisibilityGroups({ groups, hideEmptyGroups: false }).map((group) => group.id)).toEqual([
      'field-id',
      'populated',
      'hidden-populated',
      'empty-option',
    ]);
  });
});

describe('GridGroupVisibilityList', () => {
  it('supports stable List visibility identifiers without changing Grid defaults', async () => {
    render(<VisibilityMenu groups={[createGroup(1)]} testIdPrefix='list' />);
    const trigger = screen.getByRole('button', { name: 'Open group visibility' });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getByTestId('list-group-visibility-group-1')).toBeTruthy());
    expect(screen.getByTestId('list-group-visibility-shown-group-1')).toBeTruthy();
    expect(screen.queryByTestId('grid-group-visibility-group-1')).toBeNull();
  });

  it('renders select-option groups with the same semantic tag colors while retaining checkbox semantics', async () => {
    const optionGroup = createVisibilityGroup(OPTION_ID, { label: 'To do', option: TODO_OPTION });

    render(<VisibilityMenu groups={[optionGroup]} />);
    await openMenuWithKeyboard();

    const item = screen.getByRole('menuitemcheckbox', { name: 'To do' });
    const tag = screen.getByTestId('grid-group-visibility-option-tag-todo');

    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(tag.getAttribute('data-background-color-token')).toBe(SelectOptionColorMap[SelectOptionColor.OptionColor4]);
    expect(tag.getAttribute('data-text-color-token')).toBe(SelectOptionFgColorMap[SelectOptionColor.OptionColor4]);
    expect(screen.getByText('To do').parentElement?.className).toContain('rounded-[6px]');
  });

  it('refreshes a mounted select-option tag when its Yjs color changes', async () => {
    const fixture = createFixture();
    const { unmount } = render(
      <DatabaseContext.Provider value={fixture.contextValue}>
        <GridGroupingProvider>
          <LiveVisibilityMenu groupId={OPTION_ID} />
        </GridGroupingProvider>
      </DatabaseContext.Provider>
    );

    await openMenuWithKeyboard();
    await waitFor(() => {
      expect(
        screen.getByTestId('grid-group-visibility-option-tag-todo').getAttribute('data-background-color-token')
      ).toBe(SelectOptionColorMap[SelectOptionColor.OptionColor1]);
    });

    act(() => fixture.setOptionColor(SelectOptionColor.OptionColor12));

    await waitFor(() => {
      const tag = screen.getByTestId('grid-group-visibility-option-tag-todo');

      expect(tag.getAttribute('data-background-color-token')).toBe(
        SelectOptionColorMap[SelectOptionColor.OptionColor12]
      );
      expect(tag.getAttribute('data-text-color-token')).toBe(SelectOptionFgColorMap[SelectOptionColor.OptionColor12]);
    });

    unmount();
    fixture.destroy();
  });

  it('bounds mounted rows and lets users search groups outside the initial window', async () => {
    const groups = Array.from({ length: 100 }, (_, index) => createGroup(index));

    render(<VisibilityMenu groups={groups} />);
    await openMenuWithKeyboard();

    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(GRID_GROUP_VISIBILITY_LIMIT);
    expect(screen.queryByTestId('grid-group-visibility-group-87')).toBeNull();
    expect(screen.getByTestId('grid-group-visibility-limit').textContent).toContain(
      `Showing ${GRID_GROUP_VISIBILITY_LIMIT} of 100 groups`
    );

    fireEvent.change(screen.getByTestId('grid-group-visibility-search'), { target: { value: 'Group 87' } });

    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(1);
    expect(screen.getByTestId('grid-group-visibility-group-87')).toBeTruthy();
    expect(screen.queryByTestId('grid-group-visibility-group-7')).toBeNull();
  });

  it('reports an empty search without mounting rows', async () => {
    const groups = Array.from({ length: GRID_GROUP_VISIBILITY_LIMIT + 1 }, (_, index) => createGroup(index));

    render(<VisibilityMenu groups={groups} />);
    await openMenuWithKeyboard();
    fireEvent.change(screen.getByTestId('grid-group-visibility-search'), { target: { value: 'missing group' } });

    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
    expect(screen.getByTestId('grid-group-visibility-empty')).toBeTruthy();
  });

  it('does not invisibly apply a stale search when the group list shrinks below the limit', async () => {
    const largeGroups = Array.from({ length: GRID_GROUP_VISIBILITY_LIMIT + 1 }, (_, index) => createGroup(index));
    const smallGroups = largeGroups.slice(0, 3);
    const { rerender } = render(<VisibilityMenu groups={largeGroups} />);

    await openMenuWithKeyboard();
    fireEvent.change(screen.getByTestId('grid-group-visibility-search'), { target: { value: 'missing group' } });
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);

    rerender(<VisibilityMenu groups={smallGroups} />);

    expect(screen.queryByTestId('grid-group-visibility-search')).toBeNull();
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(smallGroups.length);
  });

  it('keeps search and filtered group toggles in the Radix keyboard path', async () => {
    const groups = Array.from({ length: 100 }, (_, index) => createGroup(index));
    const setVisibility = jest.fn();

    render(<VisibilityMenu groups={groups} setVisibility={setVisibility} />);
    await openMenuWithKeyboard();

    const search = screen.getByRole('searchbox', { name: 'Search groups' });

    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'Group' } });
    (search as HTMLInputElement).setSelectionRange(5, 5);
    fireEvent.keyDown(search, { key: ' ' });
    expect((search as HTMLInputElement).value).toBe('Group ');

    fireEvent.change(search, { target: { value: 'Group 87' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const group = screen.getByRole('menuitemcheckbox', { name: 'Group 87' });

    await waitFor(() => expect(document.activeElement).toBe(group));
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(setVisibility).toHaveBeenCalledWith('group-87', false);
  });

  it('exposes each group toggle as one checked menu item with a decorative eye icon', async () => {
    const setVisibility = jest.fn();

    render(<VisibilityMenu groups={[createGroup(0), createGroup(1)]} setVisibility={setVisibility} />);
    await openMenuWithKeyboard();

    const hiddenGroup = screen.getByRole('menuitemcheckbox', { name: 'Group 0' });
    const visibleGroup = screen.getByRole('menuitemcheckbox', { name: 'Group 1' });
    const hiddenIcon = screen.getByTestId('grid-group-visibility-hidden-group-0');
    const shownIcon = screen.getByTestId('grid-group-visibility-shown-group-1');

    expect(hiddenGroup.getAttribute('aria-checked')).toBe('false');
    expect(visibleGroup.getAttribute('aria-checked')).toBe('true');
    expect(hiddenGroup.contains(hiddenIcon)).toBe(true);
    expect(visibleGroup.contains(shownIcon)).toBe(true);
    expect(hiddenIcon.getAttribute('class')).toContain('text-icon-tertiary');
    expect(shownIcon.getAttribute('class')).toContain('text-icon-secondary');
    [hiddenIcon, shownIcon].forEach((icon) => expect(icon.getAttribute('aria-hidden')).toBe('true'));
    expect(screen.queryAllByTestId(/^grid-group-visibility-switch-/)).toHaveLength(0);
    expect(screen.queryByTestId('grid-group-visibility-shown-group-0')).toBeNull();
    expect(screen.queryByTestId('grid-group-visibility-hidden-group-1')).toBeNull();

    fireEvent.click(hiddenGroup);
    expect(setVisibility).toHaveBeenCalledWith('group-0', true);
    fireEvent.click(visibleGroup);
    expect(setVisibility).toHaveBeenCalledWith('group-1', false);
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
