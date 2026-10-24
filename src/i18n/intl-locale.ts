/**
 * The app language → Intl locale mapping (WP14 §1.6.4). Pure and dependency
 * free (no imports), so `chart-format.ts` and the playwright steps that import
 * it can use it; React code reads it through `useAppLocale`.
 */

/** The locale charts format with when the app language has no platform data. */
export const FALLBACK_INTL_LOCALE = 'en-US';

/**
 * App languages whose translation file stem is not the locale the platform
 * formats with, as `dashboard-parity/date-labels.json` `locale_map` pins them
 * (desktop `chart_date_labels.dart` has the same table).
 */
export const INTL_LOCALE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  en: 'en-US',
  hin: 'hi',
  zh: 'zh-CN',
  pt: 'pt-BR',
});

const resolved = new Map<string, string>();

/**
 * The Intl locale of an app language: underscores become hyphens, the
 * aliases apply (`en → en-US`, `hin → hi`, `zh → zh-CN`, `pt → pt-BR`), and a
 * tag the platform has no date data for (or an invalid or empty one) falls
 * back to `en-US`. The one mapping every chart formatter uses; the default
 * locale of `Intl` is never changed.
 */
export function toIntlLocale(language: string | null | undefined): string {
  const tag = (language ?? '').trim().replace(/_/g, '-');

  if (!tag) return FALLBACK_INTL_LOCALE;
  const cached = resolved.get(tag);

  if (cached !== undefined) return cached;
  const candidate = INTL_LOCALE_ALIASES[tag] ?? tag;
  let locale = FALLBACK_INTL_LOCALE;

  try {
    if (Intl.DateTimeFormat.supportedLocalesOf(candidate).length > 0) locale = candidate;
  } catch {
    // An invalid tag throws a RangeError.
  }

  resolved.set(tag, locale);
  return locale;
}
