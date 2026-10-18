import { useCallback, useMemo } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import type { SelectOption } from '@/application/database-yjs/fields';
import { getGroupLabel } from '@/application/database-yjs/group';
import type { DatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { useFieldSelector, useGroupsSelector, useRowsByGroup } from '@/application/database-yjs/selector';
import type { Row } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseField } from '@/application/types';

/** One row of the "Groups" section in the Board group menu. */
export interface BoardGroupVisibilityRow {
  id: string;
  label: string;
  option?: SelectOption;
  isDefault: boolean;
  /**
   * Whether the Board currently renders the column (desktop's
   * `renderedBoardGroupIds`), not its persisted `visible` flag: an empty
   * column auto-hidden by "Hide empty groups" reads as hidden here even
   * though its flag is still true.
   */
  visible: boolean;
  rows: Row[];
}

const SELECT_FIELD_TYPES: readonly FieldType[] = [FieldType.SingleSelect, FieldType.MultiSelect];

/**
 * The columns the Board canvas draws: the visible columns minus those without
 * a bucket in the grouping result, which happens when a filter on the grouping
 * field excludes an option. Shared with the canvas so the menu's eyes cannot
 * drift from it.
 */
export function getRenderedBoardColumns<Column extends { id: string }>(
  columns: readonly Column[],
  groupResult: ReadonlyMap<string, Row[]>
): Column[] {
  return columns.filter((column) => groupResult.has(column.id));
}

/**
 * Desktop lists every Board group (the default "No <field>" group, hidden
 * groups and empty groups alike) in persisted order, so no column is
 * filtered out here.
 */
export function resolveBoardGroupVisibilityRows({
  columns,
  field,
  fieldId,
  getRows,
  renderedColumnIds,
}: {
  columns: readonly DatabaseGroupColumn[];
  field: YDatabaseField | undefined;
  fieldId: string | null;
  getRows: (columnId: string) => Row[];
  renderedColumnIds: ReadonlySet<string>;
}): BoardGroupVisibilityRow[] {
  if (!field || !fieldId) return [];

  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const options = SELECT_FIELD_TYPES.includes(fieldType) ? parseSelectOptionTypeOptions(field)?.options ?? [] : [];
  const optionById = new Map(options.map((option) => [option.id, option] as const));

  return columns.map((column) => {
    const option = optionById.get(column.id);

    return {
      id: column.id,
      isDefault: column.id === fieldId,
      // `getGroupLabel` re-parses the options per column; a known option is its name.
      label: option?.name ?? getGroupLabel(column.id, field),
      option,
      rows: getRows(column.id),
      visible: renderedColumnIds.has(column.id),
    };
  });
}

/**
 * The Board group menu's view of the active grouping. The Board page renders
 * `getRenderedBoardColumns(useRowsByGroup(groupId).columns, groupResult)`, so
 * that list is the rendered set desktop publishes as `renderedBoardGroupIds`;
 * until the rows hydrate it degrades to the persisted `visible` flags, like
 * desktop's null notifier.
 */
export function useBoardGroupingSummary() {
  const groupId: string | undefined = useGroupsSelector()[0];
  const {
    allColumns: columns,
    columns: visibleColumns,
    fieldId,
    groupResult,
    groupRowsReady,
    hideEmptyGroups,
  } = useRowsByGroup(groupId ?? '');
  const { field, clock: fieldClock } = useFieldSelector(fieldId ?? '');
  const getRows = useCallback((columnId: string) => groupResult.get(columnId) ?? [], [groupResult]);
  const groups = useMemo(() => {
    // Option names and colors live on the field; its clock ticks when they change.
    void fieldClock;
    // Before the first complete grouping the canvas shows its skeleton, so the
    // flags stand in for the rendered set instead of reporting every eye closed.
    const renderedColumns = groupRowsReady ? getRenderedBoardColumns(visibleColumns, groupResult) : visibleColumns;

    return resolveBoardGroupVisibilityRows({
      columns,
      field,
      fieldId,
      getRows,
      renderedColumnIds: new Set(renderedColumns.map((column) => column.id)),
    });
  }, [columns, field, fieldClock, fieldId, getRows, groupResult, groupRowsReady, visibleColumns]);

  return {
    groupId,
    fieldId,
    fieldType: field ? (Number(field.get(YjsDatabaseKey.type)) as FieldType) : undefined,
    fieldName: field?.get(YjsDatabaseKey.name),
    hideEmptyGroups,
    groupRowsReady,
    groups,
    getRows,
  };
}
