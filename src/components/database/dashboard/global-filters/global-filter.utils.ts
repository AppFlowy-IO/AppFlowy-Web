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

export function isGlobalFilterFieldType(type: FieldType): boolean {
  return GLOBAL_FILTER_FIELD_TYPES.includes(type);
}

/**
 * A global filter stores its content once, but for some property types the
 * content is only meaningful against one database's field:
 *
 * - SingleSelect / MultiSelect content is a comma-separated list of option ids,
 *   and option ids are generated per database. The option list shown in the
 *   editor therefore comes from the *primary* target (the first mapped source),
 *   and another source may only be mapped when its field carries every option
 *   of the primary field with the same id and the same name (true for databases
 *   duplicated from one another or created from the same template). Matching by
 *   name alone is not enough, because evaluation compares ids.
 * - Person content is a list of workspace person ids and Checklist content is
 *   empty (the condition carries the value), so both are portable across
 *   databases and need no extra check.
 */
export function usesOptionContent(type: FieldType): boolean {
  return type === FieldType.SingleSelect || type === FieldType.MultiSelect;
}

export function fieldsOfType(source: GlobalFilterSource | undefined, type: FieldType): GlobalFilterSourceField[] {
  return source ? source.fields.filter((field) => field.type === type) : [];
}

/** Union of the supported property types present in any source, in picker order. */
export function getAvailableFieldTypes(sources: GlobalFilterSource[]): FieldType[] {
  const present = new Set<FieldType>();

  sources.forEach((source) => source.fields.forEach((field) => present.add(field.type)));
  return GLOBAL_FILTER_FIELD_TYPES.filter((type) => present.has(type));
}

