/**
 * R-GROUPKEY (WP11 §1.4): the canonical group key, label and default-sort
 * hint of a chart X-axis value. Pure; desktop has the same rules in
 * `chart_group_keys.dart`, and both are pinned by
 * `dashboard-parity/group-keys.json`.
 */
import dayjs, { Dayjs } from 'dayjs';

import { FALLBACK_INTL_LOCALE } from '@/i18n/intl-locale';

import { ChartTextGrouping } from '../chart-extended-settings';
import { DateGroupCondition, FieldType } from '../database.type';

import { formatChartDateLabel } from './date-labels';
import { canonicalNumber, numberBucketRef, ResolvedNumberBuckets } from './number-buckets';

/** The key of the "No {field}" group. */
export const EMPTY_GROUP_KEY = '__empty__';

/** The two checkbox keys; only their labels are translated. */
export const CHECKBOX_CHECKED_KEY = 'checked';
export const CHECKBOX_UNCHECKED_KEY = 'unchecked';

/**
 * How `sortChartGroups` orders a group by default: by rank (option index,
 * checkbox, date bucket, range start; `tie` breaks equal ranks by code unit)
 * or by label.
 */
export type ChartGroupHint = { rank: number; tie?: string } | { label: true };

export interface ChartGroupRef {
  key: string;
  label: string;
  hint: ChartGroupHint;
}

/** An X-axis cell reduced to what grouping needs (the adapters read the client's own cells). */
export type ChartCellValue =
  | { kind: 'empty' }
  | { kind: 'select'; ids: readonly string[] }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'date'; date: Dayjs }
  | { kind: 'users'; ids: readonly string[] }
  | { kind: 'relation'; ids: readonly string[] }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number };

/** The relative date buckets in chart order; farther dates fall back to month keys (rank 7). */
export const RELATIVE_DATE_BUCKETS = [
  'last_30_days',
  'last_7_days',
  'yesterday',
  'today',
  'tomorrow',
  'next_7_days',
  'next_30_days',
] as const;

export type RelativeDateBucket = (typeof RELATIVE_DATE_BUCKETS)[number];

/** Translated labels a group can need, built once per language. */
export interface ChartGroupLabels {
  checked: string;
  unchecked: string;
  /** Empty group: "No {field}", or "Empty" for a field without a name. */
  noFieldValue: (fieldName: string) => string;
  /**
   * Week bucket: the translated `board.dateCondition.weekOf` ("Week of {} - {}"),
   * its two `{}` filled with the first and the last day (`formatChartDateLabel`).
   */
  weekOfTemplate: string;
  relative: Record<RelativeDateBucket, string>;
  unknownPerson: string;
  unknownUser: string;
  untitled: string;
}

/** The X field as grouping needs it. */
export interface ChartGroupField {
  type: FieldType;
  name: string;
  /** Select fields: the options in their order. */
  options?: ReadonlyArray<{ id: string; name: string }>;
}

/** Display names of ids; `undefined` (or an empty string) means unknown. */
export interface ChartGroupNameLookup {
  /** Person: the workspace member's name, then the type option's person name. */
  person?: (id: string) => string | undefined;
  /** Created by / Last edited by: the member's name or email. */
  user?: (uid: string) => string | undefined;
  /** Relation: the related row's title. */
  relation?: (rowId: string) => string | undefined;
}

export interface ChartGroupContext {
  dateCondition: DateGroupCondition;
  textGrouping: ChartTextGrouping;
  labels: ChartGroupLabels;
  names?: ChartGroupNameLookup;
  /** Captured once per computation, so every row buckets against the same day. */
  now: Dayjs;
  /** The Intl locale date labels are written in (`toIntlLocale` of the app language); keys never depend on it. */
  locale: string;
  /** Number X axis: the resolved ranges (`resolveNumberBuckets`) and the axis formatter of the X field. */
  buckets?: ResolvedNumberBuckets | null;
  formatAxis?: (value: number) => string;
}

const DATE_TYPES: ReadonlySet<FieldType> = new Set([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime]);

export function isChartDateFieldType(type: FieldType | number): boolean {
  return DATE_TYPES.has(type as FieldType);
}

/** The "No {field}" group of `field`. */
export function emptyGroupRef(field: Pick<ChartGroupField, 'name'>, labels: ChartGroupLabels): ChartGroupRef {
  return { key: EMPTY_GROUP_KEY, label: labels.noFieldValue(field.name), hint: { label: true } };
}

type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };

/**
 * One grapheme segmenter for every call (an ICU break iterator is costly to
 * build, and `chartGroupRefs` runs once per row); `null` when the runtime has
 * no `Intl.Segmenter`.
 */
let graphemeSegmenter: GraphemeSegmenter | null | undefined;

function getGraphemeSegmenter(): GraphemeSegmenter | null {
  if (graphemeSegmenter === undefined) {
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => GraphemeSegmenter })
      .Segmenter;

    graphemeSegmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }

  return graphemeSegmenter;
}

function firstGrapheme(text: string): string {
  const segmenter = getGraphemeSegmenter();

  if (segmenter) {
    for (const { segment } of segmenter.segment(text)) return segment;
    return '';
  }

  // Without Intl.Segmenter: the first code point and the combining marks after it.
  const points = Array.from(text);
  let grapheme = points[0] ?? '';

  for (let index = 1; index < points.length && /^\p{M}$/u.test(points[index]); index++) grapheme += points[index];
  return grapheme;
}

/**
 * The first-letter group of a text: `l:` and the NFC-uppercased first
 * grapheme when it starts with a letter, otherwise `l:#`.
 */
