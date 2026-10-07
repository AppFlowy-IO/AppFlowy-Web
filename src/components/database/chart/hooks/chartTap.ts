import { ChartType } from '@/application/database-yjs/chart-enums';

/** What a tap (or click) on a chart does (WP14 §1.4.6). */
export type ChartTapAction = 'drill' | 'select' | 'clear';

export interface ChartTapInput {
  /** The mobile context (`useMobileContext()`): touch has no hover, so the first tap shows the tooltip. */
  mobile: boolean;
  chartType: ChartType;
  /** The category whose tooltip a previous tap shows, or `null`. */
  selectedKey: string | null;
  /** The category key of the tapped mark (a segment or a line point taps its category), or `null` outside every mark. */
  tappedKey: string | null;
}

/**
 * How a chart answers a tap, the first rule that applies (pinned by
 * `dashboard-parity/chart-tap.json`; desktop `chart_tap.dart`):
 *
 * - a tap outside every mark clears the selection;
 * - a desktop click drills at once;
 * - the Number chart drills at once (it has no categories);
 * - a tap on the selected category drills;
 * - any other tap selects the category, which shows its tooltip with
 *   "Tap again to view data" until the next tap.
 */
export function resolveChartTap({ mobile, chartType, selectedKey, tappedKey }: ChartTapInput): ChartTapAction {
  if (tappedKey === null) return 'clear';
  if (!mobile) return 'drill';
  if (chartType === ChartType.Number) return 'drill';
  if (selectedKey === tappedKey) return 'drill';
  return 'select';
}
