type BoardColumn = {
  id: string;
  visible: boolean;
};

type ResolveBoardColumnVisibilityOptions<T extends BoardColumn> = {
  columns: T[];
  fieldId: string | null;
  hideUngroupedColumn: boolean;
  hideEmptyGroups: boolean;
  groupRowsReady: boolean;
  getRowCount: (columnId: string) => number;
  temporarilyShownColumnIds?: ReadonlySet<string>;
};

/**
 * Resolves the two Board column partitions from persisted settings and exact
 * row counts. Temporarily shown empty columns deliberately stay in the hidden
 * partition so their eye action can hide them again, matching desktop.
 */
export function resolveBoardColumnVisibility<T extends BoardColumn>({
  columns,
  fieldId,
  hideUngroupedColumn,
  hideEmptyGroups,
  groupRowsReady,
  getRowCount,
  temporarilyShownColumnIds,
}: ResolveBoardColumnVisibilityOptions<T>) {
  const visibleColumns: T[] = [];
  const hiddenColumns: T[] = [];

  columns.forEach((column) => {
    const explicitlyHidden = column.id === fieldId ? hideUngroupedColumn : !column.visible;
    const automaticallyHidden = groupRowsReady && hideEmptyGroups && getRowCount(column.id) === 0;

    if (explicitlyHidden || automaticallyHidden) {
      hiddenColumns.push(column);
    }

    if (!explicitlyHidden && (!automaticallyHidden || temporarilyShownColumnIds?.has(column.id) === true)) {
      visibleColumns.push(column);
    }
  });

  return {
    hiddenColumns,
    visibleColumns,
  };
}
