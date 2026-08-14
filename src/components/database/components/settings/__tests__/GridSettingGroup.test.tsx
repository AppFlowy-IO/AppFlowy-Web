import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, FieldType, SelectOptionColor } from '@/application/database-yjs';
import type { DatabaseContextState, GridGroup } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { createYDatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
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
  GRID_GROUP_VISIBILITY_LIMIT,
  GridGroupVisibilityActions,
  GridGroupVisibilityList,
  getGridGroupVisibilityGroups,
} from '@/components/database/components/settings/GridSettingGroup';
import { GridGroupingProvider, useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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

function createLiveColorFixture() {
  const databaseId = 'grid-group-settings-color-database';
  const viewId = 'grid-view';
  const fieldId = 'status';
  const optionId = 'todo';
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
  const setOptionColor = (color: SelectOptionColor) => {
    selectTypeOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [{ color, id: optionId, name: 'To do' }],
      })
    );
  };

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Status');
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  typeOptions.set(String(FieldType.SingleSelect), selectTypeOption);
  setOptionColor(SelectOptionColor.OptionColor1);
  fields.set(fieldId, field);

  columns.push([createYDatabaseGroupColumn({ id: fieldId }), createYDatabaseGroupColumn({ id: optionId })]);
  group.set(YjsDatabaseKey.id, 'group-config');
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.content, '');
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  rowOrders.push([{ height: 36, id: 'row-a' }]);
  gridLayoutSetting.set(YjsDatabaseKey.hide_empty_groups, true);
  layoutSettings.set('0', gridLayoutSetting);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.layout, 0);
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
    [fieldId]: createCell(FieldType.SingleSelect, optionId),
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

  return { contextValue, databaseDoc, optionId, rowDoc, setOptionColor };
}

function VisibilityMenu({
  groups,
  setAllVisibility = jest.fn(),
  setVisibility = jest.fn(),
}: {
  groups: GridGroup[];
  setAllVisibility?: (groupIds: string[], visible: boolean) => void;
  setVisibility?: (groupId: string, visible: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open group visibility</DropdownMenuTrigger>
      <DropdownMenuContent>
        <GridGroupVisibilityActions groups={groups} setAllVisibility={setAllVisibility} />
        <GridGroupVisibilityList groups={groups} setVisibility={setVisibility} />
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
  await waitFor(() => expect(screen.getByTestId('grid-show-all-groups')).toBeTruthy());
}

describe('GridGroupVisibilityList', () => {
  it('omits empty persisted dynamic groups while leaving static group choices unchanged', () => {
    const defaultGroup = { ...createGroup(0), id: 'field-id', isDefault: true };
    const populatedGroup = {
      ...createGroup(1),
      id: 'current-value',
      rows: [{ height: 36, id: 'row-a' }],
    };
    const staleGroup = { ...createGroup(2), id: 'stale-value' };
    const groups = [defaultGroup, populatedGroup, staleGroup];

    expect(getGridGroupVisibilityGroups(groups, FieldType.RichText).map((group) => group.id)).toEqual([
      'field-id',
      'current-value',
    ]);
    expect(getGridGroupVisibilityGroups(groups, FieldType.SingleSelect)).toBe(groups);
  });

  it('renders select-option groups with the same semantic tag colors while retaining checkbox semantics', async () => {
    const optionGroup: GridGroup = {
      ...createGroup(1),
      id: 'todo',
      label: 'To do',
      option: { color: SelectOptionColor.OptionColor4, id: 'todo', name: 'To do' },
    };

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
    const fixture = createLiveColorFixture();
    const { unmount } = render(
      <DatabaseContext.Provider value={fixture.contextValue}>
        <GridGroupingProvider>
          <LiveVisibilityMenu groupId={fixture.optionId} />
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
    fixture.rowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('bounds mounted switches and lets users search groups outside the initial window', async () => {
    const groups = Array.from({ length: 100 }, (_, index) => createGroup(index));

    render(<VisibilityMenu groups={groups} />);
    await openMenuWithKeyboard();

    expect(screen.getAllByTestId(/^grid-group-visibility-switch-/)).toHaveLength(GRID_GROUP_VISIBILITY_LIMIT);
    expect(screen.queryByTestId('grid-group-visibility-group-87')).toBeNull();
    expect(screen.getByTestId('grid-group-visibility-limit').textContent).toContain(
      `Showing ${GRID_GROUP_VISIBILITY_LIMIT} of 100 groups`
    );

    fireEvent.change(screen.getByTestId('grid-group-visibility-search'), { target: { value: 'Group 87' } });

    expect(screen.getAllByTestId(/^grid-group-visibility-switch-/)).toHaveLength(1);
    expect(screen.getByTestId('grid-group-visibility-group-87')).toBeTruthy();
    expect(screen.queryByTestId('grid-group-visibility-group-7')).toBeNull();
  });

  it('reports an empty search without mounting switches', async () => {
    const groups = Array.from({ length: GRID_GROUP_VISIBILITY_LIMIT + 1 }, (_, index) => createGroup(index));

    render(<VisibilityMenu groups={groups} />);
    await openMenuWithKeyboard();
    fireEvent.change(screen.getByTestId('grid-group-visibility-search'), { target: { value: 'missing group' } });

    expect(screen.queryAllByTestId(/^grid-group-visibility-switch-/)).toHaveLength(0);
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

  it('keeps search, bulk actions, and filtered group toggles in the Radix keyboard path', async () => {
    const groups = Array.from({ length: 100 }, (_, index) => createGroup(index));
    const setAllVisibility = jest.fn();
    const setVisibility = jest.fn();

    render(<VisibilityMenu groups={groups} setAllVisibility={setAllVisibility} setVisibility={setVisibility} />);
    await openMenuWithKeyboard();

    const showAll = screen.getByTestId('grid-show-all-groups');

    await waitFor(() => expect(document.activeElement).toBe(showAll));
    fireEvent.keyDown(showAll, { key: 'Enter' });
    expect(setAllVisibility).toHaveBeenLastCalledWith(
      groups.map((group) => group.id),
      true
    );

    fireEvent.keyDown(showAll, { key: 'ArrowDown' });
    const hideAll = screen.getByTestId('grid-hide-all-groups');

    await waitFor(() => expect(document.activeElement).toBe(hideAll));
    fireEvent.keyDown(hideAll, { key: 'Enter' });
    expect(setAllVisibility).toHaveBeenLastCalledWith(
      groups.map((group) => group.id),
      false
    );

    fireEvent.keyDown(hideAll, { key: 'ArrowDown' });
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

  it('exposes each group toggle as one checked menu item with a decorative switch', async () => {
    render(<VisibilityMenu groups={[createGroup(0), createGroup(1)]} />);
    await openMenuWithKeyboard();

    const hiddenGroup = screen.getByRole('menuitemcheckbox', { name: 'Group 0' });
    const visibleGroup = screen.getByRole('menuitemcheckbox', { name: 'Group 1' });

    expect(hiddenGroup.getAttribute('aria-checked')).toBe('false');
    expect(visibleGroup.getAttribute('aria-checked')).toBe('true');
    screen.getAllByTestId(/^grid-group-visibility-switch-/).forEach((switchElement) => {
      expect(switchElement.getAttribute('aria-hidden')).toBe('true');
      expect(switchElement.getAttribute('tabindex')).toBe('-1');
    });
  });
});
