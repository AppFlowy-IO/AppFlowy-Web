import { useCallback, useMemo } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import type { SelectOption } from '@/application/database-yjs/fields';
import { getGroupLabel } from '@/application/database-yjs/group';
import type { DatabaseGroupColumn } from '@/application/database-yjs/group-column';
import { useFieldSelector, useGroup, useGroupsSelector, useRowsByGroup } from '@/application/database-yjs/selector';
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

  return columns.map((column) => ({
    id: column.id,
    isDefault: column.id === fieldId,
    label: getGroupLabel(column.id, field),
    option: optionById.get(column.id),
    rows: getRows(column.id),
    visible: renderedColumnIds.has(column.id),
  }));
}

/**
 * The Board group menu's view of the active grouping. The Board page renders
 * exactly `useRowsByGroup(groupId).columns`, so that list is the rendered set
 * desktop publishes as `renderedBoardGroupIds`; until the rows hydrate it
 * degrades to the persisted `visible` flags, like desktop's null notifier.
 */
export function useBoardGroupingSummary() {
  const groupId: string | undefined = useGroupsSelector()[0];
  const { columns } = useGroup(groupId ?? '');
  const {
    columns: renderedColumns,
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

    return resolveBoardGroupVisibilityRows({
      columns,
      field,
      fieldId,
      getRows,
      renderedColumnIds: new Set(renderedColumns.map((column) => column.id)),
    });
  }, [columns, field, fieldClock, fieldId, getRows, renderedColumns]);

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
