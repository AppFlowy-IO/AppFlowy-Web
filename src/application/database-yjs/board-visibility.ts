type BoardColumn = {
  id: string;
  visible: boolean;
  /** Whether `visible` was explicitly persisted rather than defaulted to true. */
  visibleExplicit?: boolean;
};

type ResolveBoardColumnVisibilityOptions<T extends BoardColumn> = {
  columns: T[];
  fieldId: string | null;
  hideUngroupedColumn: boolean;
  hideEmptyGroups: boolean;
  groupRowsReady: boolean;
  getRowCount: (columnId: string) => number;
  shownEmptyGroupIds?: ReadonlySet<string>;
};

/**
 * Desktop persists the No Status column's visibility only as that column's own
 * `visible` flag inside the group setting and treats `hide_ungrouped_column`
 * as legacy, so an explicitly persisted flag must win here. The layout key
 * survives purely as a fallback for data written before any client persisted
 * the ungrouped column entry, and as a mirror for old web clients.
 */
export function isUngroupedColumnHidden({
  column,
  hideUngroupedColumn,
}: {
  column: Pick<BoardColumn, 'visible' | 'visibleExplicit'> | null | undefined;
  hideUngroupedColumn: boolean;
}): boolean {
  if (column?.visibleExplicit === true) {
    return !column.visible;
  }

  return hideUngroupedColumn;
}

/**
 * Resolves the two Board column partitions from persisted settings and exact
 * row counts. Explicitly shown empty columns deliberately stay in the hidden
 * partition so their eye action can hide them again. The explicit-show set is
 * shared view state, so Web and desktop resolve the same rendered columns.
 */
export function resolveBoardColumnVisibility<T extends BoardColumn>({
  columns,
  fieldId,
  hideUngroupedColumn,
  hideEmptyGroups,
  groupRowsReady,
  getRowCount,
  shownEmptyGroupIds,
}: ResolveBoardColumnVisibilityOptions<T>) {
  const visibleColumns: T[] = [];
  const hiddenColumns: T[] = [];

  columns.forEach((column) => {
    const explicitlyHidden =
      column.id === fieldId ? isUngroupedColumnHidden({ column, hideUngroupedColumn }) : !column.visible;
    const automaticallyHidden = groupRowsReady && hideEmptyGroups && getRowCount(column.id) === 0;

    if (explicitlyHidden || automaticallyHidden) {
      hiddenColumns.push(column);
    }

    if (!explicitlyHidden && (!automaticallyHidden || shownEmptyGroupIds?.has(column.id) === true)) {
      visibleColumns.push(column);
    }
  });

  return {
    hiddenColumns,
    visibleColumns,
  };
}
