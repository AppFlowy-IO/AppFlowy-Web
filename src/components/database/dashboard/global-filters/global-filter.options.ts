import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import {
  checkedMergedKeys,
  MergedOptionEntry,
  MergedSelection,
  mergeOptionLists,
  selectedMergedNames,
  toggleMergedSelection,
} from '@/application/database-yjs/global-filter-options';

import { getUsableTargets, GlobalFilterSource } from './global-filter.utils';

export type { MergedOptionEntry, MergedSelection } from '@/application/database-yjs/global-filter-options';
export { resolveGlobalFilterOptionIds } from '@/application/database-yjs/global-filter-options';

type SelectionShape = Pick<DashboardGlobalFilter, 'content' | 'optionNames'>;

/**
 * The value list of a select global filter (WP08 §1.9): the options of every
 * usable target, merged by name in target order. The first source gives an
 * entry its colour; every source's id with that name is in `entry.ids`.
 */
export function getMergedGlobalFilterOptions(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[]
): MergedOptionEntry[] {
  return mergeOptionLists(getUsableTargets(filter, sources).map(({ field }) => (field ? field.options : null)));
}

/** Keys of the entries the filter's selection checks. */
export function checkedMergedOptionKeys(entries: readonly MergedOptionEntry[], filter: SelectionShape) {
  return checkedMergedKeys(entries, filter.content, filter.optionNames);
}

/** The selection after toggling one entry: content and option names, written together. */
export function toggleMergedOption(
  filter: SelectionShape,
  entries: readonly MergedOptionEntry[],
  key: string
): MergedSelection {
  return toggleMergedSelection(entries, filter.content, filter.optionNames, key);
}

/** "Clear selection": nothing selected, in any source. */
export const EMPTY_MERGED_SELECTION: MergedSelection = Object.freeze({
  content: '',
  optionNames: [],
}) as MergedSelection;

/** Names of the selected options, for the pill ("Region: Europe"). */
export function mergedSelectedNames(filter: DashboardGlobalFilter, sources: GlobalFilterSource[]): string[] {
  return selectedMergedNames(getMergedGlobalFilterOptions(filter, sources), filter.content, filter.optionNames);
}
