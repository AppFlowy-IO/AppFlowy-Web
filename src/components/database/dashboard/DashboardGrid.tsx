import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { canAddDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { DASHBOARD_WIDGET_BOX_INSET } from './constants';
import { useDashboardContext, useDashboardLayout } from './DashboardContext';
import { DashboardLimitMessage, LimitedAction } from './DashboardLimitMessage';
import { DashboardRow } from './DashboardRow';
import { DashboardRowGap } from './DashboardRowGap';
import { useDashboardHost, useDashboardUi } from './DashboardUiContext';
import { useDashboardGridBreakpoints } from './hooks/useDashboardGridBreakpoints';
import { preloadWidgetPicker } from './WidgetPicker';

export function AddWidgetButton({
  onAdd,
  className,
  emptyState = false,
  full = false,
}: {
  onAdd: () => void;
  className?: string;
  /** Rendered by the empty dashboard (its "New view" slot) rather than after the last row. */
  emptyState?: boolean;
  /** The dashboard holds its maximum number of widgets. */
  full?: boolean;
}) {
  const { t } = useTranslation();
  const { workspaceId, variant } = useDashboardHost();
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

  // The wrapper repeats the reason on click, and a quiet hint stays under the button.
  return (
    <div className='flex w-full flex-col gap-1.5'>
      <LimitedAction limit='dashboard' wrapperClassName='flex w-full'>
        {button}
      </LimitedAction>
      <DashboardLimitMessage reason='dashboard' variant='inline' />
    </div>
  );
}

const GRID_BLEED_STYLE = {
  marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
  marginRight: -DASHBOARD_WIDGET_BOX_INSET,
  paddingLeft: DASHBOARD_WIDGET_BOX_INSET,
  paddingRight: DASHBOARD_WIDGET_BOX_INSET,
};

/**
 * The rows of a non-empty dashboard, each followed by its band (12px before
 * the first row, 16px between rows), with the same geometry in View and Edit
 * mode. In Edit mode the bands are drop zones that create a new row and host
 * the height handles, and an "Add widget" button follows the last row.
 *
 * The grid follows its measured width only through the wrap columns and the
 * resize minimum it hands every row (`useDashboardGridBreakpoints`), so a
 * window resize re-renders the grid and a row only when one of them changes.
 */
export const DashboardGrid = memo(function DashboardGrid() {
  const { isEditing, canEdit } = useDashboardContext();
  const { rows, showWidgetTitles, showIconsInHeading } = useDashboardLayout();
  const { openPicker } = useDashboardUi();
  const gridRef = useRef<HTMLDivElement>(null);
  const breakpoints = useDashboardGridBreakpoints(gridRef);
  const editing = isEditing && canEdit;
  const dashboardFull = !canAddDashboardWidget(rows);

  return (
    <div
      // The grid box bleeds like the tracks (the padding keeps its content on
      // the column), so it measures as wide as its rows. Visually neutral.
      className='flex flex-col'
      data-parity-id='dash-grid'
      data-testid='dashboard-grid'
      ref={gridRef}
      style={GRID_BLEED_STYLE}
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
            minColumns={breakpoints?.minColumns[count] ?? 1}
            row={row}
            rowIndex={rowIndex}
            showIconsInHeading={showIconsInHeading}
            showWidgetTitles={showWidgetTitles}
            wrapColumns={breakpoints?.wrapColumns[count] ?? count}
          />
        );
      })}
      {editing ? (
        <AddWidgetButton
          full={dashboardFull}
          onAdd={() => openPicker({ mode: 'add', placement: { type: 'new_row' } })}
        />
      ) : null}
    </div>
  );
});

export default DashboardGrid;
