import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import {
  CalculationType,
  CalendarLayout,
  FieldType,
  FieldVisibility,
  FilterType,
  SortCondition,
} from '@/application/database-yjs/database.type';
import {
  useAddFilter,
  useAddAdvancedFilterAndRebuild,
  useAddSort,
  useCalculateFieldDispatch,
  useClearCalculate,
  useClearSortingDispatch,
  useDeleteGroupColumnDispatch,
  useGroupByFieldDispatch,
  useHidePropertyDispatch,
  useRebuildFilterTree,
  useRemoveAdvancedFilterAndRebuild,
  useRemoveFilter,
  useRemoveSort,
  useReorderGroupColumnDispatch,
  useReorderSorts,
  useResizeColumnWidthDispatch,
  useShowPropertyDispatch,
  useToggleCollapsedHiddenGroupColumnDispatch,
  useToggleHiddenGroupColumnDispatch,
  useToggleHideUnGrouped,
  useTogglePropertyWrapDispatch,
  useUpdateAdvancedFilterAndRebuild,
  useUpdateCalculate,
  useUpdateCalendarSetting,
  useUpdateChartSetting,
  useUpdateDatabaseLayout,
  useUpdateFilter,
  useUpdateSort,
} from '@/application/database-yjs/dispatch';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { type FilterDraft, flattenFilterTree } from '@/application/database-yjs/filter';
import { useDatabaseHistory } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  type YDatabase,
  type YDatabaseCalculation,
  type YDatabaseCalculations,
  type YDatabaseField,
  type YDatabaseFieldOrders,
  type YDatabaseFields,
  type YDatabaseFieldSetting,
  type YDatabaseFieldSettings,
  type YDatabaseFieldTypeOption,
  type YDatabaseFilter,
  type YDatabaseFilters,
  type YDatabaseGroup,
  type YDatabaseGroupColumns,
  type YDatabaseGroups,
  type YDatabaseLayoutSettings,
  type YDatabaseRowOrders,
  type YDatabaseSort,
  type YDatabaseSorts,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  type YMapFieldTypeOption,
  type YSharedRoot,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

const databaseId = 'database-id';
const viewId = 'view-id';
const textFieldId = 'text-field-id';
const numberFieldId = 'number-field-id';
const checkboxFieldId = 'checkbox-field-id';
const selectFieldId = 'select-field-id';
const selectGroupId = 'select-group-id';
const firstOptionId = 'first-option-id';
const secondOptionId = 'second-option-id';
const firstSortId = 'first-sort-id';
const secondSortId = 'second-sort-id';

type Fixture = {
  calculations: YDatabaseCalculations;
  databaseDoc: YDoc;
  fields: YDatabaseFields;
  fieldSettings: YDatabaseFieldSettings;
  filters: YDatabaseFilters;
  groups: YDatabaseGroups;
  layoutSettings: YDatabaseLayoutSettings;
  sorts: YDatabaseSorts;
  view: YDatabaseView;
};

function createField(id: string, name: string, fieldType: FieldType): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, fieldType);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.icon, '');
  field.set(YjsDatabaseKey.created_at, '1');
  field.set(YjsDatabaseKey.last_modified, '1');
  return field;
}

function createSelectField(): YDatabaseField {
  const field = createField(selectFieldId, 'Status', FieldType.SingleSelect);
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  typeOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [
        { color: 'Purple', id: firstOptionId, name: 'First' },
        { color: 'Pink', id: secondOptionId, name: 'Second' },
      ],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

function createFieldSetting(width: string): YDatabaseFieldSetting {
  const setting = new Y.Map() as YDatabaseFieldSetting;

  setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
  setting.set(YjsDatabaseKey.wrap, false);
  setting.set(YjsDatabaseKey.width, width);
  return setting;
}

function createSort(id: string, fieldId: string, condition: SortCondition): YDatabaseSort {
  const sort = new Y.Map() as YDatabaseSort;

  sort.set(YjsDatabaseKey.id, id);
  sort.set(YjsDatabaseKey.field_id, fieldId);
  sort.set(YjsDatabaseKey.condition, condition);
  return sort;
}

function createFilter(
  id: string,
  fieldId: string,
  fieldType: FieldType,
  condition: number,
  content = ''
): YDatabaseFilter {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, id);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.type, fieldType);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);
  return filter;
}

