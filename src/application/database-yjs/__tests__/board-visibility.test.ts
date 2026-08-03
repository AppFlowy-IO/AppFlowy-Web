import { resolveBoardColumnVisibility } from '@/application/database-yjs/board-visibility';

const columns = [
  { id: 'status-field', visible: true },
  { id: 'todo', visible: true },
  { id: 'done', visible: false },
];

const rowCounts = new Map([
  ['status-field', 0],
  ['todo', 2],
  ['done', 0],
]);

function resolveVisibility({
  hideEmptyGroups = true,
  hideUngroupedColumn = false,
  temporarilyShownColumnIds,
}: {
  hideEmptyGroups?: boolean;
  hideUngroupedColumn?: boolean;
  temporarilyShownColumnIds?: ReadonlySet<string>;
} = {}) {
  return resolveBoardColumnVisibility({
    columns,
    fieldId: 'status-field',
    getRowCount: (columnId) => rowCounts.get(columnId) ?? 0,
    groupRowsReady: true,
    hideEmptyGroups,
    hideUngroupedColumn,
    temporarilyShownColumnIds,
  });
}

describe('resolveBoardColumnVisibility', () => {
  it('hides empty and explicitly hidden columns when hide empty groups is enabled', () => {
    const result = resolveVisibility();

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['status-field', 'done']);
  });

  it('keeps a temporarily shown empty column in both Board and Hidden Groups', () => {
    const result = resolveVisibility({
      temporarilyShownColumnIds: new Set(['status-field']),
    });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['status-field', 'todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['status-field', 'done']);
  });

  it('shows empty visible columns after hide empty groups is disabled', () => {
    const result = resolveVisibility({ hideEmptyGroups: false });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['status-field', 'todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['done']);
  });

  it('does not classify columns as empty before row grouping is ready', () => {
    const result = resolveBoardColumnVisibility({
      columns,
      fieldId: 'status-field',
      getRowCount: () => 0,
      groupRowsReady: false,
      hideEmptyGroups: true,
      hideUngroupedColumn: false,
    });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['status-field', 'todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['done']);
  });
});
