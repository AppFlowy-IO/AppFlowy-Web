import {
  getConditionCellData,
  getConditionCellText,
  getRowConditionSnapshot,
  type RowConditionSnapshot,
} from '@/application/database-yjs/condition-value-cache';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { parsePersonTypeOptions } from '@/application/database-yjs/fields/person/parse';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import {
  FieldId,
  RowId,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';

/**
 * Row search of a database view (WP09 §1.2, WAVES §4.1 item 10). Desktop keeps
 * its Tantivy search, a superset; both clients agree on every query of
 * `dashboard-parity/layouts/search.json`, whose `encoding.rule` is this module.
 */
export const SEARCH_RULES = {
  /** A non-primary field with this per-view visibility is never searched; the primary field always is. */
  hiddenVisibility: FieldVisibility.AlwaysHidden,
  /** The displayed text of a multi-select cell: its option names in cell order, joined. */
  multiSelectSeparator: ', ',
  /** Field types whose displayed text needs data the row does not hold; searched only through a getter. */
  resolvedTypes: [FieldType.Relation, FieldType.Rollup, FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy],
  /** Field types whose cells have no displayed text of their own here (computed or binary values). */
  skippedTypes: [FieldType.Formula, FieldType.Media, FieldType.CreatedTime, FieldType.LastEditedTime],
} as const;

/**
 * The query as it is compared: trimmed and lower-cased with `toLocaleLowerCase`
 * (no diacritic folding). `''` means no search.
 */
export function normalizeSearchQuery(query?: string | null): string {
  return (query ?? '').trim().toLocaleLowerCase();
}

/**
 * A field the search reads, in field order with the primary field first. The
 * lookups are built from the field's type option on first use and kept for
 * the search pass (`searchRows` starts from a fresh `getSearchableFields`), so
 * parsing the option JSON costs once per field, not once per cell.
 */
export interface SearchableField {
  id: FieldId;
  type: FieldType;
  field: YDatabaseField;
  primary: boolean;
  /** Select fields: option id and option name → the option name (the first option that carries either wins). */
  optionNames?: Map<string, string>;
  /** Person fields: the type option's person id → name. */
  personNames?: Map<string, string | undefined>;
}

/** Whether a field is searched: the primary field always, any other one unless the view hides it always. */
export function isSearchableField({ visibility, isPrimary }: { visibility: FieldVisibility; isPrimary: boolean }) {
  return isPrimary || visibility !== SEARCH_RULES.hiddenVisibility;
}

/** The per-view visibility of a field; a field without settings is shown (desktop `compile_field_meta`). */
export function readSearchFieldVisibility(view: YDatabaseView | undefined, fieldId: FieldId): FieldVisibility {
  const raw = view?.get(YjsDatabaseKey.field_settings)?.get(fieldId)?.get(YjsDatabaseKey.visibility);
  const visibility = Number(raw);

  return raw === undefined || raw === null || !Number.isFinite(visibility) ? FieldVisibility.AlwaysShown : visibility;
}

/**
 * The fields a search of `view` reads: every field the view does not always
 * hide, the primary one always, in field order with the primary field first.
 */
export function getSearchableFields(fields: YDatabaseFields | undefined, view: YDatabaseView | undefined) {
  const searchable: SearchableField[] = [];

  fields?.forEach((field, id) => {
    const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;
    const primary = Boolean(field.get(YjsDatabaseKey.is_primary));

    if (SEARCH_RULES.skippedTypes.includes(type as (typeof SEARCH_RULES.skippedTypes)[number])) return;
    if (!isSearchableField({ visibility: readSearchFieldVisibility(view, id), isPrimary: primary })) return;
    searchable.push({ id, type, field, primary });
  });

  return searchable.sort((left, right) => Number(right.primary) - Number(left.primary));
}

/** Resolves the displayed text of cells whose value is a reference (related rows, people). */
export interface SearchTextOptions {
  getRelationCellText?: (rowId: RowId, fieldId: FieldId) => string | undefined;
  getRollupCellText?: (rowId: RowId, fieldId: FieldId) => string | undefined;
  /** A person's name by user id. */
  getUserName?: (uid: string) => string | undefined;
}

function selectOptionNameLookup(searchable: SearchableField): Map<string, string> {
  if (!searchable.optionNames) {
    const lookup = new Map<string, string>();

    (parseSelectOptionTypeOptions(searchable.field)?.options ?? []).forEach((option) => {
      if (!lookup.has(option.id)) lookup.set(option.id, option.name);
      if (!lookup.has(option.name)) lookup.set(option.name, option.name);
    });
    searchable.optionNames = lookup;
  }

  return searchable.optionNames;
}

function selectOptionNames(searchable: SearchableField, data: unknown): string[] {
  if (typeof data !== 'string' || data === '') return [];
  const names = selectOptionNameLookup(searchable);

  return data
    .split(',')
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
}

function parseUserIds(data: unknown): string[] {
  if (Array.isArray(data)) return data.map(String);
  if (typeof data !== 'string' || data === '') return [];

  try {
    const parsed = JSON.parse(data) as unknown;

    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function personNameLookup(searchable: SearchableField): Map<string, string | undefined> {
  if (!searchable.personNames) {
    const lookup = new Map<string, string | undefined>();

    (parsePersonTypeOptions(searchable.field).persons ?? []).forEach((person) => {
      if (!lookup.has(person.id)) lookup.set(person.id, person.name);
    });
    searchable.personNames = lookup;
  }

  return searchable.personNames;
}

function personNames(searchable: SearchableField, data: unknown, options?: SearchTextOptions): string {
  const ids = parseUserIds(data);

  if (ids.length === 0) return '';
  const names = personNameLookup(searchable);

  return ids
    .map((id) => options?.getUserName?.(id) ?? names.get(id) ?? '')
    .filter(Boolean)
    .join(SEARCH_RULES.multiSelectSeparator);
}

/** The displayed text of one cell of a row, as the search compares it (not lower-cased). */
export function getSearchCellText(
  rowId: RowId,
  snapshot: RowConditionSnapshot,
  searchable: SearchableField,
  options?: SearchTextOptions
): string {
  const { id, type, field } = searchable;

  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return selectOptionNames(searchable, getConditionCellData(snapshot, id, field)).join(
        SEARCH_RULES.multiSelectSeparator
      );
    case FieldType.Relation:
      return options?.getRelationCellText?.(rowId, id) ?? '';
    case FieldType.Rollup:
      return options?.getRollupCellText?.(rowId, id) ?? '';
    case FieldType.Person:
      return personNames(searchable, getConditionCellData(snapshot, id, field), options);
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const uid = canonicalizeUserUid(
        snapshot.row.get(type === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by)
      );

      return uid === null ? '' : options?.getUserName?.(String(uid)) ?? '';
    }

    default:
      return getConditionCellText(snapshot, id, field);
  }
}

/**
 * Whether the row matches `normalizedQuery` (`normalizeSearchQuery`): the
 * query is a substring of the displayed text of one searchable field. Fields
 * are never concatenated. An unread row does not match; an empty query
 * matches every row.
 */
export function rowMatchesSearch(
  rowId: RowId,
  rowDoc: YDoc | undefined,
  searchableFields: SearchableField[],
  normalizedQuery: string,
  options?: SearchTextOptions
): boolean {
  if (!normalizedQuery) return true;
  const snapshot = getRowConditionSnapshot(rowDoc);

  if (!snapshot) return false;

  return searchableFields.some((searchable) =>
    getSearchCellText(rowId, snapshot, searchable, options).toLocaleLowerCase().includes(normalizedQuery)
  );
}

/** The rows that match `query` (normalized here), in input order. */
export function searchRows<T extends { id: RowId }>(
  rows: T[],
  query: string,
  fields: YDatabaseFields | undefined,
  view: YDatabaseView | undefined,
  rowDocs: Record<RowId, YDoc>,
  options?: SearchTextOptions
): T[] {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) return rows;
  const searchableFields = getSearchableFields(fields, view);

  return rows.filter((row) => rowMatchesSearch(row.id, rowDocs[row.id], searchableFields, normalizedQuery, options));
}
