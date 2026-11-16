/**
 * The one text normalization both dashboard clients use for label sorting,
 * option search and the global filter picker:
 * lowercase (root locale) → NFKD → strip combining marks (`\p{M}`) → trim.
 *
 * Desktop mirrors it in `dashboard_text_normalize.dart`; both are pinned by
 * `dashboard-parity/text-normalize.json`. It never uses locale collation, so
 * `ß` stays `ß` and `İ` folds to `i`.
 */
export function normalizeDashboardText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').trim();
}

/** Orders two strings by UTF-16 code unit, as `<` does: the same in every locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of dashboard labels on both clients (`compareChartLabels`, pinned
 * by `dashboard-parity/group-keys.json#labelCompare`), also used for the MCP
 * connected-app names: the texts folded with `normalizeDashboardText`, then as
 * written, both by UTF-16 code unit. Never locale collation.
 */
export function compareDashboardText(a: string, b: string): number {
  return compareCodeUnits(normalizeDashboardText(a), normalizeDashboardText(b)) || compareCodeUnits(a, b);
}
