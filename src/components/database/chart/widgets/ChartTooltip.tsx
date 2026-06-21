import { useTranslation } from 'react-i18next';

interface ChartTooltipProps {
  label?: string;
  value?: number;
  color?: string;
  percent?: number;
  showDrilldownHint?: boolean;
}

/**
 * Custom tooltip component for chart display
 */
export function ChartTooltip({ label, value, color, percent, showDrilldownHint = true }: ChartTooltipProps) {
  const { t } = useTranslation();

  const displayValue = percent !== undefined
    ? `${value?.toLocaleString()} (${(percent * 100).toFixed(1)}%)`
    : value?.toLocaleString();

  return (
    <div className="rounded-lg border border-border-primary bg-fill-primary px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-text-primary">
        {displayValue}
      </div>
      {showDrilldownHint && (
        <div className="mt-1 text-xs text-text-secondary">
          {t('chart.tooltip.clickToView', 'Click to view data')}
        </div>
      )}
    </div>
  );
}

export default ChartTooltip;
