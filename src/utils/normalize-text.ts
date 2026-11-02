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