function addSelectGroup(fixture: Fixture) {
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;

  columns.push([
    { id: selectFieldId, visible: true },
    { id: firstOptionId, visible: true },
    { id: secondOptionId, visible: true },
  ]);
  group.set(YjsDatabaseKey.id, selectGroupId);
  group.set(YjsDatabaseKey.field_id, selectFieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.content, '');
  group.set(YjsDatabaseKey.groups, columns);
  fixture.groups.push([group]);
  return { columns, group };
}

function getSelectOptionIds(fixture: Fixture) {
  const content = fixture.fields
    .get(selectFieldId)
    .get(YjsDatabaseKey.type_option)
    .get(String(FieldType.SingleSelect))
    .get(YjsDatabaseKey.content);

  return (JSON.parse(content) as { options: { id: string }[] }).options.map(({ id }) => id);
}

function createFixture(): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>() as YDatabaseFieldOrders;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;
  const groups = new Y.Array() as YDatabaseGroups;
  const calculations = new Y.Array<YDatabaseCalculation>() as YDatabaseCalculations;
  const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  views.set(viewId, view);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.calculations, calculations);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);

  fields.set(textFieldId, createField(textFieldId, 'Text', FieldType.RichText));
  fields.set(numberFieldId, createField(numberFieldId, 'Amount', FieldType.Number));
  fields.set(checkboxFieldId, createField(checkboxFieldId, 'Done', FieldType.Checkbox));
  fields.set(selectFieldId, createSelectField());
  fieldOrders.push([
    { id: textFieldId },
    { id: numberFieldId },
    { id: checkboxFieldId },
    { id: selectFieldId },
  ]);
  fieldSettings.set(textFieldId, createFieldSetting('200'));
  fieldSettings.set(numberFieldId, createFieldSetting('160'));
  fieldSettings.set(checkboxFieldId, createFieldSetting('120'));
  fieldSettings.set(selectFieldId, createFieldSetting('180'));
  sorts.push([
    createSort(firstSortId, textFieldId, SortCondition.Ascending),
    createSort(secondSortId, numberFieldId, SortCondition.Descending),
  ]);

  return { calculations, databaseDoc, fields, fieldSettings, filters, groups, layoutSettings, sorts, view };
}

function createWrapper(fixture: Fixture) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: false,
        openLoginModal: () => undefined,
        updateCurrentUser: async () => undefined,
      }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

function useConfigurationHistory() {
  const addFilter = useAddFilter();
  const updateFilter = useUpdateFilter();
  const removeFilter = useRemoveFilter();
  const addAdvancedFilter = useAddAdvancedFilterAndRebuild();
  const updateAdvancedFilter = useUpdateAdvancedFilterAndRebuild();
  const rebuildFilterTree = useRebuildFilterTree();
  const removeAdvancedFilter = useRemoveAdvancedFilterAndRebuild();
  const addSort = useAddSort();
  const updateSort = useUpdateSort();
  const reorderSorts = useReorderSorts();
  const removeSort = useRemoveSort();
  const clearSorts = useClearSortingDispatch();
  const groupByField = useGroupByFieldDispatch();
  const reorderGroupColumn = useReorderGroupColumnDispatch(selectGroupId);
  const hideGroupColumn = useToggleHiddenGroupColumnDispatch(selectGroupId, selectFieldId);
  const collapseHiddenGroups = useToggleCollapsedHiddenGroupColumnDispatch();
  const hideUngrouped = useToggleHideUnGrouped();
  const deleteGroupColumn = useDeleteGroupColumnDispatch(selectGroupId, firstOptionId, selectFieldId);
  const updateCalculation = useUpdateCalculate(numberFieldId);
  const clearCalculation = useClearCalculate(numberFieldId);
  const calculateField = useCalculateFieldDispatch(numberFieldId);
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const updateCalendarSetting = useUpdateCalendarSetting();
  const updateChartSetting = useUpdateChartSetting();
  const hideProperty = useHidePropertyDispatch();
  const showProperty = useShowPropertyDispatch();
  const togglePropertyWrap = useTogglePropertyWrapDispatch();
  const resizeColumn = useResizeColumnWidthDispatch();
  const history = useDatabaseHistory();

  return {
    addAdvancedFilter,
    addFilter,
    addSort,
    calculateField,
    clearCalculation,
    clearSorts,
    collapseHiddenGroups,
    deleteGroupColumn,
    groupByField,
    hideGroupColumn,
    hideProperty,
    hideUngrouped,
    history,
    rebuildFilterTree,
    removeAdvancedFilter,
    removeFilter,
    removeSort,
    reorderGroupColumn,
    reorderSorts,
    resizeColumn,
    showProperty,
    togglePropertyWrap,
    updateAdvancedFilter,
    updateCalculation,
    updateCalendarSetting,
    updateChartSetting,
    updateFilter,
    updateLayout,
    updateSort,
  };
}

