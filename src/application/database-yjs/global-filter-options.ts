import { normalizeDashboardText } from '@/utils/normalize-text';

/**
 * Select options merged by name across the sources of one dashboard global
 * filter (WP08 §1.9). Option ids are generated per database, so a select
 * filter stores the selected ids in `content` and, in parallel, their names in
 * `option_names`; each widget's database resolves the names to its own ids.
 *
 * Pure; desktop runs the same rules (`dashboard_global_filter_options.dart`)
 * and both are checked against `dashboard-parity/option-merge.json`.
 */

export interface MergeableOption {
  id: string;
  name: string;
  color?: unknown;
}

/** One entry of the merged value list: the first option of a name, and every id that shares it. */
export interface MergedOptionEntry {
  /** `normalizeDashboardText(name)`, or `#` + id for an option without a name. */
  key: string;
  id: string;
  name: string;
  color: unknown;
  ids: string[];
}

export function splitOptionIds(content: string): string[] {
  return content.split(',').filter(Boolean);
}

/**
 * `optionNames` when it can be read in parallel with `content`: an array of
 * strings, one per id. Anything else is absent (ids are matched as before).
 */
export function usableOptionNames(content: string, optionNames: unknown): string[] | undefined {
  if (!Array.isArray(optionNames) || !optionNames.every((name) => typeof name === 'string')) return undefined;
  return optionNames.length === splitOptionIds(content).length ? (optionNames as string[]) : undefined;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The content of a select global filter for one target database: each id
 * becomes the ids of every target option with the same normalized name, or
 * stays as it is when no option matches. Unusable names or an unloaded
 * source (`targetOptions` null) leave `content` unchanged.
 */
export function resolveGlobalFilterOptionIds(
  content: string,
  optionNames: unknown,
  targetOptions: readonly MergeableOption[] | null | undefined
): string {
  const names = usableOptionNames(content, optionNames);

  if (!names || !targetOptions) return content;
  const ids = splitOptionIds(content);
  const resolved = ids.flatMap((id, index) => {
    const key = normalizeDashboardText(names[index]);
    const matches = key === '' ? [] : targetOptions.filter((option) => normalizeDashboardText(option.name) === key);

    return matches.length > 0 ? matches.map((option) => option.id) : [id];
  });

  return dedupe(resolved).join(',');
}

function optionKey(option: MergeableOption) {
  const key = normalizeDashboardText(option.name);

  return key === '' ? `#${option.id}` : key;
}

/** The union of the options of every loaded target (`null` = not loaded), in target and option order. */
export function mergeOptionLists(
  lists: readonly (readonly MergeableOption[] | null | undefined)[]
): MergedOptionEntry[] {
  const entries: MergedOptionEntry[] = [];
  const byKey = new Map<string, MergedOptionEntry>();

  lists.forEach((options) => {
    options?.forEach((option) => {
      const key = optionKey(option);
      const existing = byKey.get(key);

      if (existing) {
        if (!existing.ids.includes(option.id)) existing.ids.push(option.id);
        return;
      }

      const entry = { key, id: option.id, name: option.name, color: option.color, ids: [option.id] };

      byKey.set(key, entry);
      entries.push(entry);
    });
  });
  return entries;
}

interface SelectionState {
  /** Keys of the checked entries. */
  checked: Set<string>;
  /** Content ids no entry claims (by id or by stored name), with their stored names. */
  unclaimed: { id: string; name: string }[];
}

function readSelection(entries: readonly MergedOptionEntry[], content: string, optionNames: unknown): SelectionState {
  const ids = splitOptionIds(content);
  const names = usableOptionNames(content, optionNames);
  // Same-id databases (copies) can put one id under two names: both are checked.
  const keysById = new Map<string, string[]>();
  const keys = new Set(entries.map((entry) => entry.key));

  entries.forEach((entry) => entry.ids.forEach((id) => keysById.set(id, [...(keysById.get(id) ?? []), entry.key])));
  const checked = new Set<string>();
  const unclaimed: { id: string; name: string }[] = [];

  ids.forEach((id, index) => {
    const byId = keysById.get(id) ?? [];
    const nameKey = names ? normalizeDashboardText(names[index]) : '';
    const byName = nameKey !== '' && keys.has(nameKey) ? nameKey : undefined;

    byId.forEach((key) => checked.add(key));
    if (byName) checked.add(byName);
    if (byId.length === 0 && !byName) unclaimed.push({ id, name: names?.[index] ?? '' });
  });
  return { checked, unclaimed };
}

/** Keys of the entries the stored selection checks (by id, or by a stored name). */
export function checkedMergedKeys(
  entries: readonly MergedOptionEntry[],
  content: string,
  optionNames: unknown
): Set<string> {
  return readSelection(entries, content, optionNames).checked;
}

export interface MergedSelection {
  content: string;
  /** Parallel to `content`; empty when nothing is selected (written as an absent key). */
  optionNames: string[];
}

/**
 * The selection after toggling the entry `key`: the checked entries' first
 * ids and names in merged order, then the ids no entry claims (from a source
 * that is not loaded yet) with their stored names.
 */
export function toggleMergedSelection(
  entries: readonly MergedOptionEntry[],
  content: string,
  optionNames: unknown,
  key: string
): MergedSelection {
  const { checked, unclaimed } = readSelection(entries, content, optionNames);

  if (checked.has(key)) checked.delete(key);
  else checked.add(key);
  return writeSelection(entries, checked, unclaimed);
}

/** The selection with only the given entries checked (plus the unclaimed ids). */
export function setMergedSelection(
  entries: readonly MergedOptionEntry[],
  content: string,
  optionNames: unknown,
  keys: Iterable<string>
): MergedSelection {
  const { unclaimed } = readSelection(entries, content, optionNames);

  return writeSelection(entries, new Set(keys), unclaimed);
}

function writeSelection(
  entries: readonly MergedOptionEntry[],
  checked: ReadonlySet<string>,
  unclaimed: { id: string; name: string }[]
): MergedSelection {
  const selected = entries.filter((entry) => checked.has(entry.key));
  const ids = [...selected.map((entry) => entry.id), ...unclaimed.map((item) => item.id)];
  const names = [...selected.map((entry) => entry.name), ...unclaimed.map((item) => item.name)];

  return { content: ids.join(','), optionNames: ids.length > 0 ? names : [] };
}

/** Names of the selected options: the checked entries in merged order, then the stored names of unclaimed ids. */
export function selectedMergedNames(
  entries: readonly MergedOptionEntry[],
  content: string,
  optionNames: unknown
): string[] {
  const { checked, unclaimed } = readSelection(entries, content, optionNames);

  return [
    ...entries.filter((entry) => checked.has(entry.key)).map((entry) => entry.name),
    ...unclaimed.map((item) => item.name).filter(Boolean),
  ];
}
