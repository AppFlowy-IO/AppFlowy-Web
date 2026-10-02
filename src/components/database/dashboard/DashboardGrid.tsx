import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { countDashboardWidgets } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_MAX_WIDGETS } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_WIDGET_BOX_INSET } from './constants';
import { useDashboardContext, useDashboardLayout } from './DashboardContext';
import { DashboardLimitMessage } from './DashboardLimitMessage';
import { DashboardRow } from './DashboardRow';
import { DashboardRowGap } from './DashboardRowGap';
import { useDashboardHost, useDashboardUi } from './DashboardUiContext';
import { dashboardMinWidgetColumns, dashboardWrapColumns } from './grid-layout';
import { useDashboardGridWidth } from './hooks/useDashboardGridWidth';
import { preloadWidgetPicker } from './WidgetPicker';

export function AddWidgetButton({
  onAdd,
  className,
  emptyState = false,
}: {
  onAdd: () => void;
  className?: string;
  /** Rendered by the empty dashboard (its "New view" slot) rather than after the last row. */
  emptyState?: boolean;
}) {
  const { t } = useTranslation();
  const { rows } = useDashboardLayout();
  const { showLimitMessage } = useDashboardUi();
  const { workspaceId, variant } = useDashboardHost();
  const full = countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS;
  const preloadPicker = useCallback(() => preloadWidgetPicker(workspaceId, variant), [variant, workspaceId]);
  const button = (
    <Button
      className={cn(
        'w-full justify-center border border-dashed border-border-primary text-text-secondary hover:border-border-primary-hover hover:text-text-primary',
        className
      )}
      data-parity-id={emptyState ? 'dash-empty-new-view' : 'dash-grid-add-row'}
      data-testid='dashboard-add-widget-button'
      disabled={full}
      onClick={onAdd}
      onFocus={preloadPicker}
      onPointerEnter={preloadPicker}
      size='lg'
      type='button'
      variant='ghost'
    >
      <PlusIcon
        aria-hidden='true'
        className='h-5 w-5'
        data-parity-id={emptyState ? 'dash-empty-new-view__icon' : 'dash-grid-add-row__icon'}
      />
      <span data-parity-id={emptyState ? 'dash-empty-new-view__label' : 'dash-grid-add-row__label'}>
        {t('dashboard.addWidget', { defaultValue: 'Add widget' })}
      </span>
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
 * The rows of a non-empty dashboard, each followed by its band (12px before
 * the first row, 16px between rows), with the same geometry in View and Edit
 * mode. In Edit mode the bands are drop zones that create a new row and host
 * the height handles, and an "Add widget" button follows the last row.
 *
 * The grid measures its content width once and hands every row only its wrap
 * columns and resize minimum, so a window resize re-renders a row only when
 * one of them changes.
 */
export const DashboardGrid = memo(function DashboardGrid() {
  const { isEditing, canEdit } = useDashboardContext();
  const { rows, showWidgetTitles, showIconsInHeading } = useDashboardLayout();
  const { openPicker } = useDashboardUi();
  const gridRef = useRef<HTMLDivElement>(null);
  const gridWidth = useDashboardGridWidth(gridRef);
  // Every row track bleeds the box inset past the content column on both sides.
  const trackWidth = gridWidth === null ? null : gridWidth + 2 * DASHBOARD_WIDGET_BOX_INSET;
  const editing = isEditing && canEdit;
  const dashboardFull = countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS;

  return (
    <div
      // The grid box bleeds like the tracks (the padding keeps its content on
      // the column), so it measures as wide as its rows. Visually neutral.
      className='-mx-1.5 flex flex-col px-1.5'
      data-parity-id='dash-grid'
      data-testid='dashboard-grid'
      data-track-width={trackWidth ?? ''}
      ref={gridRef}
    >
      <DashboardRowGap editing={editing} index={0} />
      {rows.map((row, rowIndex) => {
        const count = row.widgets.length;

        return (
          <DashboardRow
            canEdit={canEdit}
            dashboardFull={dashboardFull}
            isEditing={isEditing}
            key={row.id}
            // An unmeasured grid never wraps a row.
            minColumns={trackWidth === null ? 1 : dashboardMinWidgetColumns(trackWidth, count)}
            row={row}
            rowIndex={rowIndex}
            showIconsInHeading={showIconsInHeading}
            showWidgetTitles={showWidgetTitles}
            wrapColumns={trackWidth === null ? count : dashboardWrapColumns(trackWidth, count)}
          />
        );
      })}
      {editing ? <AddWidgetButton onAdd={() => openPicker({ mode: 'add', placement: { type: 'new_row' } })} /> : null}
    </div>
  );
});

export default DashboardGrid;
