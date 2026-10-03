import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { computeDonutGeometry } from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { useElementSize } from '@/components/database/chart/hooks/useElementSize';
import { STANDALONE_CHART_HEIGHT } from '@/components/database/chart/widgets/ChartFrame';
import { cn } from '@/lib/utils';

const { skeleton, insetWidget } = DASHBOARD_CHART_GEOMETRY;

/** The states share the chart frame's box: they fill a widget card (inside its insets) or take the standalone height. */
function StateBox({
  fill,
  testId,
  children,
  className,
}: {
  fill?: boolean;
  testId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex w-full flex-col items-center justify-center text-center', fill && 'h-full min-h-0 flex-1', className)}
      data-testid={testId}
      style={
        fill
          ? { padding: `${insetWidget.top}px ${insetWidget.right}px ${insetWidget.bottom}px ${insetWidget.left}px` }
          : { height: STANDALONE_CHART_HEIGHT }
      }
    >
      {children}
    </div>
  );
}

/** "Preparing your chart" under a skeleton bar glyph (spec §8.9); replaces the spinner. */
export function ChartLoadingState({ fill }: { fill?: boolean }) {
  const { t } = useTranslation();

  return (
    <StateBox fill={fill} testId='chart-loading'>
      <div className='flex flex-col items-center' data-parity-id='dash-chart-loading'>
        <div aria-hidden className='flex items-end' data-testid='chart-loading-skeleton' style={{ gap: skeleton.gap }}>
          {skeleton.heights.map((height, index) => (
            <span
              className='bg-chart-empty'
              key={index}
              style={{ width: skeleton.barWidth, height, borderRadius: 2 }}
            />
          ))}
        </div>
        <div className='mt-2 text-xs text-text-tertiary'>
          {t('chart.state.preparing', { defaultValue: 'Preparing your chart' })}
        </div>
      </div>
    </StateBox>
  );
}

/** The empty donut: the ring of §1.3 without a legend, in `chart.empty`, with "No data" inside. */
function EmptyDonut() {
  const { t } = useTranslation();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const geometry = computeDonutGeometry(size.width, size.height, 0, false);
  const ready = geometry.outer > 0;

  return (
    <div className='relative min-h-0 w-full flex-1 self-stretch' ref={ref}>
      {ready ? (
        <svg className='absolute left-0 top-0' data-testid='chart-donut-empty-ring' height={size.height} width={size.width}>
          <circle
            cx={size.width / 2}
            cy={size.height / 2}
            fill='none'
            r={(geometry.outer + geometry.inner) / 2}
            stroke='var(--chart-empty)'
            strokeWidth={geometry.thickness}
          />
        </svg>
      ) : null}
      <div className='absolute inset-0 flex items-center justify-center'>
        <span className='text-xs text-text-tertiary' data-parity-id='dash-chart-empty'>
          {t('chart.state.noData', { defaultValue: 'No data' })}
        </span>
      </div>
    </div>
  );
}

/** "No data" centred in the unchanged card; a donut shows its empty ring around it. */
export function ChartNoDataState({ fill, variant }: { fill?: boolean; variant?: 'donut' }) {
  const { t } = useTranslation();

  return (
    <StateBox fill={fill} testId='chart-no-data'>
      {variant === 'donut' ? (
        <EmptyDonut />
      ) : (
        <span className='text-sm text-text-tertiary' data-parity-id='dash-chart-empty'>
          {t('chart.state.noData', { defaultValue: 'No data' })}
        </span>
      )}
    </StateBox>
  );
}

/**
 * "No fields available for grouping": the database has no field a chart can
 * group by. It keeps its own box (the card's `p-8`, not the chart insets).
 */
export function ChartNoFieldState({ fill }: { fill?: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      className={cn('flex w-full flex-1 flex-col items-center justify-center p-8 text-center', fill && 'h-full min-h-0')}
      data-testid='chart-no-field'
    >
      <p className='max-w-md text-sm text-text-tertiary'>
        {t('chart.emptyState.noField', 'No fields available for grouping')}
      </p>
    </div>
  );
}

/** "Couldn't load this chart" with a Retry button (state-07). */
export function ChartErrorState({ fill, onRetry }: { fill?: boolean; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <StateBox className='gap-2' fill={fill} testId='chart-error'>
      <InfoIcon className='h-5 w-5 text-icon-tertiary' />
      <div className='text-sm text-text-secondary'>{t('chart.state.error', { defaultValue: "Couldn't load this chart" })}</div>
      <button
        className='h-7 rounded-200 px-2.5 text-sm text-text-primary hover:bg-fill-content-hover'
        data-testid='chart-error-retry'
        onClick={onRetry}
        type='button'
      >
        {t('chart.state.retry', { defaultValue: 'Retry' })}
      </button>
    </StateBox>
  );
}
