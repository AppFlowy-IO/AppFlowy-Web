import { generateDashboardId } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { getDefaultFilterCondition } from '@/application/database-yjs/filter';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';

/** One property of a source database, as the global filter editor sees it. */
export interface GlobalFilterSourceField {
  id: string;
  name: string;
  type: FieldType;
  isPrimary: boolean;
  /** Select options (SingleSelect / MultiSelect only; empty otherwise). */
  options: SelectOption[];
}

/** The part of a global filter that decides which properties it maps to. */
export type GlobalFilterTargetShape = Pick<DashboardGlobalFilter, 'fieldType' | 'targets'>;

/** A database whose widgets a global filter can reach. */
export interface GlobalFilterSource {
  databaseId: string;
  name: string;
  fields: GlobalFilterSourceField[];
}

/**
 * Property types a dashboard filter can target, in picker order. Relation and
 * Rollup (and Formula, once ported) resolve their values per database, which a
 * single shared `{condition, content}` pair cannot express, and AI / media
 * properties have no filter editor, so they are left out of this phase.
 */
const GLOBAL_FILTER_FIELD_TYPE_ORDER: FieldType[] = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.Person,
  FieldType.URL,
  FieldType.Checklist,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
];

export const GLOBAL_FILTER_FIELD_TYPES: FieldType[] = GLOBAL_FILTER_FIELD_TYPE_ORDER.filter(
  (type) => !FILTER_EXCLUDED_FIELD_TYPES.includes(type)
);

/**
 * SingleSelect / MultiSelect content is a comma-separated list of option ids,
 * and option ids are generated per database. A select filter therefore also
 * stores the option names (`optionNames`), and each source matches its own
 * options by name (`resolveGlobalFilterOptionIds`, WP08 §1.9). Person content
 * is a list of workspace person ids and Checklist content is empty (the
 * condition carries the value), so both are portable across databases.
 */
export function usesOptionContent(type: FieldType): boolean {
  return type === FieldType.SingleSelect || type === FieldType.MultiSelect;
}

/** Whether a property type can be the target of a global filter (the picker lists only these). */
export function isGlobalFilterFieldType(type: FieldType): boolean {
  return GLOBAL_FILTER_FIELD_TYPES.includes(type);
}

export function fieldsOfType(source: GlobalFilterSource | undefined, type: FieldType): GlobalFilterSourceField[] {
  return source ? source.fields.filter((field) => field.type === type) : [];
}

export function findSourceField(
  sources: GlobalFilterSource[],
  databaseId: string,
  fieldId: string | undefined
): GlobalFilterSourceField | undefined {
  if (!fieldId) return undefined;
  return sources.find((source) => source.databaseId === databaseId)?.fields.find((field) => field.id === fieldId);
}

/** The first mapped source: its field defines the options select content refers to. */
export function getPrimaryTargetDatabaseId(filter: GlobalFilterTargetShape): string | undefined {
  return Object.keys(filter.targets)[0];
}

export function getPrimaryTargetField(
  filter: GlobalFilterTargetShape,
  sources: GlobalFilterSource[]
): GlobalFilterSourceField | undefined {
  const databaseId = getPrimaryTargetDatabaseId(filter);

  if (!databaseId) return undefined;
  const field = findSourceField(sources, databaseId, filter.targets[databaseId]);

  return field && field.type === filter.fieldType ? field : undefined;
}

/**
 * Whether the mapping for `databaseId` still reaches its widgets. A loaded
 * source must still have the property with the filter's type: the stored
 * condition means something else for another type, so evaluation skips it.
 * A source that is not loaded yet is trusted.
 */
export function isGlobalFilterTargetUsable(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  databaseId: string
): boolean {
  const source = sources.find((item) => item.databaseId === databaseId);

  if (!source) return true;
  const field = source.fields.find((item) => item.id === filter.targets[databaseId]);

  return field !== undefined && field.type === filter.fieldType;
}

/** Number of mapped sources; with `sources`, mappings known to be unusable are left out. */
export function countUsableTargets(filter: DashboardGlobalFilter, sources?: GlobalFilterSource[]): number {
  const databaseIds = Object.keys(filter.targets);

  if (!sources) return databaseIds.length;
  return databaseIds.filter((databaseId) => isGlobalFilterTargetUsable(filter, sources, databaseId)).length;
}

export interface GlobalFilterUsableTarget {
  databaseId: string;
  fieldId: string;
  /** Absent while the source is not loaded (the mapping is trusted). */
  source?: GlobalFilterSource;
  field?: GlobalFilterSourceField;
}

/** The usable mappings in target order, with their source and property when loaded (badge, tooltip, merged options). */
export function getUsableTargets(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[]
): GlobalFilterUsableTarget[] {
  return Object.entries(filter.targets).flatMap(([databaseId, fieldId]) => {
    if (!isGlobalFilterTargetUsable(filter, sources, databaseId)) return [];
    const source = sources.find((item) => item.databaseId === databaseId);
    const field = source?.fields.find((item) => item.id === fieldId);

    return [{ databaseId, fieldId, source, field }];
  });
}

/** The properties of `databaseId` the filter may be mapped to: every property of its type. */
export function getTargetCandidates(
  filter: GlobalFilterTargetShape,
  sources: GlobalFilterSource[],
  databaseId: string
): GlobalFilterSourceField[] {
  return fieldsOfType(
    sources.find((item) => item.databaseId === databaseId),
    filter.fieldType
  );
}

