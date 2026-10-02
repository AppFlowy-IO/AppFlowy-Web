/**
 * R-FORMAT (WP10 §1.2): the one formatter for every number a chart prints
 * (axis ticks, data labels, tooltips, the donut centre and the Number card).
 * Desktop has the same function in `chart_format.dart`; both are driven by
 * `dashboard-parity/format-vectors.json`, so change the fixture first.
 *
 * Pure and dependency free (relative imports only): playwright steps import it
 * to compute the text a chart must show.
 */

export type ChartValueMode = 'axis' | 'label' | 'tooltip' | 'center' | 'card';

/** The Y field as the formatter needs it; ids are the shared `NumberFormat` / `DateFormat` ints. */
export interface ChartFormatYField {
  type: 'number' | 'checkbox' | 'date' | 'other';
  numberFormat?: number | null;
  dateFormat?: number | null;
}

export interface ChartFormatContext {
  /** The effective aggregation (0 when a non-Count aggregation has no Y field). */
  aggregation: number;
  yField?: ChartFormatYField | null;
  mode: ChartValueMode;
  /** `decimal_places`: 0–5, or null / absent for auto. */
  decimalPlaces?: number | null;
  /** The Number chart's `numberFormat`, read only in `card` mode. */
  numberFormat?: 'auto' | 'compact' | 'percent';
  /** A BCP-47 tag from `resolveChartLocale`. */
  locale: string;
  /** Only for date aggregations; local time when absent. */
  timeZone?: string;
  /** Localized "N days" for the date-range aggregation. */
  labels?: { days: (count: number) => string };
}

// Shared `NumberFormat` ids (web `fields/number/number.type.ts`, desktop `NumberFormatPB`).
const NUMBER_FORMAT_NUM = 0;
const NUMBER_FORMAT_PERCENT = 36;

/** Count, Count values, and WP11's Count empty / Count not empty. */
const COUNT_AGGREGATIONS = new Set([0, 6, 7, 8]);
/** WP11's percent aggregations; the value is in percentage points (0–100). */
const PERCENT_AGGREGATIONS = new Set([9, 10, 11, 12]);
/** WP11's earliest and latest date; the value is days since the Unix epoch. */
const DATE_AGGREGATIONS = new Set([13, 14]);
/** WP11's date range; the value is a number of days. */
const DATE_RANGE_AGGREGATION = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Currency affixes for the compact path, by `NumberFormat` id (the cells'
 * own formatter prints the non-compact path). `\u00a0` is a no-break space.
 */
export const CHART_CURRENCY_AFFIXES: Readonly<Record<number, { prefix?: string; suffix?: string }>> = {
  1: { prefix: '$' },
  2: { prefix: 'CA$' },
  4: { prefix: '€' },
  5: { prefix: '£' },
  6: { prefix: '￥' },
  7: { suffix: '\u00a0RUB' },
  8: { prefix: '₹' },
  9: { prefix: '₩' },
  10: { prefix: 'CN¥' },
  11: { prefix: 'R$\u00a0' },
  12: { prefix: 'TRY\u00a0' },
  13: { prefix: 'IDR\u00a0' },
  14: { prefix: 'CHF\u00a0' },
  15: { prefix: 'HK$' },
  16: { prefix: 'NZ$' },
  17: { suffix: '\u00a0SEK' },
  18: { suffix: '\u00a0NOK' },
  19: { prefix: 'MX$' },
  20: { prefix: 'ZAR\u00a0' },
  21: { prefix: 'NT$' },
  22: { suffix: '\u00a0DKK' },
  23: { prefix: 'THB\u00a0' },
  24: { suffix: '\u00a0HUF' },
  25: { suffix: '\u00a0CZK' },
  26: { suffix: '\u00a0₪' },
  27: { prefix: 'CLP\u00a0' },
  28: { prefix: '₱' },
  29: { suffix: '\u00a0AED' },
  30: { prefix: 'COP\u00a0' },
  31: { prefix: 'SAR\u00a0' },
  32: { prefix: 'RM\u00a0' },
  33: { suffix: '\u00a0RON' },
  34: { prefix: 'ARS\u00a0' },
  35: { prefix: 'UYU\u00a0' },
};

/**
 * How a Number field's cells print each currency: the locale, ISO code and
 * post-processing of `fields/number/format.ts` `currencyFormaterMap`, which
 * this mirrors with variable fraction digits (`chart-format.test.ts` checks
 * that both print the same at 0–2 digits).
 */
