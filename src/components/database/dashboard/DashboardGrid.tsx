import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import { Fragment, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { countDashboardWidgets } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_MAX_WIDGETS } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_EDGE_DROP_ZONE_HEIGHT, DASHBOARD_EDIT_ROW_GAP, DASHBOARD_ROW_GAP } from './constants';
import { useDashboardContext } from './DashboardContext';
import { DashboardLimitMessage } from './DashboardLimitMessage';
import { DashboardRow } from './DashboardRow';
import { useDashboardUi } from './DashboardUiContext';
import { useRowGapDropTarget } from './hooks/useDashboardDnd';
import { useStackedLayout } from './hooks/useStackedLayout';

function RowGapDropZone({ rowIndex, height }: { rowIndex: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { dndInstanceId, getRows, draggingWidgetId } = useDashboardUi();
  const active = useRowGapDropTarget({
    elementRef: ref,
    rowIndex,
    instanceId: dndInstanceId,
    enabled: true,
    getRows,
  });

  return (
    <div
      aria-hidden='true'
      className='relative w-full shrink-0'
      data-active={active ? 'true' : undefined}
      data-dragging={draggingWidgetId ? 'true' : undefined}
      data-row-index={rowIndex}
      data-testid='dashboard-row-drop-zone'
      ref={ref}
      style={{ height }}
    >
      {active ? (
        <div className='absolute inset-x-0 top-1/2 h-0'>
          <DropIndicator edge='top' type='terminal-no-bleed' />
        </div>
      ) : null}
    </div>
  );
}

export function AddWidgetButton({ onAdd, className }: { onAdd: () => void; className?: string }) {
  const { t } = useTranslation();
  const { rows } = useDashboardContext();
  const { showLimitMessage } = useDashboardUi();
  const full = countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS;
  const button = (
    <Button
      className={cn(
        'w-full justify-center border border-dashed border-border-primary text-text-secondary hover:border-border-primary-hover hover:text-text-primary',
        className
      )}
      data-testid='dashboard-add-widget-button'
      disabled={full}
      onClick={onAdd}
      size='lg'
      type='button'
      variant='ghost'
    >
      <PlusIcon aria-hidden='true' className='h-5 w-5' />
      {t('dashboard.addWidget', { defaultValue: 'Add widget' })}
    </Button>
  );

  if (!full) return button;

  // A disabled button ignores the pointer: the wrapper takes the click and
  // repeats the reason, and a quiet hint stays under the button.
  return (
    <div className='flex w-full flex-col gap-1.5'>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='flex w-full' onClick={() => showLimitMessage('dashboard')}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t('dashboard.widgetLimit', {
            count: DASHBOARD_MAX_WIDGETS,
            defaultValue: 'Dashboards support up to {{count}} widgets.',
          })}
        </TooltipContent>
      </Tooltip>
      <DashboardLimitMessage reason='dashboard' variant='inline' />
    </div>
  );
}

/**
 * The rows of a non-empty dashboard. In Edit mode the gaps between rows (and
 * above the first / below the last) are drop zones that create a new row, and
 * an "Add widget" button follows the last row.
 */
export function DashboardGrid() {
  const { rows, isEditing, canEdit } = useDashboardContext();
  const { openPicker } = useDashboardUi();
  const gridRef = useRef<HTMLDivElement>(null);
  const stacked = useStackedLayout(gridRef);
  const editing = isEditing && canEdit;

  return (
    <div
      className='flex w-full flex-col'
      data-stacked={stacked ? 'true' : 'false'}
      data-testid='dashboard-grid'
      ref={gridRef}
    >
      {editing ? <RowGapDropZone height={DASHBOARD_EDGE_DROP_ZONE_HEIGHT} rowIndex={0} /> : null}
      {rows.map((row, rowIndex) => (
        <Fragment key={row.id}>
          <DashboardRow row={row} rowIndex={rowIndex} stacked={stacked} />
          {editing ? (
            <RowGapDropZone height={DASHBOARD_EDIT_ROW_GAP} rowIndex={rowIndex + 1} />
          ) : rowIndex < rows.length - 1 ? (
            <div aria-hidden='true' className='w-full shrink-0' style={{ height: DASHBOARD_ROW_GAP }} />
          ) : null}
        </Fragment>
      ))}
      {editing ? (
        <AddWidgetButton className='mt-2' onAdd={() => openPicker({ mode: 'add', placement: { type: 'new_row' } })} />
      ) : null}
    </div>
  );
}

export default DashboardGrid;
