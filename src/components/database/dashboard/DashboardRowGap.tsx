import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import { memo, ReactNode, useRef } from 'react';

import { cn } from '@/lib/utils';

import { DASHBOARD_GRID_TOP_BAND, DASHBOARD_ROW_GAP } from './constants';
import { useDashboardDraggingWidgetId, useDashboardUi } from './DashboardUiContext';
import { useRowGapDropTarget } from './hooks/useDashboardDnd';

/**
 * The band in front of row `rowIndex` as a drop target: dropping a widget
 * here puts it in a new row at that index. Spans the row track (the content
 * column plus the box bleed) and only catches the pointer while a widget is
 * dragged, so the height handle inside it works the rest of the time.
 */
function RowGapDropZone({ rowIndex, children }: { rowIndex: number; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { dndInstanceId, getRows } = useDashboardUi();
  const draggingWidgetId = useDashboardDraggingWidgetId();
  const active = useRowGapDropTarget({
    elementRef: ref,
    rowIndex,
    instanceId: dndInstanceId,
    enabled: true,
    getRows,
  });

  return (
    <div
      className={cn('absolute -inset-x-1.5 inset-y-0', !draggingWidgetId && 'pointer-events-none')}
      data-active={active ? 'true' : undefined}
      data-dragging={draggingWidgetId ? 'true' : undefined}
      data-row-index={rowIndex}
      data-testid='dashboard-row-drop-zone'
      ref={ref}
    >
      {children}
      {active ? (
        <div aria-hidden='true' className='absolute inset-x-0 top-1/2 h-0'>
          <DropIndicator edge='top' type='terminal-no-bleed' />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The band above row `index` (0 = above the first row): 12px before the first
 * row, 16px between rows and after the last one, in View and Edit mode alike,
 * so entering Edit mode moves nothing. In Edit mode it is a drop zone and
 * hosts the height handle of the row above it (`children`).
 */
export const DashboardRowGap = memo(function DashboardRowGap({
  index,
  editing,
  children,
}: {
  index: number;
  editing: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden={editing ? undefined : 'true'}
      className='relative w-full shrink-0'
      data-gap-index={index}
      data-testid='dashboard-row-gap'
      style={{ height: index === 0 ? DASHBOARD_GRID_TOP_BAND : DASHBOARD_ROW_GAP }}
    >
      {editing ? <RowGapDropZone rowIndex={index}>{children}</RowGapDropZone> : null}
    </div>
  );
});

export default DashboardRowGap;
