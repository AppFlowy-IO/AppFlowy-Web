import { useTranslation } from 'react-i18next';

import { ChartAggregationType } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

/** Width desktop reserves next to the Y axis for the rotated title. */
export const CHART_TITLE_VERTICAL_WIDTH = 18;

const AGGREGATION_LABELS: Record<ChartAggregationType, { key: string; fallback: string }> = {
  [ChartAggregationType.Count]: { key: 'chart.tooltip.count', fallback: 'Count' },
  [ChartAggregationType.CountValues]: { key: 'chart.tooltip.countValues', fallback: 'Count values' },
  [ChartAggregationType.Sum]: { key: 'chart.tooltip.sum', fallback: 'Sum' },
  [ChartAggregationType.Average]: { key: 'chart.tooltip.average', fallback: 'Average' },
  [ChartAggregationType.Min]: { key: 'chart.tooltip.min', fallback: 'Min' },
  [ChartAggregationType.Max]: { key: 'chart.tooltip.max', fallback: 'Max' },
  [ChartAggregationType.Median]: { key: 'chart.tooltip.median', fallback: 'Median' },
};

/** Localized aggregation name (desktop's `ChartUtils.aggregationLabel`). */
export function useChartAggregationLabel(aggregationType?: ChartAggregationType | null): string | null {
  const { t } = useTranslation();

  if (aggregationType === undefined || aggregationType === null) return null;
  const label = AGGREGATION_LABELS[aggregationType];

  return label ? t(label.key, label.fallback) : null;
}

interface ChartTitleProps {
  label: string;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/**
 * Aggregation title drawn next to the value axis (desktop's `ChartTitle`).
 * Desktop composes it as `label(<grid.formula.type>)`, e.g. "Count(Type)";
 * the suffix is the same fixed string on every chart, not a field name.
 *
 * Vertical titles are rotated -90° (reading bottom to top) inside a reserved
 * 18px column, right-aligned against the axis labels.
 */
export function ChartTitle({ label, orientation = 'vertical', className }: ChartTitleProps) {
  const { t } = useTranslation();
  const text = `${label}(${t('grid.formula.type', 'Type')})`;

  if (orientation === 'horizontal') {
    return (
      <div
        data-testid='chart-title'
        className={cn('whitespace-nowrap text-center text-sm leading-5 text-text-primary', className)}
      >
        {text}
      </div>
    );
  }

  return (
    <div
      data-testid='chart-title'
      className={cn('relative flex shrink-0 items-center justify-end', className)}
      style={{ width: CHART_TITLE_VERTICAL_WIDTH }}
    >
      <span
        className='absolute right-0 top-1/2 origin-center whitespace-nowrap text-sm leading-5 text-text-primary'
        style={{ transform: 'translate(calc(50% - 10px), -50%) rotate(-90deg)' }}
      >
        {text}
      </span>
    </div>
  );
}

export default ChartTitle;