export function firstLetterKey(text: string): { key: string; label: string } {
  const grapheme = firstGrapheme(text.trim().normalize('NFC'));

  if (!/^\p{L}/u.test(grapheme)) return { key: 'l:#', label: '#' };
  const letter = grapheme.toUpperCase().normalize('NFC');

  return { key: `l:${letter}`, label: letter };
}

function relativeBucket(diffDays: number): RelativeDateBucket | null {
  if (diffDays === 0) return 'today';
  if (diffDays === -1) return 'yesterday';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays >= -7 && diffDays < -1) return 'last_7_days';
  if (diffDays > 1 && diffDays <= 7) return 'next_7_days';
  if (diffDays >= -30 && diffDays < -7) return 'last_30_days';
  if (diffDays > 7 && diffDays <= 30) return 'next_30_days';
  return null;
}

/**
 * The date group of `date` under `condition`. Keys are ASCII (dayjs
 * `YYYY-MM-DD` / `YYYY-MM` / `YYYY`, `rel:<bucket>`) whatever the language;
 * labels are `formatChartDateLabel` of the key in `locale`, and the relative
 * buckets' translated names.
 */
export function dateGroupRef(
  date: Dayjs,
  condition: DateGroupCondition,
  labels: ChartGroupLabels,
  now: Dayjs = dayjs(),
  locale: string = FALLBACK_INTL_LOCALE
): ChartGroupRef {
  const label = (key: string) => formatChartDateLabel(key, condition, locale, labels.weekOfTemplate);

  switch (condition) {
    case DateGroupCondition.Day: {
      const key = date.format('YYYY-MM-DD');

      return { key, label: label(key), hint: { rank: 0, tie: key } };
    }

    case DateGroupCondition.Week: {
      const monday = date.day() === 0 ? date.subtract(6, 'day') : date.subtract(date.day() - 1, 'day');
      const key = monday.format('YYYY-MM-DD');

      return { key, label: label(key), hint: { rank: 0, tie: key } };
    }

    case DateGroupCondition.Month: {
      const key = date.format('YYYY-MM');

      return { key, label: label(key), hint: { rank: 0, tie: key } };
    }

    case DateGroupCondition.Year: {
      const key = date.format('YYYY');

      return { key, label: label(key), hint: { rank: 0, tie: key } };
    }

    case DateGroupCondition.Relative:
    default: {
      const bucket = relativeBucket(date.startOf('day').diff(now.startOf('day'), 'day'));

      if (bucket) {
        return { key: `rel:${bucket}`, label: labels.relative[bucket], hint: { rank: RELATIVE_DATE_BUCKETS.indexOf(bucket) } };
      }

      const key = date.format('YYYY-MM');

      return { key, label: label(key), hint: { rank: RELATIVE_DATE_BUCKETS.length, tie: key } };
    }
  }
}

function named(name: string | undefined, fallback: string): string {
  return name ? name : fallback;
}

/** Distinct ids, first occurrence first: a cell that lists an id twice counts once in its group. */
function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id !== ''))];
}

/**
 * The groups of one X-axis value. Empty values yield the "No {field}" group;
 * a multi-value cell yields one group per distinct id (the row counts in each).
 */
export function chartGroupRefs(value: ChartCellValue, field: ChartGroupField, ctx: ChartGroupContext): ChartGroupRef[] {
  const empty = () => [emptyGroupRef(field, ctx.labels)];

  switch (value.kind) {
    case 'empty':
      return empty();

    case 'select': {
      const ids = distinct(value.ids);

      if (ids.length === 0) return empty();
      const options = field.options ?? [];

      return ids.map((id) => {
        const index = options.findIndex((option) => option.id === id);

        return {
          key: id,
          label: index === -1 ? id : options[index].name,
          hint: { rank: index === -1 ? Number.POSITIVE_INFINITY : index },
        };
      });
    }

    case 'checkbox':
      return value.checked
        ? [{ key: CHECKBOX_CHECKED_KEY, label: ctx.labels.checked, hint: { rank: 0 } }]
        : [{ key: CHECKBOX_UNCHECKED_KEY, label: ctx.labels.unchecked, hint: { rank: 1 } }];

    case 'date':
      return value.date.isValid()
        ? [dateGroupRef(value.date, ctx.dateCondition, ctx.labels, ctx.now, ctx.locale)]
        : empty();

    case 'users': {
      const ids = distinct(value.ids);

      if (ids.length === 0) return empty();
      const isPerson = field.type === FieldType.Person;

      return ids.map((id) => ({
        key: id,
        label: isPerson
          ? named(ctx.names?.person?.(id), ctx.labels.unknownPerson)
          : named(ctx.names?.user?.(id), ctx.labels.unknownUser),
        hint: { label: true },
      }));
    }

    case 'relation': {
      const ids = distinct(value.ids);

      if (ids.length === 0) return empty();
      return ids.map((id) => ({
        key: id,
        label: named(ctx.names?.relation?.(id)?.trim(), ctx.labels.untitled),
        hint: { label: true },
      }));
    }

    case 'text': {
      const text = value.text.trim();

      if (!text) return empty();
      if (ctx.textGrouping === 'first_letter') {
        const { key, label } = firstLetterKey(text);

        return [{ key, label, hint: { label: true } }];
      }

      // The key is case-folded like `TextIs`, which both clients compare
      // case-insensitively, so a drill-down shows exactly the clicked bar's
      // rows; the label is the cell as spelled (the first row seen names the group).
      return [{ key: `t:${text.toLowerCase()}`, label: text, hint: { label: true } }];
    }

    case 'number': {
      if (!Number.isFinite(value.value) || !ctx.buckets) return empty();
      return [numberBucketRef(value.value, ctx.buckets, ctx.formatAxis ?? ((n) => canonicalNumber(n)))];
    }

    default:
      return empty();
  }
}