/** Number of sources that have at least one property of `type`. */
export function countSourcesWithFieldType(sources: GlobalFilterSource[], type: FieldType): number {
  return sources.filter((source) => fieldsOfType(source, type).length > 0).length;
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
export function getPrimaryTargetDatabaseId(filter: DashboardGlobalFilter): string | undefined {
  return Object.keys(filter.targets)[0];
}

export function getPrimaryTargetField(
  filter: DashboardGlobalFilter,
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
export function countGlobalFilterSources(filter: DashboardGlobalFilter, sources?: GlobalFilterSource[]): number {
  const databaseIds = Object.keys(filter.targets);

  if (!sources) return databaseIds.length;
  return databaseIds.filter((databaseId) => isGlobalFilterTargetUsable(filter, sources, databaseId)).length;
}

/** Whether `candidate` carries every option of `primary` (same id, same name). */
export function areOptionFieldsCompatible(primary: GlobalFilterSourceField, candidate: GlobalFilterSourceField) {
  const names = new Map(candidate.options.map((option) => [option.id, option.name]));

  return primary.options.every((option) => names.get(option.id) === option.name);
}

/** The properties of `databaseId` the filter may be mapped to. */
export function getTargetCandidates(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  databaseId: string
): GlobalFilterSourceField[] {
  const source = sources.find((item) => item.databaseId === databaseId);
  const fields = fieldsOfType(source, filter.fieldType);

  if (!usesOptionContent(filter.fieldType)) return fields;
  const primaryDatabaseId = getPrimaryTargetDatabaseId(filter);

  // The primary source (or the first mapping to be made) defines the options.
  if (!primaryDatabaseId || primaryDatabaseId === databaseId) return fields;
  const primaryField = getPrimaryTargetField(filter, sources);

  // Without the primary field the options cannot be verified.
  if (!primaryField) return [];
  return fields.filter((field) => areOptionFieldsCompatible(primaryField, field));
}

/**
 * The mapped sources in mapping order (the first one is primary). A mapping
 * whose database is not loaded (its widget is still mounting, or was removed
 * from the dashboard) is listed without properties so it can still be removed.
 */
export function getMappedSources(
  filter: DashboardGlobalFilter,
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

/** Unmapped sources that have a property the filter can be mapped to. */
export function getAddableSources(filter: DashboardGlobalFilter, sources: GlobalFilterSource[]) {
  return sources.filter(
    (source) =>
      !(source.databaseId in filter.targets) && getTargetCandidates(filter, sources, source.databaseId).length > 0
  );
}

/** Map `databaseId` to its first compatible property (no-op when it has none). */
export function addGlobalFilterSource(
  filter: DashboardGlobalFilter,
  sources: GlobalFilterSource[],
  databaseId: string
): DashboardGlobalFilter {
  if (databaseId in filter.targets) return filter;
  const field = getTargetCandidates(filter, sources, databaseId)[0];

  return field ? setGlobalFilterTarget(filter, sources, databaseId, field.id) : filter;
}

/**
 * Map every source that has a property of `type` to its first such property.
 * For option types the first mapped source is the primary one and later
 * sources only get a property compatible with it.
 */
export function buildDefaultTargets(sources: GlobalFilterSource[], type: FieldType): Record<string, string> {
  const targets: Record<string, string> = {};
  let primary: GlobalFilterSourceField | undefined;

  sources.forEach((source) => {
    const fields = fieldsOfType(source, type);
    const primaryField = primary;
    const field =
      primaryField && usesOptionContent(type)
        ? fields.find((candidate) => areOptionFieldsCompatible(primaryField, candidate))
        : fields[0];

    if (!field) return;
    if (!primary) primary = field;
    targets[source.databaseId] = field.id;
  });

  return targets;
}

export function createGlobalFilter(
  sources: GlobalFilterSource[],
  type: FieldType,
  fallbackName: string
): DashboardGlobalFilter {
  const targets = buildDefaultTargets(sources, type);
  const primaryDatabaseId = Object.keys(targets)[0];
  const primaryField = primaryDatabaseId
    ? findSourceField(sources, primaryDatabaseId, targets[primaryDatabaseId])
    : undefined;
  const defaults = getDefaultFilterCondition(type);

  return {
    id: generateDashboardId('gf'),
    name: primaryField?.name || fallbackName,
    fieldType: type,
    condition: defaults?.condition ?? 0,
    content: defaults?.content ?? '',
    targets,
  };
}

/** Keep only the selected option ids that exist on `field`, in field option order. */
export function pruneOptionContent(content: string, field: GlobalFilterSourceField | undefined): string {
  if (!field || !content) return content;
  const selected = new Set(content.split(',').filter(Boolean));

  return field.options
    .filter((option) => selected.has(option.id))
    .map((option) => option.id)
    .join(',');
}

/** Drop non-primary mappings whose property no longer matches the primary one. */
function pruneIncompatibleTargets(targets: Record<string, string>, sources: GlobalFilterSource[]) {
  const entries = Object.entries(targets);

  if (entries.length < 2) return targets;
  const [primaryDatabaseId, primaryFieldId] = entries[0];
  const primaryField = findSourceField(sources, primaryDatabaseId, primaryFieldId);

  if (!primaryField) return targets;
  const next: Record<string, string> = { [primaryDatabaseId]: primaryFieldId };

  entries.slice(1).forEach(([databaseId, fieldId]) => {
    const field = findSourceField(sources, databaseId, fieldId);

    // A mapping into a source that is not loaded was validated when it was made.
    if (!field || areOptionFieldsCompatible(primaryField, field)) next[databaseId] = fieldId;
  });

  return next;
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
 * Map `databaseId` to `fieldId`. Re-pointing the primary target of an option
 * type re-validates the select content and the other mappings against the new
 * primary property.
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

  if (!usesOptionContent(filter.fieldType)) {
    return { ...filter, targets, name: followPrimaryName(filter.name, previousField, nextField) };
  }

  return {
    ...filter,
    targets: pruneIncompatibleTargets(targets, sources),
    name: followPrimaryName(filter.name, previousField, nextField),
    content: pruneOptionContent(filter.content, nextField),
  };
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
  if (usesOptionContent(filter.fieldType)) {
    next.targets = pruneIncompatibleTargets(targets, sources);
    next.content = pruneOptionContent(filter.content, nextField);
  }

  return next;
}

/**
 * Drop the mappings of databases that no longer have a widget on the
 * dashboard. Removing a primary mapping promotes the next one, exactly like
 * `removeGlobalFilterTarget` (pass the loaded `sources` so option content and
 * the remaining mappings are re-validated). Returns `filters` itself when
 * nothing changes.
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