/**
 * The mapped sources in mapping order (the first one is primary). A mapping
 * whose database is not loaded (its widget is still mounting, or was removed
 * from the dashboard) is listed without properties so it can still be removed.
 */
export function getMappedSources(
  filter: GlobalFilterTargetShape,
  sources: GlobalFilterSource[],
  fallbackName: (databaseId: string) => string
): GlobalFilterSource[] {
  return Object.keys(filter.targets).map(
    (databaseId) =>
      sources.find((source) => source.databaseId === databaseId) ?? {
        databaseId,
        name: fallbackName(databaseId),
        fields: [],
      }
  );
}

/** Unmapped sources that have a property of the filter's type. */
export function getAddableSources(filter: GlobalFilterTargetShape, sources: GlobalFilterSource[]) {
  return sources.filter(
    (source) => !(source.databaseId in filter.targets) && fieldsOfType(source, filter.fieldType).length > 0
  );
}

/**
 * A new filter for one property of one source (WP08 §1.3): named after the
 * property, with the view filter's default condition and no value (dates
 * too), and no other source mapped.
 */
export function createGlobalFilterForField(
  databaseId: string,
  field: Pick<GlobalFilterSourceField, 'id' | 'name' | 'type'>,
  typeName: string
): DashboardGlobalFilter {
  const defaults = getDefaultFilterCondition(field.type);

  return {
    id: generateDashboardId('gf'),
    name: field.name || typeName,
    fieldType: field.type,
    condition: defaults?.condition ?? 0,
    content: '',
    targets: { [databaseId]: field.id },
  };
}

/** The filter whose only mapping is `databaseId → fieldId`, if any (a pick reopens it instead of adding another). */
export function findSingleTargetFilter(
  filters: DashboardGlobalFilter[],
  databaseId: string,
  fieldId: string
): DashboardGlobalFilter | undefined {
  return filters.find((filter) => {
    const entries = Object.entries(filter.targets);

    return entries.length === 1 && entries[0][0] === databaseId && entries[0][1] === fieldId;
  });
}

/** A name that still equals the primary property's name follows that property. */
function followPrimaryName(
  name: string,
  previous: GlobalFilterSourceField | undefined,
  next: GlobalFilterSourceField | undefined
) {
  if (!next) return name;
  if (!name.trim() || (previous && name === previous.name)) return next.name;
  return name;
}

/**
 * Map `databaseId` to `fieldId`. The content and the option names are kept:
 * the new source matches select options by name.
 */
export function setGlobalFilterTarget(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  databaseId: string,
  fieldId: string
): DashboardGlobalFilter {
  if (filter.targets[databaseId] === fieldId) return filter;
  const primaryDatabaseId = getPrimaryTargetDatabaseId(filter);
  const isPrimary = !primaryDatabaseId || primaryDatabaseId === databaseId;
  const targets = { ...filter.targets, [databaseId]: fieldId };

  if (!isPrimary) return { ...filter, targets };
  const previousField = getPrimaryTargetField(filter, sources);
  const nextField = findSourceField(sources, databaseId, fieldId);

  return { ...filter, targets, name: followPrimaryName(filter.name, previousField, nextField) };
}

/** Remove the mapping for `databaseId`; the next mapping becomes primary. */
export function removeGlobalFilterTarget(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  databaseId: string
): DashboardGlobalFilter {
  if (!(databaseId in filter.targets)) return filter;
  const wasPrimary = getPrimaryTargetDatabaseId(filter) === databaseId;
  const targets = { ...filter.targets };

  delete targets[databaseId];
  if (!wasPrimary) return { ...filter, targets };

  const previousField = getPrimaryTargetField(filter, sources);
  const next = { ...filter, targets };
  const nextField = getPrimaryTargetField(next, sources);

  next.name = followPrimaryName(filter.name, previousField, nextField);
  return next;
}

/**
 * Drop the mappings of databases that no longer have a widget on the
 * dashboard (stale targets, WP08 §1.8). Removing a primary mapping promotes
 * the next one, exactly like `removeGlobalFilterTarget` (pass the loaded
 * `sources` so the name can follow the new primary property). Returns
 * `filters` itself when nothing changes.
 */
export function detachRemovedGlobalFilterSources(
  filters: DashboardGlobalFilter[],
  widgetDatabaseIds: ReadonlySet<string>,
  sources: GlobalFilterSource[] = []
): DashboardGlobalFilter[] {
  let changed = false;
  const next = filters.map((filter) => {
    const updated = Object.keys(filter.targets)
      .filter((databaseId) => !widgetDatabaseIds.has(databaseId))
      .reduce((current, databaseId) => removeGlobalFilterTarget(current, sources, databaseId), filter);

    if (updated !== filter) changed = true;
    return updated;
  });

  return changed ? next : filters;
}

export function replaceGlobalFilter(
  filters: DashboardGlobalFilter[],
  filterId: string,
  updater: (filter: DashboardGlobalFilter) => DashboardGlobalFilter
): DashboardGlobalFilter[] {
  let changed = false;
  const next = filters.map((filter) => {
    if (filter.id !== filterId) return filter;
    const updated = updater(filter);

    if (updated !== filter) changed = true;
    return updated;
  });

  return changed ? next : filters;
}

export function removeGlobalFilter(filters: DashboardGlobalFilter[], filterId: string): DashboardGlobalFilter[] {
  const next = filters.filter((filter) => filter.id !== filterId);

  return next.length === filters.length ? filters : next;
}
