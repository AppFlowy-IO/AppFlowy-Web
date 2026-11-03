import { FieldType, FilterType } from './database.type';
import { MergeableOption, resolveGlobalFilterOptionIds } from './global-filter-options';
import { clampInteger, isPlainRecord, nonEmptyString, pickUnknownKeys, toPlainValue } from './layout-codec';

/**
 * Dashboard global filters: the model, its persisted codec
 * (`layout_settings['9'].global_filters`) and the per-widget resolution.
 * `dashboard.type.ts` and `dashboard-layout.ts` re-export everything here, so
 * importers keep their paths.
 */

/**
 * A dashboard-level filter applied to every widget whose source database has a
 * mapping in `targets`. `condition` / `content` use the same encoding as a view
 * filter of `fieldType`, so the existing filter menus can edit it and
 * `filterBy` can evaluate it unchanged.
 */
export interface DashboardGlobalFilter {
  id: string;
  /** Display name shown on the chip (defaults to the first mapped property's name). */
  name: string;
  fieldType: FieldType;
  condition: number;
  content: string;
  /** database id → field id of that database the filter applies to. */
  targets: Record<string, string>;
  /**
   * Select filters only (WP08 §1.9): the names of the option ids in
   * `content`, same order, so each source matches its own options by name.
   * Absent in older data and for every other type.
   */
  optionNames?: string[];
}

/** Whether a filter of this type stores option ids, which differ per database (SingleSelect, MultiSelect). */
export function usesGlobalFilterOptionContent(fieldType: FieldType): boolean {
  return fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;
}

/** What a widget's own source tells about the fields a global filter maps to (the select options). */
export interface GlobalFilterSourceLike {
  fields: readonly { id: string; type: FieldType; options?: readonly MergeableOption[] }[];
}

/**
 * A global filter resolved for one widget: a plain filter node in the persisted
 * view-filter shape (`filter_type`, `field_id`, `ty`, `condition`, `content`).
 * `filterBy` wraps plain objects, so the node needs no Yjs container.
 */
export interface DashboardExtraFilter {
  id: string;
  filter_type: FilterType.Data;
  field_id: string;
  ty: FieldType;
  condition: number;
  content: string;
}

export function toExtraFilter(
  filter: DashboardGlobalFilter,
  fieldId: string,
  content = filter.content
): DashboardExtraFilter {
  return {
    id: filter.id,
    filter_type: FilterType.Data,
    field_id: fieldId,
    ty: filter.fieldType,
    condition: filter.condition,
    content,
  };
}

/**
 * The global filters that apply to a widget of `databaseId`, resolved to its
 * field ids. Each node keeps the filter's type in `ty`; `combineFilters` skips
 * a node whose field has since changed type, reading the type live.
 *
 * With the widget's own source (`targetSource`), a select filter's content is
 * resolved to that database's option ids by the stored option names; without
 * it (the source is not loaded yet) the ids stay as stored.
 */
export function resolveExtraFiltersForDatabase(
  globalFilters: DashboardGlobalFilter[],
  databaseId: string,
  targetSource?: GlobalFilterSourceLike | null
): DashboardExtraFilter[] {
  const resolved: DashboardExtraFilter[] = [];

  globalFilters.forEach((filter) => {
    const fieldId = filter.targets[databaseId];

    if (!fieldId) return;
    if (!usesGlobalFilterOptionContent(filter.fieldType) || !filter.optionNames?.length || !targetSource) {
      resolved.push(toExtraFilter(filter, fieldId));
      return;
    }

    const field = targetSource.fields.find((item) => item.id === fieldId && item.type === filter.fieldType);

    resolved.push(
      toExtraFilter(
        filter,
        fieldId,
        field ? resolveGlobalFilterOptionIds(filter.content, filter.optionNames, field.options ?? []) : filter.content
      )
    );
  });

  return resolved;
}

// ---------------------------------------------------------------------------
// Persisted codec
// ---------------------------------------------------------------------------