function getFilter(fixture: Fixture, filterId: string) {
  return fixture.filters.toArray().find((filter) => filter.get(YjsDatabaseKey.id) === filterId);
}

function getSort(fixture: Fixture, sortId: string) {
  return fixture.sorts.toArray().find((sort) => sort.get(YjsDatabaseKey.id) === sortId);
}

function getSortIds(fixture: Fixture) {
  return fixture.sorts.toArray().map((sort) => sort.get(YjsDatabaseKey.id));
}

function getCalculation(fixture: Fixture) {
  return fixture.calculations
    .toArray()
    .find((calculation) => calculation.get(YjsDatabaseKey.field_id) === numberFieldId);
}

function getAdvancedDrafts(fixture: Fixture) {
  return flattenFilterTree(fixture.filters, fixture.fields);
}

function getGroupColumnIds(columns: YDatabaseGroupColumns) {
  return columns.toArray().map(({ id }) => id);
}

describe('configuration production hooks use database history', () => {
  it('adds, updates, and removes a basic filter with an undo/redo round trip for each operation', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });
    let filterId = '';

    act(() => {
      filterId = result.current.addFilter(textFieldId) ?? '';
    });
    expect(filterId).not.toBe('');
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.field_id)).toBe(textFieldId);

    act(() => result.current.history.undo());
    expect(getFilter(fixture, filterId)).toBeUndefined();

    act(() => result.current.history.redo());
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.field_id)).toBe(textFieldId);
    const initialCondition = getFilter(fixture, filterId)?.get(YjsDatabaseKey.condition);
    const initialContent = getFilter(fixture, filterId)?.get(YjsDatabaseKey.content);

    act(() => result.current.history.clear());
    act(() =>
      result.current.updateFilter({
        condition: TextFilterCondition.TextStartsWith,
        content: 'needle',
        fieldId: textFieldId,
        filterId,
      })
    );
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextStartsWith);
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.content)).toBe('needle');

    act(() => result.current.history.undo());
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.condition)).toBe(initialCondition);
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.content)).toBe(initialContent);

    act(() => result.current.history.redo());
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextStartsWith);
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.content)).toBe('needle');

    act(() => result.current.history.clear());
    act(() => result.current.removeFilter(filterId));
    expect(getFilter(fixture, filterId)).toBeUndefined();

    act(() => result.current.history.undo());
    expect(getFilter(fixture, filterId)?.get(YjsDatabaseKey.content)).toBe('needle');

    act(() => result.current.history.redo());
    expect(getFilter(fixture, filterId)).toBeUndefined();
  });

  it('adds, updates, rebuilds, and removes advanced filters with an undo/redo round trip for each operation', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });
    let advancedFilterId = '';

    act(() => {
      advancedFilterId = result.current.addAdvancedFilter(textFieldId) ?? '';
    });
    expect(advancedFilterId).not.toBe('');
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([advancedFilterId]);

    act(() => result.current.history.undo());
    expect(getAdvancedDrafts(fixture)).toEqual([]);

    act(() => result.current.history.redo());
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([advancedFilterId]);

    act(() => result.current.history.clear());
    act(() =>
      result.current.updateAdvancedFilter({
        condition: TextFilterCondition.TextStartsWith,
        content: 'advanced needle',
        fieldId: textFieldId,
        filterId: advancedFilterId,
      })
    );
    expect(getAdvancedDrafts(fixture)[0]).toMatchObject({
      condition: TextFilterCondition.TextStartsWith,
      content: 'advanced needle',
      id: advancedFilterId,
    });

    act(() => result.current.history.undo());
    expect(getAdvancedDrafts(fixture)[0]).toMatchObject({ content: '', id: advancedFilterId });

    act(() => result.current.history.redo());
    expect(getAdvancedDrafts(fixture)[0]).toMatchObject({
      condition: TextFilterCondition.TextStartsWith,
      content: 'advanced needle',
      id: advancedFilterId,
    });

    const rebuiltDrafts: FilterDraft[] = [
      { ...getAdvancedDrafts(fixture)[0], operator: null },
      {
        condition: NumberFilterCondition.GreaterThan,
        content: '10',
        fieldId: numberFieldId,
        fieldType: FieldType.Number,
        id: 'advanced-number-filter-id',
        operator: FilterType.Or,
      },
    ];

    act(() => result.current.history.clear());
    act(() => result.current.rebuildFilterTree(rebuiltDrafts));
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([
      advancedFilterId,
      'advanced-number-filter-id',
    ]);
    expect(getAdvancedDrafts(fixture)[1].operator).toBe(FilterType.Or);

    act(() => result.current.history.undo());
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([advancedFilterId]);

    act(() => result.current.history.redo());
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([
      advancedFilterId,
      'advanced-number-filter-id',
    ]);

    act(() => result.current.history.clear());
    act(() => result.current.removeAdvancedFilter('advanced-number-filter-id'));
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([advancedFilterId]);

    act(() => result.current.history.undo());
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([
      advancedFilterId,
      'advanced-number-filter-id',
    ]);

    act(() => result.current.history.redo());
    expect(getAdvancedDrafts(fixture).map(({ id }) => id)).toEqual([advancedFilterId]);
  });

  it('adds, updates, reorders, removes, and clears sorts with an undo/redo round trip for each operation', () => {
    const fixture = createFixture();
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.addSort(checkboxFieldId));
    const addedSort = fixture.sorts
      .toArray()
      .find((sort) => sort.get(YjsDatabaseKey.field_id) === checkboxFieldId);
    const addedSortId = addedSort?.get(YjsDatabaseKey.id) ?? '';

    expect(addedSortId).not.toBe('');
    expect(addedSort?.get(YjsDatabaseKey.condition)).toBe(SortCondition.Ascending);

    act(() => result.current.history.undo());
    expect(getSort(fixture, addedSortId)).toBeUndefined();

    act(() => result.current.history.redo());
    expect(getSort(fixture, addedSortId)?.get(YjsDatabaseKey.condition)).toBe(SortCondition.Ascending);

    act(() => result.current.history.clear());
    act(() => result.current.updateSort({ condition: SortCondition.Descending, sortId: addedSortId }));
    expect(getSort(fixture, addedSortId)?.get(YjsDatabaseKey.condition)).toBe(SortCondition.Descending);

    act(() => result.current.history.undo());
    expect(getSort(fixture, addedSortId)?.get(YjsDatabaseKey.condition)).toBe(SortCondition.Ascending);

    act(() => result.current.history.redo());
    expect(getSort(fixture, addedSortId)?.get(YjsDatabaseKey.condition)).toBe(SortCondition.Descending);

    act(() => result.current.history.clear());
    act(() => result.current.reorderSorts(addedSortId));
    expect(getSortIds(fixture)).toEqual([addedSortId, firstSortId, secondSortId]);

    act(() => result.current.history.undo());
    expect(getSortIds(fixture)).toEqual([firstSortId, secondSortId, addedSortId]);

    act(() => result.current.history.redo());
    expect(getSortIds(fixture)).toEqual([addedSortId, firstSortId, secondSortId]);

    act(() => result.current.history.clear());
    act(() => result.current.removeSort(addedSortId));
    expect(getSortIds(fixture)).toEqual([firstSortId, secondSortId]);

    act(() => result.current.history.undo());
    expect(getSortIds(fixture)).toEqual([addedSortId, firstSortId, secondSortId]);

    act(() => result.current.history.redo());
    expect(getSortIds(fixture)).toEqual([firstSortId, secondSortId]);

    act(() => result.current.history.clear());
    act(() => result.current.clearSorts());
    expect(getSortIds(fixture)).toEqual([]);

    act(() => result.current.history.undo());
    expect(getSortIds(fixture)).toEqual([firstSortId, secondSortId]);

    act(() => result.current.history.redo());
    expect(getSortIds(fixture)).toEqual([]);
  });

  it('adds, updates, and removes a calculation config with an undo/redo round trip for each operation', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateCalculation(CalculationType.Count));
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Count);

    act(() => result.current.history.undo());
    expect(getCalculation(fixture)).toBeUndefined();

    act(() => result.current.history.redo());
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Count);

    act(() => result.current.history.clear());
    act(() => result.current.updateCalculation(CalculationType.Sum));
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);

    act(() => result.current.history.undo());
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Count);

    act(() => result.current.history.redo());
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);

    act(() => result.current.history.clear());
    act(() => result.current.clearCalculation());
    expect(getCalculation(fixture)).toBeUndefined();

    act(() => result.current.history.undo());
    expect(getCalculation(fixture)?.get(YjsDatabaseKey.type)).toBe(CalculationType.Sum);

    act(() => result.current.history.redo());
    expect(getCalculation(fixture)).toBeUndefined();
  });

  it('keeps a derived calculation-value write out of history and preserves an existing redo action', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const calculation = new Y.Map() as YDatabaseCalculation;

    calculation.set(YjsDatabaseKey.id, 'calculation-id');
    calculation.set(YjsDatabaseKey.field_id, numberFieldId);
    calculation.set(YjsDatabaseKey.type, CalculationType.Sum);
    calculation.set(YjsDatabaseKey.calculation_value, '0');
    fixture.calculations.push([calculation]);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });
    const setting = fixture.fieldSettings.get(textFieldId);

    act(() => result.current.resizeColumn(textFieldId, 360));
    expect(setting.get(YjsDatabaseKey.width)).toBe('360');

    act(() => result.current.history.undo());
    expect(setting.get(YjsDatabaseKey.width)).toBe('200');
    expect(result.current.history.canRedo).toBe(true);

    act(() => result.current.calculateField(new Map([['first', '2'], ['second', '3']])));
    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('5');
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(true);

    act(() => result.current.history.redo());
    expect(setting.get(YjsDatabaseKey.width)).toBe('360');
    expect(calculation.get(YjsDatabaseKey.calculation_value)).toBe('5');
  });

  it('groups by a checkbox field and atomically restores the replaced group and removed filter', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const groupedFilter = createFilter(
      'checkbox-filter-id',
      checkboxFieldId,
      FieldType.Checkbox,
      CheckboxFilterCondition.IsChecked
    );

    fixture.filters.push([groupedFilter]);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.groupByField(checkboxFieldId));
    expect(fixture.filters.length).toBe(0);
    expect(fixture.groups.length).toBe(1);
    expect(fixture.groups.get(0).get(YjsDatabaseKey.field_id)).toBe(checkboxFieldId);
    expect(fixture.groups.get(0).get(YjsDatabaseKey.groups).toArray()).toEqual([
      { id: 'Yes', visible: true },
      { id: 'No', visible: true },
    ]);

    act(() => result.current.history.undo());
    expect(fixture.groups.length).toBe(0);
    expect(fixture.filters.get(0).get(YjsDatabaseKey.id)).toBe('checkbox-filter-id');

    act(() => result.current.history.redo());
    expect(fixture.filters.length).toBe(0);
    expect(fixture.groups.get(0).get(YjsDatabaseKey.field_id)).toBe(checkboxFieldId);
  });

  it('reorders, hides, collapses, deletes, and hides ungrouped board columns with history round trips', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { columns } = addSelectGroup(fixture);
    const boardSetting = new Y.Map();

    boardSetting.set(YjsDatabaseKey.collapse_hidden_groups, false);
    boardSetting.set(YjsDatabaseKey.hide_ungrouped_column, false);
    fixture.layoutSettings.set('1', boardSetting);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.reorderGroupColumn(secondOptionId));
    expect(getGroupColumnIds(columns)).toEqual([secondOptionId, selectFieldId, firstOptionId]);

    act(() => result.current.history.undo());
    expect(getGroupColumnIds(columns)).toEqual([selectFieldId, firstOptionId, secondOptionId]);

    act(() => result.current.history.redo());
    expect(getGroupColumnIds(columns)).toEqual([secondOptionId, selectFieldId, firstOptionId]);

    act(() => result.current.history.clear());
    act(() => result.current.hideGroupColumn(firstOptionId, true));
    expect(columns.toArray().find(({ id }) => id === firstOptionId)?.visible).toBe(false);

    act(() => result.current.history.undo());
    expect(columns.toArray().find(({ id }) => id === firstOptionId)?.visible).toBe(true);

    act(() => result.current.history.redo());
    expect(columns.toArray().find(({ id }) => id === firstOptionId)?.visible).toBe(false);

    act(() => result.current.history.clear());
    act(() => result.current.collapseHiddenGroups(true));
    expect(boardSetting.get(YjsDatabaseKey.collapse_hidden_groups)).toBe(true);

    act(() => result.current.history.undo());
    expect(boardSetting.get(YjsDatabaseKey.collapse_hidden_groups)).toBe(false);

    act(() => result.current.history.redo());
    expect(boardSetting.get(YjsDatabaseKey.collapse_hidden_groups)).toBe(true);

    act(() => result.current.history.clear());
    act(() => result.current.hideUngrouped(true));
    expect(boardSetting.get(YjsDatabaseKey.hide_ungrouped_column)).toBe(true);

    act(() => result.current.history.undo());
    expect(boardSetting.get(YjsDatabaseKey.hide_ungrouped_column)).toBe(false);

    act(() => result.current.history.redo());
    expect(boardSetting.get(YjsDatabaseKey.hide_ungrouped_column)).toBe(true);

    act(() => result.current.history.clear());
    act(() => result.current.deleteGroupColumn());
    expect(getGroupColumnIds(columns)).not.toContain(firstOptionId);
    expect(getSelectOptionIds(fixture)).toEqual([secondOptionId]);

    act(() => result.current.history.undo());
    expect(getGroupColumnIds(columns)).toContain(firstOptionId);
    expect(getSelectOptionIds(fixture)).toEqual([firstOptionId, secondOptionId]);

    act(() => result.current.history.redo());
    expect(getGroupColumnIds(columns)).not.toContain(firstOptionId);
    expect(getSelectOptionIds(fixture)).toEqual([secondOptionId]);
  });

  it('switches Grid to Board and undoes and redoes the generated layout configuration', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateLayout(DatabaseViewLayout.Board));
    expect(Number(fixture.view.get(YjsDatabaseKey.layout))).toBe(DatabaseViewLayout.Board);
    expect(fixture.view.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.field_id)).toBe(checkboxFieldId);
    expect(
      fixture.view
        .get(YjsDatabaseKey.field_settings)
        .get(textFieldId)
        .get(YjsDatabaseKey.visibility)
    ).toBe(FieldVisibility.HideWhenEmpty);
    expect(
      fixture.view
        .get(YjsDatabaseKey.layout_settings)
        .get('1')
        .get(YjsDatabaseKey.collapse_hidden_groups)
    ).toBe(true);

    act(() => result.current.history.undo());
    expect(Number(fixture.view.get(YjsDatabaseKey.layout))).toBe(DatabaseViewLayout.Grid);
    expect(fixture.view.get(YjsDatabaseKey.groups).length).toBe(0);
    expect(fixture.view.get(YjsDatabaseKey.field_settings).get(textFieldId).get(YjsDatabaseKey.width)).toBe('200');
    expect(fixture.view.get(YjsDatabaseKey.layout_settings).get('1')).toBeUndefined();

    act(() => result.current.history.redo());
    expect(Number(fixture.view.get(YjsDatabaseKey.layout))).toBe(DatabaseViewLayout.Board);
    expect(fixture.view.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.field_id)).toBe(checkboxFieldId);
    expect(
      fixture.view
        .get(YjsDatabaseKey.layout_settings)
        .get('1')
        .get(YjsDatabaseKey.collapse_hidden_groups)
    ).toBe(true);
  });

  it('updates Calendar and Chart settings with an undo/redo round trip for each specialized layout', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });

    act(() =>
      result.current.updateCalendarSetting({
        fieldId: numberFieldId,
        firstDayOfWeek: 1,
        layout: CalendarLayout.WeekLayout,
        numberOfDays: 5,
        showWeekNumbers: true,
        showWeekends: false,
      })
    );
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.field_id)).toBe(numberFieldId);
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.layout_ty)).toBe(CalendarLayout.WeekLayout);
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.number_of_days)).toBe(5);

    act(() => result.current.history.undo());
    expect(fixture.layoutSettings.get('2')).toBeUndefined();

    act(() => result.current.history.redo());
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.field_id)).toBe(numberFieldId);
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.show_week_numbers)).toBe(true);
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.show_weekends)).toBe(false);

    act(() => result.current.history.clear());
    act(() =>
      result.current.updateChartSetting({
        aggregationType: 4,
        chartType: 2,
        cumulative: true,
        showEmptyValues: true,
        xFieldId: textFieldId,
        yFieldId: numberFieldId,
      })
    );
    const getChartSetting = () => fixture.layoutSettings.get('3') as unknown as Y.Map<unknown> | undefined;

    expect(getChartSetting()?.get('chartType')).toBe(2);
    expect(getChartSetting()?.get('xFieldId')).toBe(textFieldId);
    expect(getChartSetting()?.get('yFieldId')).toBe(numberFieldId);
    expect(getChartSetting()?.get('cumulative')).toBe(true);

    act(() => result.current.history.undo());
    expect(getChartSetting()).toBeUndefined();

    act(() => result.current.history.redo());
    expect(getChartSetting()?.get('chartType')).toBe(2);
    expect(getChartSetting()?.get('aggregationType')).toBe(4);
    expect(getChartSetting()?.get('showEmptyValues')).toBe(true);
    expect(fixture.layoutSettings.get('2').get(YjsDatabaseKey.field_id)).toBe(numberFieldId);
  });

  it('updates visibility, wrapping, and width with an undo/redo round trip for each field-display setting', () => {
    const fixture = createFixture();

    fixture.sorts.delete(0, fixture.sorts.length);
    const { result } = renderHook(useConfigurationHistory, { wrapper: createWrapper(fixture) });
    const setting = fixture.fieldSettings.get(textFieldId);

    act(() => result.current.hideProperty(textFieldId));
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);

    act(() => result.current.history.undo());
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);

    act(() => result.current.history.redo());
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);

    act(() => result.current.history.clear());
    act(() => result.current.showProperty(textFieldId));
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);

    act(() => result.current.history.undo());
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);

    act(() => result.current.history.redo());
    expect(setting.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);

    act(() => result.current.history.clear());
    act(() => result.current.togglePropertyWrap(textFieldId, true));
    expect(setting.get(YjsDatabaseKey.wrap)).toBe(true);

    act(() => result.current.history.undo());
    expect(setting.get(YjsDatabaseKey.wrap)).toBe(false);

    act(() => result.current.history.redo());
    expect(setting.get(YjsDatabaseKey.wrap)).toBe(true);

    act(() => result.current.history.clear());
    act(() => result.current.resizeColumn(textFieldId, 360));
    expect(setting.get(YjsDatabaseKey.width)).toBe('360');

    act(() => result.current.history.undo());
    expect(setting.get(YjsDatabaseKey.width)).toBe('200');

    act(() => result.current.history.redo());
    expect(setting.get(YjsDatabaseKey.width)).toBe('360');
  });
});