const CURRENCY_CELL_FORMATS: Readonly<
  Record<number, { locale: string; currency: string; code?: boolean; post?: (text: string) => string }>
> = {
  1: { locale: 'en-US', currency: 'USD' },
  2: { locale: 'en-CA', currency: 'CAD', post: (text) => text.replace('$', 'CA$') },
  4: { locale: 'de-DE', currency: 'EUR', post: (text) => `€${text.replace('€', '').trim()}` },
  5: { locale: 'en-GB', currency: 'GBP' },
  6: { locale: 'ja-JP', currency: 'JPY' },
  7: { locale: 'ru-RU', currency: 'RUB', code: true, post: replaceNoBreakSpaces },
  8: { locale: 'hi-IN', currency: 'INR' },
  9: { locale: 'ko-KR', currency: 'KRW' },
  10: { locale: 'zh-CN', currency: 'CNY', post: (text) => text.replace('¥', 'CN¥') },
  11: { locale: 'pt-BR', currency: 'BRL', post: replaceNoBreakSpaces },
  12: { locale: 'tr-TR', currency: 'TRY', code: true, post: replaceNoBreakSpaces },
  13: { locale: 'id-ID', currency: 'IDR', code: true, post: replaceNoBreakSpaces },
  14: { locale: 'de-CH', currency: 'CHF', post: replaceNoBreakSpaces },
  15: { locale: 'zh-HK', currency: 'HKD' },
  16: { locale: 'en-NZ', currency: 'NZD', post: (text) => text.replace('$', 'NZ$') },
  17: { locale: 'sv-SE', currency: 'SEK', code: true },
  18: { locale: 'nb-NO', currency: 'NOK', code: true },
  19: { locale: 'es-MX', currency: 'MXN', post: (text) => text.replace('$', 'MX$') },
  20: { locale: 'en-ZA', currency: 'ZAR', code: true },
  21: { locale: 'zh-TW', currency: 'TWD', post: (text) => text.replace('$', 'NT$') },
  22: { locale: 'da-DK', currency: 'DKK', code: true },
  23: { locale: 'th-TH', currency: 'THB', code: true },
  24: { locale: 'hu-HU', currency: 'HUF', code: true },
  25: { locale: 'cs-CZ', currency: 'CZK', code: true },
  26: { locale: 'he-IL', currency: 'ILS' },
  27: { locale: 'es-CL', currency: 'CLP', code: true },
  28: { locale: 'fil-PH', currency: 'PHP' },
  29: { locale: 'ar-AE', currency: 'AED', code: true },
  30: { locale: 'es-CO', currency: 'COP', code: true },
  31: { locale: 'en-US', currency: 'SAR', code: true },
  32: { locale: 'ms-MY', currency: 'MYR' },
  33: { locale: 'ro-RO', currency: 'RON' },
  34: { locale: 'es-AR', currency: 'ARS', code: true },
  35: { locale: 'es-UY', currency: 'UYU', code: true },
};

function replaceNoBreakSpaces(text: string) {
  return text.replaceAll('\u00a0', ' ');
}

// Constructing an Intl formatter is the expensive part, so each (locale, options) pair is built once.
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }

  return formatter;
}

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }

  return formatter;
}

/** Test hook: how many Intl number formatters are cached. */
export function cachedChartFormatterCount() {
  return numberFormatters.size;
}

/**
 * Rounds half away from zero on the shortest round-trip decimal string of the
 * double (what `Number#toString` and Dart's `double#toString` print), with
 * string arithmetic, so `1.005 → 1.01`, `-1.125 → -1.13` and `2.675 → 2.68`
 * on both clients. A result of zero is never negative.
 */
export function roundHalfAwayFromZero(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? 0 : value;
  const negative = value < 0;
  const [mantissa, exponentText] = Math.abs(value).toString().split('e');
  const [integerPart, fractionPart = ''] = mantissa.split('.');
  let all = integerPart + fractionPart;
  // Position of the decimal point inside `all`.
  let point = integerPart.length + Number(exponentText ?? 0);
  const leadingZeros = all.length - all.replace(/^0+/, '').length;

  all = all.slice(leadingZeros);
  point -= leadingZeros;
  if (all === '') return 0;
  const keep = point + digits;

  if (keep >= all.length) return value;
  if (keep < 0) return 0;
  let kept = all.slice(0, keep);

  if (all.charCodeAt(keep) >= 53 /* '5' */) kept = incrementDigits(kept);
  if (kept === '' || /^0*$/.test(kept)) return 0;
  const rounded = Number(`${kept}e-${digits}`);

  return negative ? -rounded : rounded;
}

