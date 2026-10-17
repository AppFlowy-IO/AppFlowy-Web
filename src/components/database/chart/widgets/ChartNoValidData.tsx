import { useTranslation } from 'react-i18next';

/**
 * Note every chart shows in place of its plot when none of its categories can
 * be drawn (desktop's `Center(child: FlowyText(LocaleKeys.chart_noValidData))`
 * in each widget's `_validateData` fallback). It fills the widget root, which
 * keeps its own test id and 400px height.
 */
export function ChartNoValidData() {
  const { t } = useTranslation();

  return (
    <div
      data-testid='chart-no-valid-data'
      className='flex h-full w-full items-center justify-center text-sm text-text-primary'
    >
      {t('chart.noValidData', 'No valid data to display')}
    </div>
  );
}

export default ChartNoValidData;
