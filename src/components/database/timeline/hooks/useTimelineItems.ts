import { useMemo } from 'react';

import type { DatabaseGrouping, GridGroup } from '@/application/database-yjs';

import { TimelineRowModel } from './useTimelineRows';

export type TimelineItem =
  | { kind: 'row'; key: string; row: TimelineRowModel; groupId?: string }
  | { kind: 'group'; key: string; group: GridGroup }
  | { kind: 'footer'; key: string; group: GridGroup };

/**
 * The vertical sequence the canvas renders: plain rows, or — when the view is
 * grouped — a header per visible group, its rows unless collapsed, and a
 * "+ New" footer (editors only). Every item is one row tall so bar and arrow
 * geometry stays index-based.
 */
export function useTimelineItems(
  rows: TimelineRowModel[],
  grouping: DatabaseGrouping,
  withFooters: boolean
): TimelineItem[] {
  return useMemo(() => {
    if (!grouping.isGrouped) return rows.map((row) => ({ kind: 'row' as const, key: row.rowId, row }));
    const byId = new Map(rows.map((row) => [row.rowId, row] as const));
    const items: TimelineItem[] = [];

    grouping.visibleGroups.forEach((group) => {
      items.push({ kind: 'group', key: `group:${group.id}`, group });
      if (group.collapsed) return;
      group.rows.forEach(({ id }) => {
        const row = byId.get(id);

        if (row) items.push({ kind: 'row', key: `row:${group.id}:${id}`, row, groupId: group.id });
      });
      if (withFooters) items.push({ kind: 'footer', key: `footer:${group.id}`, group });
    });

    return items;
  }, [grouping.isGrouped, grouping.visibleGroups, rows, withFooters]);
}