/** `"129" → "130"`, `"99" → "100"`, `"" → "1"`. */
function incrementDigits(digits: string): string {
  const chars = digits.split('');
  let index = chars.length - 1;

  while (index >= 0) {
    if (chars[index] === '9') {
      chars[index] = '0';
      index -= 1;
    } else {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join('');
    }
  }

  return `1${chars.join('')}`;
}

const LOCALE_ALIASES: Record<string, string> = { en: 'en-US', zh: 'zh-CN', pt: 'pt-BR' };

/** The chart locale for an app language: `en → en-US`, `zh → zh-CN`, `pt → pt-BR`; unsupported → `en-US`. */
export function resolveChartLocale(appLanguage: string | null | undefined): string {
  const tag = (appLanguage ?? '').trim().replace(/_/g, '-');

  if (!tag) return 'en-US';
  const resolved = LOCALE_ALIASES[tag] ?? tag;

  try {
    return Intl.NumberFormat.supportedLocalesOf(resolved).length > 0 ? resolved : 'en-US';
  } catch {
    // An invalid tag throws a RangeError.
    return 'en-US';
  }
}

/** A donut slice's share of the total: one decimal unless it rounds to an integer (`4/12 → 33.3%`). */
export function formatShare(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0%';
  const share = roundHalfAwayFromZero((value / total) * 100, 1);

  return `${Number.isInteger(share) ? share.toFixed(0) : share.toFixed(1)}%`;
}

function isCurrencyFormat(format: number | null | undefined): format is number {
  return typeof format === 'number' && format !== NUMBER_FORMAT_NUM && format !== NUMBER_FORMAT_PERCENT &&
    CURRENCY_CELL_FORMATS[format] !== undefined;
}

/**
 * A Number field's currency the way its cells print it, with fixed fraction
 * digits. The value is rounded half away from zero first, so the platform
 * formatter never rounds again.
 */
export function formatFieldCurrency(value: number, format: number, minDigits: number, maxDigits: number): string {
  const spec = CURRENCY_CELL_FORMATS[format];
  const rounded = roundHalfAwayFromZero(value, maxDigits);

  if (!spec) return formatPlain(rounded, minDigits, maxDigits, 'en-US');
  const text = numberFormatter(spec.locale, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
    style: 'currency',
    currencyDisplay: spec.code ? 'code' : 'symbol',
    useGrouping: true,
    currency: spec.currency,
  }).format(rounded === 0 ? 0 : rounded);

  return spec.post ? spec.post(text) : text;
}

function normalizeDecimalPlaces(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value : null;
}

function isCompactEligible(x: number, ctx: ChartFormatContext): boolean {
  const magnitude = Math.abs(x);

  switch (ctx.mode) {
    case 'axis':
    case 'label':
      return magnitude >= 1000;
    case 'center':
      return magnitude >= 10000;
    case 'card':
      return ctx.numberFormat === 'compact' && magnitude >= 1000;
    default:
      return false;
  }
}

function formatCompact(x: number, locale: string, decimalPlaces: number | null): string {
  return numberFormatter(locale, {
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalPlaces === 0 ? 0 : 1,
  }).format(x);
}

/** Fraction digits of the non-compact path (§1.2 step 8). */
function fractionDigits(x: number, mode: ChartValueMode, decimalPlaces: number | null, currency: boolean) {
  if (decimalPlaces !== null) return { min: decimalPlaces, max: decimalPlaces };
  if (mode === 'axis') return { min: 0, max: 2 };
  if (Math.abs(x) >= 1000) return { min: 0, max: 0 };
  return currency ? { min: 2, max: 2 } : { min: 0, max: 2 };
}