/**
 * The keys this client writes on a stored filter. Any other key belongs to
 * another (newer) client and is carried over by id; a key in this set always
 * comes from the writer, so the writer can clear it. Same set as Rust
 * `FILTER_KNOWN_KEYS`.
 */
export const DASHBOARD_GLOBAL_FILTER_KEYS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'ty',
  'condition',
  'content',
  'targets',
  'target_order',
  'option_names',
]);

export const EMPTY_DASHBOARD_GLOBAL_FILTERS: DashboardGlobalFilter[] = [];
// Plain values keep their identity until the key is rewritten, so parsed
// results can be cached per stored value (see `parseRows` in dashboard-layout.ts).
const parsedFilters = new WeakMap<object, DashboardGlobalFilter[]>();

/**
 * A global filter's `targets` in their stored order. The first mapping is the
 * primary one (select content refers to its options), but `targets` is a JSON
 * object, which Yrs decodes into a hash map and re-encodes in arbitrary key
 * order. The order therefore lives in the `target_order` array; mappings it
 * does not list (older data) follow in sorted order so every client agrees.
 */
function parseGlobalFilterTargets(targetsValue: unknown, orderValue: unknown): Record<string, string> {
  const targetsRaw = toPlainValue(targetsValue);
  const entries = new Map<string, string>();

  if (isPlainRecord(targetsRaw)) {
    Object.entries(targetsRaw).forEach(([databaseId, fieldId]) => {
      const id = nonEmptyString(fieldId);

      if (databaseId && id) entries.set(databaseId, id);
    });
  }

  const orderRaw = toPlainValue(orderValue);
  const listed = Array.isArray(orderRaw)
    ? orderRaw.filter((databaseId): databaseId is string => typeof databaseId === 'string' && entries.has(databaseId))
    : [];
  const ordered = [...new Set(listed)];
  const listedSet = new Set(ordered);
  const rest = [...entries.keys()].filter((databaseId) => !listedSet.has(databaseId)).sort();
  const targets: Record<string, string> = {};

  [...ordered, ...rest].forEach((databaseId) => {
    targets[databaseId] = entries.get(databaseId) as string;
  });
  return targets;
}

/** `option_names` read tolerantly: only an array of strings counts; an empty one is absent. */
function parseOptionNames(value: unknown): string[] | undefined {
  const raw = toPlainValue(value);

  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((name) => typeof name === 'string')) return undefined;
  return raw as string[];
}

/** The stored `global_filters` value (plain or Y.Array) as typed filters; filters of an unreadable type are skipped. */
export function parseDashboardGlobalFilters(value: unknown): DashboardGlobalFilter[] {
  const raw = toPlainValue(value);

  if (!Array.isArray(raw)) return EMPTY_DASHBOARD_GLOBAL_FILTERS;
  const cached = parsedFilters.get(raw);

  if (cached) return cached;
  const filters: DashboardGlobalFilter[] = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as {
      id?: unknown;
      name?: unknown;
      ty?: unknown;
      condition?: unknown;
      content?: unknown;
      targets?: unknown;
      target_order?: unknown;
      option_names?: unknown;
    };
    const fieldType = clampInteger(record.ty, 0, 1000, -1);

    if (fieldType < 0) return;
    const filter: DashboardGlobalFilter = {
      // Positional, like the row fallback ids (see `parseRows`).
      id: nonEmptyString(record.id) ?? `gf:${index}`,
      name: typeof record.name === 'string' ? record.name : '',
      fieldType: fieldType as FieldType,
      condition: clampInteger(record.condition, 0, 1000, 0),
      content: typeof record.content === 'string' ? record.content : '',
      targets: parseGlobalFilterTargets(record.targets, record.target_order),
    };
    const optionNames = parseOptionNames(record.option_names);

    if (optionNames) filter.optionNames = optionNames;
    filters.push(filter);
  });

  const stable = filters.length === 0 ? EMPTY_DASHBOARD_GLOBAL_FILTERS : filters;

  parsedFilters.set(raw, stable);
  return stable;
}

