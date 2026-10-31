import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartLoadingState } from '@/components/database/chart/ChartStates';
import { cn } from '@/lib/utils';

import {
  DASHBOARD_WIDGET_BOX_TRANSITION_CLASS,
  WIDGET_BOX_PADDING,
  WIDGET_HEADER_HEIGHT,
  WIDGET_HEADER_PADDING,
} from '../constants';
import { useDashboardUi } from '../DashboardUiContext';
import { getDashboardFlexBasis } from '../grid-layout';
import { ROW_HEIGHT_CSS_VARIABLE } from '../hooks/useRowHeightResize';

import { useAddWidgetFlowState } from './add-widget-api';
import { DEFAULT_WIDGET_NAMES, DefaultWidgetSpecKind } from './add-widget-flow';

/** Rows of the table skeleton of a pending Table widget. */
const GRID_SKELETON_ROWS = 6;

interface PendingWidgetBoxProps {
  widgetId: string;
  spec: DefaultWidgetSpecKind;
  span: number;
  lineSize: number;
  showWidgetTitles: boolean;
}

/**
 * The widget an add is creating (WP06 §1.1): a selected widget box at its
 * final place, titled with the default view name, with the chart loading
 * state ("Preparing your chart") or a table skeleton until the view exists.
 * It carries the id the persisted widget will have, so the box, the selection
 * and the docked picker stay put when the widget arrives. It loads nothing,
 * so it never takes a slot of the dashboard's load queue.
 */
export const PendingWidgetBox = memo(function PendingWidgetBox({
  widgetId,
  spec,
  span,
  lineSize,
  showWidgetTitles,
}: PendingWidgetBoxProps) {
  const { t } = useTranslation();
  const { addWidget } = useDashboardUi();
  const { dockAnchors } = addWidget;
  const existingOnly = useAddWidgetFlowState(
    addWidget.flow,
    (state) => state.kind === 'choosing_existing' && state.widgetId === widgetId
  );
  const registerAnchor = useMemo(() => dockAnchors.anchorRef(widgetId), [dockAnchors, widgetId]);
  const name = t(spec === 'chart' ? 'dashboard.picker.layout.chart' : 'dashboard.picker.layout.table', {
    defaultValue: DEFAULT_WIDGET_NAMES[spec],
  });

  return (
    <div
      aria-busy={!existingOnly}
      className={cn(
        'group/widget relative isolate flex min-w-0 flex-col rounded-500 bg-dash-edit-tint shadow-[inset_0_0_0_2px_var(--dash-accent)]',
        DASHBOARD_WIDGET_BOX_TRANSITION_CLASS,
        'motion-reduce:transition-none'
      )}
      data-editing='true'
      data-parity-id='dash-widget-box'
      data-selected='true'
      data-testid='dashboard-widget-pending'
      data-widget-id={widgetId}
      style={{
        flex: `1 1 ${getDashboardFlexBasis(span, lineSize)}`,
        height: `var(${ROW_HEIGHT_CSS_VARIABLE})`,
        padding: `${showWidgetTitles ? 0 : WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`,
      }}
    >
      <span
        aria-hidden='true'
        className='pointer-events-none absolute right-0 top-0 h-0 w-0'
        data-dock-anchor='true'
        ref={registerAnchor}
      />
      {showWidgetTitles ? (
        <div
          className='flex min-w-0 shrink-0 items-center'
          data-testid='dashboard-widget-header'
          style={{ height: WIDGET_HEADER_HEIGHT, padding: WIDGET_HEADER_PADDING }}
        >
          <span className='truncate rounded-600 px-2.5 py-1 text-xs font-medium leading-4 text-dash-edit-title'>
            <span data-testid='dashboard-widget-title'>
              {existingOnly ? t('dashboard.picker.chooseExisting', { defaultValue: 'Choose an existing view' }) : name}
            </span>
          </span>
        </div>
      ) : null}
      <div
        className='dash-card relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-400 bg-dash-card-bg'
        data-editing='true'
        data-testid='dashboard-widget-body'
      >
        {existingOnly ? (
          <p className='m-auto px-3 text-sm text-text-secondary'>
            {t('dashboard.picker.chooseExisting', { defaultValue: 'Choose an existing view' })}
          </p>
        ) : spec === 'chart' ? (
          <ChartLoadingState fill />
        ) : (
          <div aria-hidden='true' className='flex flex-col gap-3 px-3 pt-3' data-testid='dashboard-widget-pending-table'>
            {Array.from({ length: GRID_SKELETON_ROWS }, (_, index) => (
              <span className='h-4 w-full rounded bg-chart-empty' key={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default PendingWidgetBox;