function formatPlain(x: number, minDigits: number, maxDigits: number, locale: string): string {
  const rounded = roundHalfAwayFromZero(x, maxDigits);

  return numberFormatter(locale, {
    useGrouping: true,
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(rounded === 0 ? 0 : rounded);
}

function formatPlainValue(x: number, ctx: ChartFormatContext, decimalPlaces: number | null): string {
  const digits = fractionDigits(x, ctx.mode, decimalPlaces, false);

  return formatPlain(x, digits.min, digits.max, ctx.locale);
}

const DATE_PATTERNS: Record<number, string> = {
  0: 'MM/DD/YYYY',
  1: 'YYYY/MM/DD',
  2: 'YYYY-MM-DD',
  3: 'MMM DD, YYYY',
  4: 'DD/MM/YYYY',
  5: 'MMMM DD, YYYY',
};

/** Days since the Unix epoch as a date in the Y field's date format. */
function formatEpochDays(days: number, ctx: ChartFormatContext): string {
  const date = new Date(days * DAY_MS);
  const timeZone = ctx.timeZone;
  const parts = Object.fromEntries(
    dateFormatter('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const pattern = DATE_PATTERNS[ctx.yField?.dateFormat ?? 0] ?? DATE_PATTERNS[2];
  const monthName = (month: 'short' | 'long') => dateFormatter(ctx.locale, { timeZone, month }).format(date);

  return pattern.replace(/MMMM|MMM|MM|DD|YYYY/g, (token) => {
    switch (token) {
      case 'MMMM':
        return monthName('long');
      case 'MMM':
        return monthName('short');
      case 'MM':
        return parts.month;
      case 'DD':
        return parts.day;
      default:
        return parts.year;
    }
  });
}

function englishDays(count: number) {
  return `${count} ${Math.abs(count) === 1 ? 'day' : 'days'}`;
}

/** R-FORMAT: `value` as a chart prints it in `ctx.mode` (WP10 §1.2, in this order). */
export function formatChartValue(value: number, ctx: ChartFormatContext): string {
  if (!Number.isFinite(value)) return '0';
  const decimalPlaces = normalizeDecimalPlaces(ctx.decimalPlaces);
  const { aggregation, yField, locale } = ctx;

  // 2. The Number card's Percent format scales any aggregation and never compacts.
  if (ctx.mode === 'card' && ctx.numberFormat === 'percent') {
    return `${formatPlainValue(value * 100, ctx, decimalPlaces)}%`;
  }

  // 3. Counts are whole numbers; decimal places do not apply.
  if (COUNT_AGGREGATIONS.has(aggregation)) {
    const count = roundHalfAwayFromZero(value, 0);

    if (isCompactEligible(count, ctx)) return formatCompact(count, locale, null);
    return formatPlain(count, 0, 0, locale);
  }

  // 4. Percent aggregations, already in percentage points.
  if (PERCENT_AGGREGATIONS.has(aggregation)) {
    const digits = decimalPlaces ?? (Number.isInteger(roundHalfAwayFromZero(value, 1)) ? 0 : 1);

    return `${formatPlain(value, digits, digits, locale)}%`;
  }

  // 5. Dates and date ranges.
  if (DATE_AGGREGATIONS.has(aggregation) && yField?.type === 'date') return formatEpochDays(value, ctx);
  if (aggregation === DATE_RANGE_AGGREGATION) {
    return (ctx.labels?.days ?? englishDays)(roundHalfAwayFromZero(value, 0));
  }

  // 6. Field-driven formats.
  if (yField?.type === 'number' && yField.numberFormat === NUMBER_FORMAT_PERCENT) {
    const percent = value * 100;

    if (isCompactEligible(percent, ctx)) return `${formatCompact(percent, locale, decimalPlaces)}%`;
    return `${formatPlainValue(percent, ctx, decimalPlaces)}%`;
  }

  if (yField?.type === 'number' && isCurrencyFormat(yField.numberFormat)) {
    const format = yField.numberFormat;

    if (isCompactEligible(value, ctx)) {
      const affix = CHART_CURRENCY_AFFIXES[format] ?? {};
      const sign = value < 0 ? '-' : '';

      return `${sign}${affix.prefix ?? ''}${formatCompact(Math.abs(value), locale, decimalPlaces)}${affix.suffix ?? ''}`;
    }

    const digits = fractionDigits(value, ctx.mode, decimalPlaces, true);

    return formatFieldCurrency(value, format, digits.min, digits.max);
  }

  // 7, 8, 11. The plain path.
  if (isCompactEligible(value, ctx)) return formatCompact(value, locale, decimalPlaces);
  return formatPlainValue(value, ctx, decimalPlaces);
}
