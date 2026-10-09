import { useTranslation } from 'react-i18next';

/** The caption's line height and its gap to what is above it (WP12 §2.9). */
export const CHART_TRUNCATION_CAPTION_LINE = 16;
export const CHART_TRUNCATION_CAPTION_GAP = 4;
/** The height the caption takes out of the plot, like the legend. */
export const CHART_TRUNCATION_CAPTION_HEIGHT = CHART_TRUNCATION_CAPTION_LINE + CHART_TRUNCATION_CAPTION_GAP;

/**
 * "Only showing the first {n} groups" (WP12 §2.9): the last line of a chart
 * that left categories or series out (the 200 / 50 caps), centred, 12/16
 * tertiary, 4px below the legend.
 */
export function ChartTruncationCaption({ count }: { count: number | null }) {
  const { t } = useTranslation();

  if (count === null) return null;
  return (
    <div
      className='w-full shrink-0 truncate text-center text-xs font-normal text-text-tertiary'
      data-testid='chart-truncation-caption'
      style={{
        height: CHART_TRUNCATION_CAPTION_HEIGHT,
        paddingTop: CHART_TRUNCATION_CAPTION_GAP,
        lineHeight: `${CHART_TRUNCATION_CAPTION_LINE}px`,
      }}
    >
      {t('chart.settings.onlyShowingFirstGroups', {
        n: count,
        defaultValue: `Only showing the first ${count} groups`,
      })}
    </div>
  );
}

export default ChartTruncationCaption;
