import { useTranslation } from 'react-i18next';

import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';

interface ChartEmptyStateProps {
  type: 'no-field' | 'no-data';
}

/**
 * Empty state component for chart view
 * Shows when there's no groupable field or no data
 */
export function ChartEmptyState({ type }: ChartEmptyStateProps) {
  const { t } = useTranslation();

  const content = type === 'no-field' ? {
    title: t('chart.emptyState.noField', 'No fields available for grouping'),
    description: t('chart.emptyState.noFieldDescription', 'Create a SingleSelect, MultiSelect, or Checkbox field to use the chart view.'),
  } : {
    title: t('chart.emptyState.title'),
    description: t('chart.emptyState.description'),
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fill-secondary">
        <ChartIcon className="h-8 w-8 text-icon-secondary" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium text-text-primary">
          {content.title}
        </h3>
        <p className="max-w-md text-sm text-text-secondary">
          {content.description}
        </p>
      </div>
    </div>
  );
}

export default ChartEmptyState;
