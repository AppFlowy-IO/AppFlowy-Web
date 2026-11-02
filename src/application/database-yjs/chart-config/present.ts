/**
 * The presentation pipeline of grouped charts (WP11 §1.10): the grouped and
 * aggregated categories in, the drawn items and the Groups page list out.
 * Desktop has the same steps in `ChartPresenter.present`.
 */
import { ChartType } from '../chart-enums';
import { ChartXSort } from '../chart-extended-settings';
import { ChartDataItem } from '../chart.type';

import { supportsCumulative } from './aggregate';
import { ChartGroupHint, EMPTY_GROUP_KEY } from './group-keys';
import { sortChartGroups } from './group-sort';

/** A category after grouping and aggregation. */
export interface AggregatedChartGroup extends Omit<ChartDataItem, 'value' | 'key' | 'hint'> {
  key: string;
  hint: ChartGroupHint;
  /** `null` (no value) is drawn as 0. */
  value: number | null;
}

/** A group as the Groups page lists it (hidden ones included). */
export interface ChartGroupSummary {
  key: string;
  label: string;
  /** Rows in the group. */
  count: number;
  isEmpty: boolean;
  hidden: boolean;
  /** The color it is drawn with (set by the provider). */
  color?: string;
  optionColor?: ChartDataItem['optionColor'];
  checkboxState?: ChartDataItem['checkboxState'];
}

export interface ChartPresentConfig {
  showEmptyValues: boolean;
  cumulative: boolean;
  xSort: ChartXSort;
  xManualOrder: readonly string[];
  hiddenGroups: readonly string[];
  /** The effective aggregation (decides whether Cumulative applies). */
  aggregation: number;
}

export interface PresentedChartGroups {
  visible: ChartDataItem[];
  all: ChartGroupSummary[];
}

/**
 * Drop the empty group when Show empty values is off (or it has no rows),
 * sort, publish every group, leave out the hidden ones, and run the
 * cumulative sum over the visible non-empty groups when it applies.
 */
export function presentChartGroups(
  groups: readonly AggregatedChartGroup[],
  config: ChartPresentConfig,
  chartType: ChartType
): PresentedChartGroups {
  const kept = groups
    .filter((group) => group.key !== EMPTY_GROUP_KEY || (config.showEmptyValues && group.rowIds.length > 0))
    .map((group) => ({ ...group, value: group.value ?? 0 }));
  const sorted = sortChartGroups(kept, config.xSort, config.xManualOrder);
  const hidden = new Set(config.hiddenGroups);
  const all: ChartGroupSummary[] = sorted.map((group) => {
    const summary: ChartGroupSummary = {
      key: group.key,
      label: group.label,
      count: group.rowIds.length,
      isEmpty: group.key === EMPTY_GROUP_KEY,
      hidden: hidden.has(group.key),
    };

    if (group.optionColor) summary.optionColor = group.optionColor;
    if (group.checkboxState) summary.checkboxState = group.checkboxState;
    return summary;
  });
  const visible: ChartDataItem[] = sorted
    .filter((group) => !hidden.has(group.key))
    .map((group) => {
      const item: ChartDataItem = { ...group, isEmptyCategory: group.key === EMPTY_GROUP_KEY };

      return item;
    });

  if (config.cumulative && supportsCumulative(config.aggregation, chartType)) {
    let total = 0;

    visible.forEach((item) => {
      if (item.isEmptyCategory) return;
      total += item.value;
      item.value = total;
    });
  }

  return { visible, all };
}
