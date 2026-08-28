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
  columns: overrideColumns = columns,
  hideEmptyGroups = true,
  hideUngroupedColumn = false,
  shownEmptyGroupIds,
}: {
  columns?: { id: string; visible: boolean; visibleExplicit?: boolean }[];
  hideEmptyGroups?: boolean;
  hideUngroupedColumn?: boolean;
  shownEmptyGroupIds?: ReadonlySet<string>;
} = {}) {
  return resolveBoardColumnVisibility({
    columns: overrideColumns,
    fieldId: 'status-field',
    getRowCount: (columnId) => rowCounts.get(columnId) ?? 0,
    groupRowsReady: true,
    hideEmptyGroups,
    hideUngroupedColumn,
    shownEmptyGroupIds,
  });
}

describe('resolveBoardColumnVisibility', () => {
  it('hides empty and explicitly hidden columns when hide empty groups is enabled', () => {
    const result = resolveVisibility();

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['status-field', 'done']);
  });

  it('keeps a shared explicitly shown empty column in both Board and Hidden Groups', () => {
    const result = resolveVisibility({
      shownEmptyGroupIds: new Set(['status-field']),
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

  it('hides the ungrouped column when its persisted visible flag is false (desktop hide)', () => {
    const result = resolveVisibility({
      columns: [
        { id: 'status-field', visible: false, visibleExplicit: true },
        { id: 'todo', visible: true },
      ],
      hideEmptyGroups: false,
      hideUngroupedColumn: false,
    });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['status-field']);
  });

  it('shows an explicitly visible ungrouped column despite a stale legacy hide flag (desktop show)', () => {
    const result = resolveVisibility({
      columns: [
        { id: 'status-field', visible: true, visibleExplicit: true },
        { id: 'todo', visible: true },
      ],
      hideEmptyGroups: false,
      hideUngroupedColumn: true,
    });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['status-field', 'todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual([]);
  });

  it('falls back to the legacy hide flag when the ungrouped column has no explicit visibility', () => {
    const result = resolveVisibility({
      columns: [
        { id: 'status-field', visible: true },
        { id: 'todo', visible: true },
      ],
      hideEmptyGroups: false,
      hideUngroupedColumn: true,
    });

    expect(result.visibleColumns.map((column) => column.id)).toEqual(['todo']);
    expect(result.hiddenColumns.map((column) => column.id)).toEqual(['status-field']);
  });
});
