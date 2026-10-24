import * as Y from 'yjs';

import { FieldType, FilterType } from './database.type';
import { isPlainRecord, toPlainValue } from './layout-codec';

import type { DashboardGlobalFilter } from './dashboard-global-filters';

/**
 * A viewer's private dashboard state (WP07): the values they gave existing
 * global filters and the filters / sorts they gave widgets in View mode,
 * until someone with write access saves them for everyone. Kept on this
 * device (`localStorage`, one key per user and dashboard).
 *
 * Pure functions only. Desktop runs the same rules (Dart
 * `dashboard_private_state.dart`, Rust `view_conditions_canonical.rs`) and
 * both are checked against `dashboard-parity/private-state.json`.
 */

/** A private value of an existing global filter. `option_names` parallels the ids in `content` (WP08). */
export interface PrivateGlobalValue {
  condition: number;
  content: string;
  option_names?: string[];
}

/** Dirty global values only, by global filter id. */
export type PrivateGlobalValues = Record<string, PrivateGlobalValue>;

/** A persisted filter or sort map (`toJSON()` of the Y.Map). */
export type PlainCondition = Record<string, unknown>;

/** A widget's dirty parts. A missing part follows the saved view; `[]` is a dirty "no rules". */
export interface PrivateWidgetEntry {
  filters?: PlainCondition[];
  sorts?: PlainCondition[];
}

export interface DashboardPrivateState {
  global_filters: PrivateGlobalValues;
  /** By view id. */
  widgets: Record<string, PrivateWidgetEntry>;
}

export interface DashboardPrivatePayload extends DashboardPrivateState {
  v: 1;
  saved_at: number;
}

export const DASHBOARD_PRIVATE_STORAGE_PREFIX = 'af.dashboard.private.v1';
export const DASHBOARD_PRIVATE_VERSION = 1;

export const EMPTY_PRIVATE_GLOBAL_VALUES: PrivateGlobalValues = Object.freeze({}) as PrivateGlobalValues;

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

function idPart(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);

  return text === '' ? null : text;
}

/**
 * `af.dashboard.private.v1:{workspaceId}:{userId}:{dashboardViewId}`, or `null`
 * (no persistence) while any id is unknown: a published view, an anonymous
 * viewer, a failed profile fetch.
 */
export function dashboardPrivateStorageKey(
  workspaceId: string | null | undefined,
  userId: string | number | null | undefined,
  dashboardViewId: string | null | undefined
): string | null {
  const parts = [idPart(workspaceId), idPart(userId), idPart(dashboardViewId)];

  if (parts.some((part) => part === null)) return null;
  return [DASHBOARD_PRIVATE_STORAGE_PREFIX, ...parts].join(':');
}

/** Whether a storage key belongs to `userId` (any workspace, any dashboard): sign-out removes these. */
export function isDashboardPrivateKeyOfUser(key: string, userId: string | number): boolean {
  const parts = key.split(':');

  return parts.length === 4 && parts[0] === DASHBOARD_PRIVATE_STORAGE_PREFIX && parts[2] === String(userId);
}

// ---------------------------------------------------------------------------
// Canonical comparison
// ---------------------------------------------------------------------------

