import dayjs from 'dayjs';

/**
 * How the value of a filter is written into its `content`, per property type.
 * One implementation for every filter editor (a view filter and a dashboard
 * global filter store the same string for the same pick), matching what
 * desktop reads.
 */

/**
 * What a number filter input accepts while typing: an optional minus, digits
 * and at most one decimal point (desktop `_NumberFilterTextFormatter`). An edit
 * that does not match is rejected and the previous text stays.
 */
export const NUMBER_INPUT_PATTERN = /^-?\d*\.?\d*$/;

/**
 * Select content after toggling `optionId`: the selected option ids joined by
 * commas, in field option order (desktop parity). Without `options` (the
 * field is not resolved) the selection keeps its own order.
 */
export function toggleSelectOptionContent(
  selectedIds: readonly string[],
  optionId: string,
  options?: readonly { id: string }[] | null
): string {
  const selected = new Set(selectedIds);

  if (!selected.delete(optionId)) selected.add(optionId);
  return orderSelectOptionContent(selected, options);
}

/**
 * Select content for `selected`: only the ids that exist on the field, in
 * field option order. Without `options` every id is kept, in its own order.
 */
export function orderSelectOptionContent(
  selected: ReadonlySet<string>,
  options?: readonly { id: string }[] | null
): string {
  const ordered = options
    ? options.filter((option) => option && selected.has(option.id)).map((option) => option.id)
    : [...selected];

  return ordered.filter((id) => id !== '').join(',');
}

/** Person content after toggling `personId`: a JSON array of ids, in selection order. */
export function togglePersonContent(selectedIds: readonly string[], personId: string): string {
  return JSON.stringify(
    selectedIds.includes(personId) ? selectedIds.filter((id) => id !== personId) : [...selectedIds, personId]
  );
}

/** The value of a date filter: one day, or the two ends of a range (unix seconds). */
export interface DateFilterValue {
  timestamp?: number;
  start?: number;
  end?: number;
}

/** The unix seconds a picked calendar day is stored as. */
export function dateToFilterTimestamp(date: Date | undefined): number | undefined {
  return date ? dayjs(date).unix() : undefined;
}

/**
 * Date content: `{"timestamp"}` for one day, `{"start","end"}` for a range.
 * Desktop deserializes `Option<i64>`, where an empty string fails and silently
 * degrades the filter, so a missing day or range start is written as `null`.
 */
export function serializeDateFilterContent(isRange: boolean, value: DateFilterValue): string {
  return JSON.stringify(
    isRange ? { start: value.start ?? null, end: value.end } : { timestamp: value.timestamp ?? null }
  );
}

/** The content a picked calendar selection is stored as (see `serializeDateFilterContent`). */
export function dateSelectionToFilterContent(isRange: boolean, selection: { from?: Date; to?: Date }): string {
  return serializeDateFilterContent(
    isRange,
    isRange
      ? { start: dateToFilterTimestamp(selection.from), end: dateToFilterTimestamp(selection.to) }
      : { timestamp: dateToFilterTimestamp(selection.from) }
  );
}