/**
 * The unknown keys of each stored filter, by effective id: the stored `id`, or
 * `gf:{index}` counting every entry exactly as `parseDashboardGlobalFilters`
 * does (filters of a type this client skips included). The first occurrence of
 * an id wins, as in Rust `index_global_filter_extras`.
 */
export function indexGlobalFilterExtras(stored: unknown): Map<string, Record<string, unknown>> {
  const extras = new Map<string, Record<string, unknown>>();
  const raw = toPlainValue(stored);

  if (!Array.isArray(raw)) return extras;
  const seen = new Set<string>();

  raw.forEach((item, index) => {
    if (!isPlainRecord(item)) return;
    const id = nonEmptyString(item.id) ?? `gf:${index}`;

    if (seen.has(id)) return;
    seen.add(id);
    const unknown = pickUnknownKeys(item, DASHBOARD_GLOBAL_FILTER_KEYS);

    if (unknown) extras.set(id, unknown);
  });
  return extras;
}

/**
 * Serialize filters in the persisted snake_case shape. With `stored` (the
 * current value of the key), each filter keeps the unknown keys of the stored
 * filter with the same id (ARCHITECTURE §3.1.4).
 */
export function serializeDashboardGlobalFilters(filters: DashboardGlobalFilter[], stored?: unknown) {
  const extras = indexGlobalFilterExtras(stored);

  return filters.map((filter) => ({
    ...extras.get(filter.id),
    id: filter.id,
    name: filter.name,
    ty: filter.fieldType,
    condition: filter.condition,
    content: filter.content,
    targets: { ...filter.targets },
    // Arrays keep their order through Yrs; the object above does not.
    target_order: Object.keys(filter.targets),
    // A known key: a write without names clears stale ones.
    ...(usesGlobalFilterOptionContent(filter.fieldType) && filter.optionNames?.length
      ? { option_names: [...filter.optionNames] }
      : {}),
  }));
}

function sameGlobalFilterTargets(a: Record<string, string>, b: Record<string, string>) {
  if (a === b) return true;
  const keys = Object.keys(a);
  const otherKeys = Object.keys(b);

  // Order matters: the first mapping is the primary one.
  return keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && a[key] === b[key]);
}

/** Element-wise; absent equals empty. */
export function sameGlobalFilterOptionNames(a: string[] | undefined, b: string[] | undefined) {
  const left = a ?? [];
  const right = b ?? [];

  return left === right || (left.length === right.length && left.every((name, index) => name === right[index]));
}

function sameGlobalFilter(a: DashboardGlobalFilter, b: DashboardGlobalFilter) {
  return (
    a === b ||
    (a.id === b.id &&
      a.name === b.name &&
      a.fieldType === b.fieldType &&
      a.condition === b.condition &&
      a.content === b.content &&
      sameGlobalFilterTargets(a.targets, b.targets) &&
      sameGlobalFilterOptionNames(a.optionNames, b.optionNames))
  );
}

export function sameDashboardGlobalFilters(a: DashboardGlobalFilter[], b: DashboardGlobalFilter[]) {
  return a === b || (a.length === b.length && a.every((filter, index) => sameGlobalFilter(filter, b[index])));
}

/** `next`, reusing every unchanged filter (and unchanged `targets`) of `previous`. */
export function shareDashboardGlobalFilters(
  previous: DashboardGlobalFilter[],
  next: DashboardGlobalFilter[]
): DashboardGlobalFilter[] {
  if (sameDashboardGlobalFilters(previous, next)) return previous;
  const previousFilters = new Map(previous.map((filter): [string, DashboardGlobalFilter] => [filter.id, filter]));

  return next.map((filter) => {
    const kept = previousFilters.get(filter.id);

    if (!kept) return filter;
    if (sameGlobalFilter(kept, filter)) return kept;
    return kept.targets !== filter.targets && sameGlobalFilterTargets(kept.targets, filter.targets)
      ? { ...filter, targets: kept.targets }
      : filter;
  });
}
