/**
 * Group order of a chart (WP11 §1.7, `x_sort`), pinned by
 * `dashboard-parity/group-keys.json#sort` and `#labelCompare`.
 */
import { normalizeDashboardText } from '@/utils/normalize-text';

import { ChartXSort } from '../chart-extended-settings';

import { ChartGroupHint, EMPTY_GROUP_KEY } from './group-keys';

export interface SortableChartGroup {
  key: string;
  label: string;
  hint: ChartGroupHint;
  /** The aggregated value before cumulative; read by the value sorts. */
  value?: number;
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Label order on both clients: the normalized labels (`normalizeDashboardText`)
 * by UTF-16 code unit, then the raw labels by code unit. Never locale collation.
 */
export function compareChartLabels(a: string, b: string): number {
  return codeUnitCompare(normalizeDashboardText(a), normalizeDashboardText(b)) || codeUnitCompare(a, b);
}

/**
 * Each group's normalized label, read once per sort: `normalizeDashboardText`
 * (NFKD and a mark strip) is too costly to run in every comparison.
 */
type NormalizedLabels = Map<SortableChartGroup, string>;

function normalizeLabels(groups: readonly SortableChartGroup[]): NormalizedLabels {
  return new Map(groups.map((group) => [group, normalizeDashboardText(group.label)]));
}

/** `compareChartLabels` of two groups through the cache. */
function compareGroupLabels(normalized: NormalizedLabels, a: SortableChartGroup, b: SortableChartGroup): number {
  return (
    codeUnitCompare(normalized.get(a) ?? normalizeDashboardText(a.label), normalized.get(b) ?? normalizeDashboardText(b.label)) ||
    codeUnitCompare(a.label, b.label)
  );
}

function isRanked(hint: ChartGroupHint): hint is { rank: number; tie?: string } {
  return 'rank' in hint;
}

/** The default order: ranked groups by rank, then tie, then label; label groups by label; ranked before label. */
function compareAuto(normalized: NormalizedLabels, a: SortableChartGroup, b: SortableChartGroup): number {
  const aRanked = isRanked(a.hint);
  const bRanked = isRanked(b.hint);

  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  if (isRanked(a.hint) && isRanked(b.hint)) {
    const rank = a.hint.rank === b.hint.rank ? 0 : a.hint.rank < b.hint.rank ? -1 : 1;

    if (rank !== 0) return rank;
    const tie = codeUnitCompare(a.hint.tie ?? '', b.hint.tie ?? '');

    if (tie !== 0) return tie;
  }

  // Equal labels (two unknown people) fall back to the key, so both clients agree.
  return compareGroupLabels(normalized, a, b) || codeUnitCompare(a.key, b.key);
}

function valueOf(group: SortableChartGroup): number {
  return typeof group.value === 'number' && Number.isFinite(group.value) ? group.value : 0;
}

/**
 * `groups` in `xSort` order. The empty group is always last. `manual` puts the
 * keys of `manualOrder` first, in that order (keys not in the data are
 * skipped), and the rest after them in the default order.
 */
export function sortChartGroups<T extends SortableChartGroup>(
  groups: readonly T[],
  xSort: ChartXSort,
  manualOrder: readonly string[] = []
): T[] {
  const empty = groups.filter((group) => group.key === EMPTY_GROUP_KEY);
  const rest = groups.filter((group) => group.key !== EMPTY_GROUP_KEY);
  const normalized = normalizeLabels(rest);
  const auto = (a: T, b: T) => compareAuto(normalized, a, b);
  let compare: (a: T, b: T) => number;

  switch (xSort) {
    case 'manual': {
      const position = new Map<string, number>();

      manualOrder.forEach((key, index) => {
        if (!position.has(key)) position.set(key, index);
      });
      compare = (a, b) => {
        const pa = position.get(a.key);
        const pb = position.get(b.key);

        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return auto(a, b);
      };

      break;
    }

    case 'label_asc':
      compare = (a, b) => compareGroupLabels(normalized, a, b) || auto(a, b);
      break;
    case 'label_desc':
      compare = (a, b) => compareGroupLabels(normalized, b, a) || auto(a, b);
      break;
    case 'value_desc':
      compare = (a, b) => valueOf(b) - valueOf(a) || auto(a, b);
      break;
    case 'value_asc':
      compare = (a, b) => valueOf(a) - valueOf(b) || auto(a, b);
      break;
    case 'auto':
    default:
      compare = auto;
  }

  return [...rest].sort(compare).concat(empty);
}
