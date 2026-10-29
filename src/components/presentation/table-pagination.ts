import type { SourceBlock } from './types';

export const TABLE_DENSITIES = ['comfortable', 'compact', 'dense'] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];
export const tableMeasureKey = (key: string, density: TableDensity) => `${key}/table-${density}`;
export const tableRowKey = (key: string, density: TableDensity, row: number) =>
  `${tableMeasureKey(key, density)}/row-${row}`;

export interface TablePage {
  density: TableDensity;
  columnWidths: number[];
  rowStart: number;
  rowEnd: number;
  totalRows: number;
  page: number;
  pageCount: number;
}

export function isSimpleTable(block: SourceBlock) {
  return (
    (block.type === 'simple_table' || block.type === 'table') &&
    block.children.length > 0 &&
    block.children.every((row) => row.type === 'simple_table_row')
  );
}

function cellText(block: SourceBlock): string {
  return `${block.text} ${block.children.map(cellText).join(' ')}`.trim();
}

/** Use original custom proportions, otherwise give descriptive columns more room than short values. */
export function tableColumnWidths(block: SourceBlock): number[] {
  const count = Math.max(1, ...block.children.map((row) => row.children.length));
  const configured = block.table?.columnWidths;
  const weights =
    configured?.length === count && configured.every((width) => Number.isFinite(width) && width > 0)
      ? configured
      : Array.from({ length: count }, (_, index) => {
          const lengths = block.children.map((row) => (row.children[index] ? cellText(row.children[index]).length : 0));

          return Math.sqrt(Math.min(160, Math.max(12, ...lengths)));
        });
  const total = weights.reduce((sum, width) => sum + width, 0);

  return weights.map((width) => (width / total) * 100);
}

/**
 * Prefer one readable slide, then two. Never clip or discard rows to impose a two-slide limit.
 * `condensedTables` collects tables whose comfortable layout needs more than one slide: only their
 * compact and dense measurements can change the result.
 */
export function paginateTable(
  block: SourceBlock,
  key: string,
  heights: Record<string, number>,
  available: number,
  firstPageAvailable = available,
  condensedTables?: Set<string>
) {
  const hasHeader = block.table?.headerRow === true;
  const firstData = hasHeader ? 1 : 0;
  const totalRows = block.children.length - firstData;
  const candidates = TABLE_DENSITIES.map((density) => {
    const rowHeights = block.children.map((_, index) => heights[tableRowKey(key, density, index)] ?? 0);
    const overhead = Math.max(
      0,
      (heights[tableMeasureKey(key, density)] ?? 0) - rowHeights.reduce((sum, height) => sum + height, 0)
    );
    const fixedHeight = overhead + (hasHeader ? rowHeights[0] : 0);
    const capacity = Math.max(1, available - fixedHeight);
    const firstCapacity = Math.max(1, firstPageAvailable - fixedHeight);
    const groups: number[][] = [];
    let group: number[] = [];
    let used = 0;

    for (let row = firstData; row < block.children.length; row++) {
      if (group.length && used + rowHeights[row] > (groups.length ? capacity : firstCapacity)) {
        groups.push(group);
        group = [];
        used = 0;
      }

      group.push(row);
      used += rowHeights[row];
    }

    if (group.length || !groups.length) groups.push(group);
    // Balance a two-slide table instead of leaving one row alone on its continuation.
    if (groups.length === 2) {
      const rows = groups.flat();
      const total = rows.reduce((sum, row) => sum + rowHeights[row], 0);
      let left = 0;
      let bestDifference = Infinity;

      for (let cut = 1; cut < rows.length; cut++) {
        left += rowHeights[rows[cut - 1]];
        const right = total - left;

        const difference = Math.abs(firstCapacity - left - (capacity - right));

        if (left <= firstCapacity && right <= capacity && difference < bestDifference) {
          groups[0] = rows.slice(0, cut);
          groups[1] = rows.slice(cut);
          bestDifference = difference;
        }
      }
    }

    return {
      density,
      groups,
      rowHeights,
      fixedHeight,
      fits: groups.every((rows, page) => rows.every((row) => rowHeights[row] <= (page ? capacity : firstCapacity))),
    };
  });
  const [comfortable] = candidates;

  if (!comfortable.fits || comfortable.groups.length > 1) condensedTables?.add(key);
  const selected =
    candidates.find((candidate) => candidate.fits && candidate.groups.length === 1) ??
    candidates.find((candidate) => candidate.fits && candidate.groups.length === 2) ??
    candidates[candidates.length - 1];
  const columnWidths = tableColumnWidths(block);

  return selected.groups.map((rows, page) => ({
    height: selected.fixedHeight + rows.reduce((sum, row) => sum + selected.rowHeights[row], 0),
    block: {
      ...block,
      children: [...(hasHeader ? [block.children[0]] : []), ...rows.map((row) => block.children[row])],
    },
    // Repeated headers are context, never navigation anchors or duplicated body data.
    sourceKeys: rows.length ? rows.map((row) => `${key}/row-${row}`) : [key],
    layout: {
      density: selected.density,
      columnWidths,
      rowStart: rows.length ? rows[0] - firstData + 1 : 0,
      rowEnd: rows.length ? rows[rows.length - 1] - firstData + 1 : 0,
      totalRows,
      page,
      pageCount: selected.groups.length,
    } satisfies TablePage,
  }));
}