/** Enum values that native clients store as bigints and older copies as numeric strings. */
const ENUM_KEYS: ReadonlySet<string> = new Set(['condition', 'filter_type', 'ty', 'type']);

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** JSON with sorted object keys, bigints as numbers. */
function stableStringify(value: unknown): string {
  if (typeof value === 'bigint') return String(Number(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

function commaSet(content: string): string {
  return content
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * The content of a filter of `fieldType`, in the form two equal filters share:
 * select ids as a sorted set, person and relation ids as a sorted JSON array,
 * date JSON with sorted keys and no `null` keys, checkbox content ignored,
 * every other type verbatim.
 */
export function canonicalContent(fieldType: number | undefined, content: unknown): string {
  const text = typeof content === 'string' ? content : content === undefined || content === null ? '' : String(content);

  switch (fieldType) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return commaSet(text);
    case FieldType.Relation:
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const parsed = text.trim().startsWith('[') ? parseJson(text) : undefined;

      if (Array.isArray(parsed)) return `[${parsed.map(stableStringify).sort().join(',')}]`;
      return commaSet(text);
    }

    case FieldType.DateTime:
    case FieldType.LastEditedTime:
    case FieldType.CreatedTime: {
      const parsed = text.trim().startsWith('{') ? parseJson(text) : undefined;

      if (isPlainRecord(parsed)) {
        const kept = Object.fromEntries(
          Object.entries(parsed).filter(([, value]) => value !== null && value !== undefined)
        );

        return stableStringify(kept);
      }

      return text.trim();
    }

    case FieldType.Checkbox:
      return '';
    default:
      return text;
  }
}

function isEmptyValue(value: unknown) {
  return value === null || value === undefined || value === '';
}

/** A filter node without its ids, with numeric enums, canonical content and sorted children. */
function canonicalFilterNode(node: unknown): unknown {
  const plain = toPlainValue(node);

  if (!isPlainRecord(plain)) return plain;
  const ty = numericValue(plain.ty);
  const result: Record<string, unknown> = {};

  Object.entries(plain).forEach(([key, raw]) => {
    if (key === 'id') return;
    let value: unknown = raw;

    if (key === 'children') {
      value = Array.isArray(raw) ? raw.map((child) => stableStringify(canonicalFilterNode(child))).sort() : raw;
    } else if (key === 'content') {
      value = canonicalContent(ty, raw);
    } else if (ENUM_KEYS.has(key)) {
      value = numericValue(raw) ?? raw;
    } else if (typeof raw === 'bigint') {
      value = Number(raw);
    }

    if (isEmptyValue(value)) return;
    result[key] = value;
  });

  return result;
}

function canonicalSort(node: unknown): string {
  const plain = toPlainValue(node);

  if (!isPlainRecord(plain)) return stableStringify(plain);
  const result: Record<string, unknown> = {};

  Object.entries(plain).forEach(([key, raw]) => {
    if (key === 'id') return;
    const value = ENUM_KEYS.has(key) ? numericValue(raw) ?? raw : raw;

    if (!isEmptyValue(value)) result[key] = value;
  });
  return stableStringify(result);
}

function listOf(value: unknown): unknown[] {
  if (value instanceof Y.Array) return value.toArray();
  return Array.isArray(value) ? value : [];
}

/** Canonical strings of a filter list, sorted: equal lists are equal multisets of filters. */
export function canonicalFilters(filters: unknown): string[] {
  return listOf(filters)
    .map((node) => stableStringify(canonicalFilterNode(node)))
    .sort();
}

/**
 * Whether two filter lists (Y.Arrays or plain arrays) filter the same rows:
 * ids are ignored at every depth, AND/OR children and the top-level list are
 * compared as multisets, and contents are canonicalized by field type.
 */
export function sameFilters(a: unknown, b: unknown): boolean {
  const left = canonicalFilters(a);
  const right = canonicalFilters(b);

  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Whether two sort lists sort the same way: ids ignored, order significant. */
export function sameSorts(a: unknown, b: unknown): boolean {
  const left = listOf(a).map(canonicalSort);
  const right = listOf(b).map(canonicalSort);

  return left.length === right.length && left.every((item, index) => item === right[index]);
}

// ---------------------------------------------------------------------------
// Global filter values
// ---------------------------------------------------------------------------

function sameNameMultiset(a: string[] | undefined, b: string[] | undefined) {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();

  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Whether two values of a global filter of `fieldType` are the same filter. */
export function sameGlobalFilterValue(fieldType: number, a: PrivateGlobalValue, b: PrivateGlobalValue): boolean {
  return (
    numericValue(a.condition) === numericValue(b.condition) &&
    canonicalContent(fieldType, a.content) === canonicalContent(fieldType, b.content) &&
    sameNameMultiset(a.option_names, b.option_names)
  );
}

/** A global filter's saved value. */
export function globalFilterValueOf(filter: DashboardGlobalFilter): PrivateGlobalValue {
  return filter.optionNames && filter.optionNames.length > 0
    ? { condition: filter.condition, content: filter.content, option_names: filter.optionNames }
    : { condition: filter.condition, content: filter.content };
}

/** `filter` with `value` applied: condition, content and option names come from the value. */
export function withGlobalFilterValue(filter: DashboardGlobalFilter, value: PrivateGlobalValue): DashboardGlobalFilter {
  const optionNames = value.option_names && value.option_names.length > 0 ? value.option_names : undefined;

  return { ...filter, condition: value.condition, content: value.content, optionNames };
}

/** The saved filters with the private values applied; `saved` itself when no value applies. */
export function applyPrivateGlobalValues(
  saved: DashboardGlobalFilter[],
  values: PrivateGlobalValues
): DashboardGlobalFilter[] {
  if (Object.keys(values).length === 0) return saved;
  let changed = false;
  const next = saved.map((filter) => {
    const value = values[filter.id];

    if (!value) return filter;
    changed = true;
    return withGlobalFilterValue(filter, value);
  });

  return changed ? next : saved;
}

/**
 * Drops the values of global filters that no longer exist and the values
 * equal to the saved ones. Returns `values` itself when nothing is dropped.
 */
export function prunePrivateGlobalValues(
  values: PrivateGlobalValues,
  saved: DashboardGlobalFilter[]
): PrivateGlobalValues {
  const ids = Object.keys(values);

  if (ids.length === 0) return values;
  const byId = new Map(saved.map((filter) => [filter.id, filter]));
  const kept = ids.filter((id) => {
    const filter = byId.get(id);

    return filter !== undefined && !sameGlobalFilterValue(filter.fieldType, values[id], globalFilterValueOf(filter));
  });

  if (kept.length === ids.length) return values;
  if (kept.length === 0) return EMPTY_PRIVATE_GLOBAL_VALUES;
  return Object.fromEntries(kept.map((id) => [id, values[id]]));
}

// ---------------------------------------------------------------------------
// Payload codec
// ---------------------------------------------------------------------------

function decodeOptionNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value.length > 0 ? (value as string[]) : undefined;
}

function decodeGlobalValue(value: unknown): PrivateGlobalValue | null {
  if (!isPlainRecord(value)) return null;
  const condition = numericValue(value.condition);

  if (condition === undefined || typeof value.content !== 'string') return null;
  const optionNames = decodeOptionNames(value.option_names);

  return optionNames
    ? { condition, content: value.content, option_names: optionNames }
    : { condition, content: value.content };
}

function decodePart(value: unknown): PlainCondition[] | undefined {
  if (!Array.isArray(value) || !value.every(isPlainRecord)) return undefined;
  return value as PlainCondition[];
}

function decodeWidgetEntry(value: unknown): PrivateWidgetEntry | null {
  if (!isPlainRecord(value)) return null;
  const entry: PrivateWidgetEntry = {};
  const filters = decodePart(value.filters);
  const sorts = decodePart(value.sorts);

  if (filters) entry.filters = filters;
  if (sorts) entry.sorts = sorts;
  return filters || sorts ? entry : null;
}

/**
 * The stored value as private state, or `null` when it must be discarded
 * (and its key removed): unreadable JSON, not an object, another version.
 */
export function decodeDashboardPrivatePayload(raw: string | null | undefined): DashboardPrivateState | null {
  if (typeof raw !== 'string') return null;
  const parsed = parseJson(raw);

  if (!isPlainRecord(parsed) || parsed.v !== DASHBOARD_PRIVATE_VERSION) return null;
  const globalFilters: PrivateGlobalValues = {};
  const widgets: Record<string, PrivateWidgetEntry> = {};

  if (isPlainRecord(parsed.global_filters)) {
    Object.entries(parsed.global_filters).forEach(([id, value]) => {
      const decoded = decodeGlobalValue(value);

      if (decoded) globalFilters[id] = decoded;
    });
  }

  if (isPlainRecord(parsed.widgets)) {
    Object.entries(parsed.widgets).forEach(([viewId, value]) => {
      const decoded = decodeWidgetEntry(value);

      if (decoded) widgets[viewId] = decoded;
    });
  }

  return { global_filters: globalFilters, widgets };
}

/** Whether a widget entry holds a dirty part. */
export function hasPrivateParts(entry: PrivateWidgetEntry | null | undefined): entry is PrivateWidgetEntry {
  return Boolean(entry && (entry.filters !== undefined || entry.sorts !== undefined));
}

/** The payload to store, or `null` (remove the key) when nothing is dirty. */
export function encodeDashboardPrivatePayload(
  state: DashboardPrivateState,
  now: number
): DashboardPrivatePayload | null {
  const globalFilters: PrivateGlobalValues = {};
  const widgets: Record<string, PrivateWidgetEntry> = {};

  Object.entries(state.global_filters).forEach(([id, value]) => {
    globalFilters[id] =
      value.option_names && value.option_names.length > 0
        ? { condition: value.condition, content: value.content, option_names: value.option_names }
        : { condition: value.condition, content: value.content };
  });
  Object.entries(state.widgets).forEach(([viewId, entry]) => {
    if (!hasPrivateParts(entry)) return;
    const part: PrivateWidgetEntry = {};

    if (entry.filters !== undefined) part.filters = entry.filters;
    if (entry.sorts !== undefined) part.sorts = entry.sorts;
    widgets[viewId] = part;
  });

  if (Object.keys(globalFilters).length === 0 && Object.keys(widgets).length === 0) return null;
  return { v: DASHBOARD_PRIVATE_VERSION, saved_at: now, global_filters: globalFilters, widgets };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** A source database's field types by field id (what restore validates widget parts against). */
export type FieldTypesById = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

function fieldTypeOf(fieldTypes: FieldTypesById, fieldId: unknown): number | undefined {
  if (typeof fieldId !== 'string') return undefined;
  if (fieldTypes instanceof Map) return fieldTypes.get(fieldId);
  return (fieldTypes as Readonly<Record<string, number>>)[fieldId];
}

function sanitizeFilterNode(node: PlainCondition, fieldTypes: FieldTypesById): PlainCondition | null {
  const filterType = numericValue(node.filter_type);
  const isGroup = filterType === FilterType.And || filterType === FilterType.Or;

  if (isGroup) {
    const children = Array.isArray(node.children)
      ? (node.children.filter(isPlainRecord) as PlainCondition[])
          .map((child) => sanitizeFilterNode(child, fieldTypes))
          .filter((child): child is PlainCondition => child !== null)
      : [];

    return children.length > 0 ? { ...node, children } : null;
  }

  const type = fieldTypeOf(fieldTypes, node.field_id);

  return type !== undefined && type === numericValue(node.ty) ? node : null;
}

/** Drops the rules of missing or retyped fields, emptied groups and sorts of missing fields. */
export function sanitizePrivateParts(entry: PrivateWidgetEntry, fieldTypes: FieldTypesById): PrivateWidgetEntry {
  const result: PrivateWidgetEntry = {};

  if (entry.filters !== undefined) {
    result.filters = entry.filters
      .map((node) => sanitizeFilterNode(node, fieldTypes))
      .filter((node): node is PlainCondition => node !== null);
  }

  if (entry.sorts !== undefined) {
    result.sorts = entry.sorts.filter((sort) => fieldTypeOf(fieldTypes, sort.field_id) !== undefined);
  }

  return result;
}

/**
 * A stored widget entry made safe to restore against the source as it is now:
 * sanitized (`sanitizePrivateParts`), then each part equal to the saved part
 * is dropped. `{}` restores nothing.
 */
export function sanitizePrivateWidgetEntry(
  entry: PrivateWidgetEntry,
  fieldTypes: FieldTypesById,
  saved: { filters: unknown; sorts: unknown }
): PrivateWidgetEntry {
  const sanitized = sanitizePrivateParts(entry, fieldTypes);
  const result: PrivateWidgetEntry = {};

  if (sanitized.filters !== undefined && !sameFilters(sanitized.filters, saved.filters)) {
    result.filters = sanitized.filters;
  }

  if (sanitized.sorts !== undefined && !sameSorts(sanitized.sorts, saved.sorts)) {
    result.sorts = sanitized.sorts;
  }

  return result;
}

/** Plain JSON as Yjs types (objects → Y.Map, arrays → Y.Array), for writing a restored part. */
export function plainToYCondition(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();

    array.push(value.map(plainToYCondition));
    return array;
  }

  if (isPlainRecord(value)) {
    const map = new Y.Map<unknown>();

    Object.entries(value).forEach(([key, item]) => {
      if (item !== undefined) map.set(key, plainToYCondition(item));
    });
    return map;
  }

  return typeof value === 'bigint' ? Number(value) : value;
}
