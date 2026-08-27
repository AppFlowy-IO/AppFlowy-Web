import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import * as Y from 'yjs';

import { DatabaseContext, FieldType, SelectOptionColor } from '@/application/database-yjs';
import type { DatabaseContextState } from '@/application/database-yjs';
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
import { RenderRowType } from '@/components/database/components/grid/grid-row';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import { GridGroupingProvider, useGridGrouping } from '@/components/database/grid/GridGroupingContext';

import GridGroupHeader from '../GridGroupHeader';

const toggleCollapsed = jest.fn();
const syncGroupColumns = jest.fn();

jest.mock('@/application/database-yjs/dispatch', () => ({
  useClearGroupByFieldDispatch: () => jest.fn(),
  useSetGridGroupVisibilityDispatch: () => jest.fn(),
  useSyncGridGroupColumnsDispatch: () => syncGroupColumns,
  useToggleGridGroupCollapsedDispatch: () => toggleCollapsed,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () => ({
  useCreateGridGroupRow: () => jest.fn(),
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const lightThemeCss = readFileSync(resolve(process.cwd(), 'src/styles/variables/semantic.light.css'), 'utf8');
const darkThemeCss = readFileSync(resolve(process.cwd(), 'src/styles/variables/semantic.dark.css'), 'utf8');

function readCssVariable(css: string, variable: string) {
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`${escapedVariable}:\\s*([^;]+);`).exec(css)?.[1].trim();
}

function getTagRoot(label: string) {
  const tag = screen.getByText(label).parentElement;

  if (!tag) throw new Error(`Tag root for ${label} was not rendered`);
  return tag;
}

function createContextValue(readOnly = true): DatabaseContextState {
  return {
    activeViewId: 'view-id',
    databaseDoc: new Y.Doc() as YDoc,
    databasePageId: 'database-id',
    readOnly,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
}

function renderHeader(data: RenderRow, readOnly = true) {
  const contextValue = createContextValue(readOnly);

  return render(
    <DatabaseContext.Provider value={contextValue}>
      <GridGroupHeader data={data} />
    </DatabaseContext.Provider>
  );
}

function createLiveColorFixture() {
  const databaseId = 'grid-group-color-database';
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

function LiveGroupHeader({ groupId }: { groupId: string }) {
  const grouping = useGridGrouping();
  const group = grouping.groups.find(({ id }) => id === groupId);

  if (!group) return null;

  return (
    <GridGroupHeader
      data={{
        groupCollapsed: group.collapsed,
        groupConfigId: grouping.groupId,
        groupFieldId: grouping.fieldId,
        groupFieldName: grouping.fieldName,
        groupFieldType: grouping.fieldType,
        groupId: group.id,
        groupLabel: group.label,
        groupOption: group.option,
        groupRowCount: group.rows.length,
        type: RenderRowType.GroupHeader,
      }}
    />
  );
}

function renderHeaderMarkup(data: RenderRow) {
  return renderToStaticMarkup(
    <DatabaseContext.Provider value={createContextValue()}>
      <GridGroupHeader data={data} />
    </DatabaseContext.Provider>
  );
}

describe('GridGroupHeader desktop color parity', () => {
  const baseData: RenderRow = {
    type: RenderRowType.GroupHeader,
    groupId: 'todo',
    groupConfigId: 'group-config',
    groupFieldId: 'status',
    groupFieldName: 'Status',
    groupFieldType: FieldType.SingleSelect,
    groupLabel: 'To do',
    groupRowCount: 2,
    groupCollapsed: false,
  };

  afterEach(() => {
    document.documentElement.removeAttribute('data-dark-mode');
  });

  it('renders select groups with the same semantic tag tokens as web cells', () => {
    const data: RenderRow = {
      ...baseData,
      groupOption: { id: 'todo', name: 'To do', color: SelectOptionColor.OptionColor4 },
    };

    renderHeader(data);
    const markup = renderHeaderMarkup(data);
    const backgroundToken = SelectOptionColorMap[SelectOptionColor.OptionColor4];
    const textToken = SelectOptionFgColorMap[SelectOptionColor.OptionColor4];

    expect(getTagRoot('To do')).toBeTruthy();
    expect(markup).toContain(`background-color:var(${backgroundToken})`);
    expect(markup).toContain(`color:var(${textToken})`);
    expect(readCssVariable(lightThemeCss, backgroundToken)).toBeDefined();
    expect(readCssVariable(lightThemeCss, textToken)).toBeDefined();
  });

  it('refreshes mounted header tokens from Yjs and resolves them in both web themes', async () => {
    document.documentElement.dataset.darkMode = 'true';
    const fixture = createLiveColorFixture();

    const { unmount } = render(
      <DatabaseContext.Provider value={fixture.contextValue}>
        <GridGroupingProvider>
          <LiveGroupHeader groupId={fixture.optionId} />
        </GridGroupingProvider>
      </DatabaseContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('grid-group-option-tag').getAttribute('data-background-color-token')).toBe(
        SelectOptionColorMap[SelectOptionColor.OptionColor1]
      );
    });

    act(() => fixture.setOptionColor(SelectOptionColor.OptionColor12));

    await waitFor(() => {
      const tag = screen.getByTestId('grid-group-option-tag');
      const backgroundToken = SelectOptionColorMap[SelectOptionColor.OptionColor12];
      const textToken = SelectOptionFgColorMap[SelectOptionColor.OptionColor12];
      const lightBackground = readCssVariable(lightThemeCss, backgroundToken);
      const darkBackground = readCssVariable(darkThemeCss, backgroundToken);
      const lightText = readCssVariable(lightThemeCss, textToken);
      const darkText = readCssVariable(darkThemeCss, textToken);

      expect(tag.getAttribute('data-background-color-token')).toBe(backgroundToken);
      expect(tag.getAttribute('data-text-color-token')).toBe(textToken);
      expect(darkThemeCss).toContain(':root[data-dark-mode=true]');
      expect(lightBackground).toBeDefined();
      expect(darkBackground).toBeDefined();
      expect(lightBackground).not.toBe(darkBackground);
      expect(lightText).toBeDefined();
      expect(darkText).toBeDefined();
      expect(lightText).not.toBe(darkText);
    });

    unmount();
    fixture.rowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps hover-only header actions visible when they receive keyboard focus', () => {
    renderHeader(baseData, false);
    const actionsButton = screen.getByTestId('grid-group-actions');
    const newRowButton = screen.getByTestId('grid-group-new-row');

    actionsButton.focus();

    expect(document.activeElement).toBe(actionsButton);
    [actionsButton, newRowButton].forEach((button) => {
      expect(button.className).toContain('focus-visible:opacity-100');
      expect(button.className).toContain('group-focus-within/grid-group-header:opacity-100');
    });
  });

  it('announces Checkbox group status as named, read-only semantics used by desktop', () => {
    const { rerender } = renderHeader({
      ...baseData,
      groupId: 'Yes',
      groupFieldName: 'Registration Complete',
      groupFieldType: FieldType.Checkbox,
      groupLabel: 'Yes',
    });

    expect(screen.getByText('Registration Complete')).toBeTruthy();
    const checked = screen.getByRole('checkbox', { name: 'Registration Complete: Yes' });

    expect(checked.getAttribute('aria-checked')).toBe('true');
    expect(checked.getAttribute('aria-readonly')).toBe('true');
    expect(checked.getAttribute('tabindex')).toBe('-1');

    rerender(
      <DatabaseContext.Provider value={createContextValue()}>
        <GridGroupHeader
          data={{
            ...baseData,
            groupId: 'No',
            groupFieldName: 'Registration Complete',
            groupFieldType: FieldType.Checkbox,
            groupLabel: 'No',
          }}
        />
      </DatabaseContext.Provider>
    );

    const unchecked = screen.getByRole('checkbox', { name: 'Registration Complete: No' });

    expect(unchecked.getAttribute('aria-checked')).toBe('false');
    expect(unchecked.getAttribute('aria-readonly')).toBe('true');
    expect(unchecked.getAttribute('tabindex')).toBe('-1');
  });
});
