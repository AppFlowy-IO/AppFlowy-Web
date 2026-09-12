import { YDatabase, YDatabaseField, YDatabaseFilter, YjsDatabaseKey } from '@/application/types';

import { CalculationType, FieldType, RollupDisplayMode } from '../database.type';
import { ChecklistFilterCondition } from '../fields/checklist/checklist.type';
import { DateFilterCondition } from '../fields/date/date.type';
import { RelationFilterCondition } from '../fields/relation/relation.type';
import { parseRollupTypeOption } from '../fields/rollup/parse';
import { RollupFilterMetadata, RollupFilterMode, RollupTypeOption } from '../fields/rollup/rollup.type';
import { SelectOptionFilterCondition } from '../fields/select-option/select_option.type';
import { TextFilterCondition } from '../fields/text/text.type';

const dateCalculations = new Set<number>([
  CalculationType.DateEarliest,
  CalculationType.DateLatest,
  CalculationType.DateRange,
]);

const resolvedTargets = new WeakMap<
  YDatabaseField,
  { relationId: string; targetId: string; field: YDatabaseField; signature: string }
>();
const targetListeners = new WeakMap<YDatabaseField, Set<() => void>>();

export function subscribeRollupTarget(field: YDatabaseField | undefined, listener: () => void) {
  if (!field) return () => undefined;
  const listeners = targetListeners.get(field) ?? new Set();

  listeners.add(listener);
  targetListeners.set(field, listeners);
  return () => {
    listeners.delete(listener);
  };
}

export function rollupTargetSnapshot(field?: YDatabaseField) {
  return field ? resolvedTargets.get(field)?.signature ?? '' : '';
}

export function rememberRollupTarget(field: YDatabaseField, target: YDatabaseField) {
  const option = parseRollupTypeOption(field);

  const signature = JSON.stringify(
    [option?.relation_field_id, option?.target_field_id, target.toJSON()],
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
  );

  if (resolvedTargets.get(field)?.signature === signature) return;
  resolvedTargets.set(field, {
    relationId: option?.relation_field_id,
    targetId: option?.target_field_id,
    field: target,
    signature,
  });
  targetListeners.get(field)?.forEach((listener) => listener());
}

export function resolvedRollupTarget(field?: YDatabaseField) {
  if (!field) return undefined;
  const cached = resolvedTargets.get(field);
  const option = parseRollupTypeOption(field);

  return cached && cached.relationId === option?.relation_field_id && cached.targetId === option?.target_field_id
    ? cached.field
    : undefined;
}

export function resolvedRollupSourceType(field?: YDatabaseField): FieldType | undefined {
  const target = resolvedRollupTarget(field);

  return target ? Number(target.get(YjsDatabaseKey.type)) : undefined;
}

export function parseRollupFilterMetadata(value: unknown): RollupFilterMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const read = (key: string) =>
    typeof (value as YDatabaseFilter).get === 'function'
      ? (value as YDatabaseFilter).get(key as YjsDatabaseKey.id)
      : (value as Record<string, unknown>)[key];
  const metadata: Record<string, number | string> = {};

  for (const key of ['target_field_type', 'rollup_filter_mode', 'rollup_show_as', 'rollup_calculation_type']) {
    const raw = read(key);

    if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw))) metadata[key] = Number(raw);
  }

  for (const key of ['relation_field_id', 'target_field_id']) {
    const raw = read(key);

    if (typeof raw === 'string') metadata[key] = raw;
  }

  return metadata;
}

export function rollupResultType(
  option: Pick<RollupTypeOption, 'show_as' | 'calculation_type'>,
  sourceType?: FieldType
): FieldType {
  if (Number(option.show_as ?? RollupDisplayMode.Calculated) === RollupDisplayMode.Calculated) {
    return dateCalculations.has(Number(option.calculation_type ?? CalculationType.Count))
      ? FieldType.DateTime
      : FieldType.Number;
  }

  switch (sourceType) {
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return FieldType.DateTime;
    case FieldType.URL:
      return FieldType.RichText;
    case FieldType.Number:
    case FieldType.DateTime:
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
    case FieldType.Checkbox:
    case FieldType.Checklist:
    case FieldType.Relation:
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
    case FieldType.Media:
      return sourceType;
    default:
      return FieldType.RichText;
  }
}

export function newRollupFilterMetadata(field: YDatabaseField, sourceType?: FieldType): RollupFilterMetadata {
  const resolvedSourceType = sourceType ?? resolvedRollupSourceType(field);
  const option = parseRollupTypeOption(field);
  const showAs = Number(option?.show_as ?? RollupDisplayMode.Calculated);

  return {
    ...(resolvedSourceType === undefined ? {} : { target_field_type: resolvedSourceType }),
    rollup_show_as: showAs,
    ...(showAs === RollupDisplayMode.Calculated
      ? { rollup_calculation_type: Number(option?.calculation_type ?? CalculationType.Count) }
      : { rollup_filter_mode: RollupFilterMode.Any }),
    relation_field_id: option?.relation_field_id ?? '',
    target_field_id: option?.target_field_id ?? '',
  };
}

export function rollupPredicateType(
  filter: { rollupTargetFieldType?: FieldType; rollupMetadata?: RollupFilterMetadata },
  field?: YDatabaseField
): FieldType {
  if (filter.rollupTargetFieldType !== undefined) return filter.rollupTargetFieldType;
  const option = field && parseRollupTypeOption(field);

  // Legacy list and date-calculation filters were display-text predicates.
  if (!filter.rollupMetadata) {
    return option?.show_as === RollupDisplayMode.Calculated && !dateCalculations.has(Number(option.calculation_type))
      ? FieldType.Number
      : FieldType.RichText;
  }

  return rollupResultType(
    {
      show_as: filter.rollupMetadata.rollup_show_as ?? option?.show_as ?? RollupDisplayMode.Calculated,
      calculation_type:
        filter.rollupMetadata.rollup_calculation_type ?? option?.calculation_type ?? CalculationType.Count,
    },
    filter.rollupMetadata.target_field_type
  );
}

export function rollupListMode(filter: {
  rollupTargetFieldType?: FieldType;
  rollupMetadata?: RollupFilterMetadata;
}): RollupFilterMode | undefined {
  const meta = filter.rollupMetadata;

  if (!meta || ![RollupDisplayMode.OriginalList, RollupDisplayMode.UniqueList].includes(meta.rollup_show_as!)) return;
  if (meta.target_field_type === undefined || meta.rollup_filter_mode === undefined) return;
  if (
    rollupResultType(
      { show_as: meta.rollup_show_as!, calculation_type: CalculationType.Count },
      meta.target_field_type
    ) !== rollupPredicateType(filter)
  )
    return;
  if (
    meta.target_field_type === FieldType.Rollup ||
    meta.target_field_type === FieldType.Time ||
    meta.target_field_type === FieldType.Summary ||
    meta.target_field_type === FieldType.Translate
  )
    return;
  return meta.rollup_filter_mode;
}

export function rollupHasEndDate(meta?: RollupFilterMetadata) {
  return meta?.rollup_show_as === RollupDisplayMode.Calculated
    ? meta.rollup_calculation_type === CalculationType.DateRange
    : meta?.target_field_type === FieldType.DateTime;
}

export function isEndDateCondition(condition: number) {
  return (
    (condition >= DateFilterCondition.DateEndsOn && condition <= DateFilterCondition.DateEndIsNotEmpty) ||
    condition >= DateFilterCondition.DateEndsToday
  );
}

export function rollupConfigurationMatches(a?: RollupFilterMetadata, b?: RollupFilterMetadata) {
  if (!a || !b) return true;
  const keys: (keyof RollupFilterMetadata)[] = [
    'target_field_type',
    'relation_field_id',
    'target_field_id',
    'rollup_show_as',
  ];

  if (a.rollup_show_as === RollupDisplayMode.Calculated || b.rollup_show_as === RollupDisplayMode.Calculated)
    keys.push('rollup_calculation_type');
  return keys.every((key) => a[key] === undefined || b[key] === undefined || a[key] === b[key]);
}

// These are the desktop migration defaults, including native select/person/media conditions.
export function defaultRollupPredicate(type: FieldType) {
  const condition =
    type === FieldType.RichText
      ? TextFilterCondition.TextContains
      : type === FieldType.MultiSelect
      ? SelectOptionFilterCondition.OptionContains
      : type === FieldType.Relation
      ? RelationFilterCondition.RelationContains
      : type === FieldType.Checklist
      ? ChecklistFilterCondition.IsIncomplete
      : 0;

  return {
    condition,
    content:
      type === FieldType.Person ||
      type === FieldType.CreatedBy ||
      type === FieldType.LastEditedBy ||
      type === FieldType.Relation
        ? '[]'
        : '',
  };
}

/** Migrate in place across views, preserving filter IDs and arbitrary AND/OR nesting. */
export function migrateRollupFilters(
  database: YDatabase,
  fieldId: string,
  sourceType?: FieldType,
  previous?: RollupTypeOption | null,
  sourceChanged = false
) {
  const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

  if (!field) return;
  const next = newRollupFilterMetadata(field, sourceType);
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const map = typeof (node as YDatabaseFilter).get === 'function' ? (node as YDatabaseFilter) : undefined;
    const obj = map ? undefined : (node as Record<string, unknown>);
    const get = (key: YjsDatabaseKey) => (map ? map.get(key as YjsDatabaseKey.id) : obj![key]);
    const children = get(YjsDatabaseKey.children);

    if (Array.isArray(children)) {
      const updated = children.map(visit);

      if (updated.some((child, i) => child !== children[i])) {
        if (map) map.set(YjsDatabaseKey.children, updated);
        else return { ...obj, [YjsDatabaseKey.children]: updated };
      }
    } else if (children && typeof (children as { toArray?: unknown }).toArray === 'function') {
      const array = children as import('yjs').Array<unknown>;

      array.toArray().forEach((child, i) => {
        const updated = visit(child);

        if (updated !== child) {
          array.delete(i);
          array.insert(i, [updated]);
        }
      });
    }

    if (get(YjsDatabaseKey.field_id) !== fieldId) return node;
    const old = parseRollupFilterMetadata(get(YjsDatabaseKey.rollup_meta));
    const previousShowAs = old?.rollup_show_as ?? previous?.show_as;

    if (previousShowAs === undefined && !sourceChanged) return node;
    const metadata = {
      ...next,
      ...(sourceType === undefined && old?.target_field_type !== undefined
        ? { target_field_type: old.target_field_type }
        : {}),
    };
    const list = metadata.rollup_show_as !== RollupDisplayMode.Calculated;
    const type = rollupResultType(
      { show_as: metadata.rollup_show_as!, calculation_type: metadata.rollup_calculation_type ?? CalculationType.Count },
      metadata.target_field_type
    );
    const oldType = rollupPredicateType(
      {
        rollupTargetFieldType:
          get(YjsDatabaseKey.rollup_target_type) === undefined
            ? undefined
            : Number(get(YjsDatabaseKey.rollup_target_type)),
        rollupMetadata: old,
      },
      field
    );
    const changedSource =
      sourceChanged ||
      (!!previous &&
        (previous.relation_field_id !== metadata.relation_field_id ||
          previous.target_field_id !== metadata.target_field_id)) ||
      (old?.relation_field_id !== undefined && old.relation_field_id !== metadata.relation_field_id) ||
      (old?.target_field_id !== undefined && old.target_field_id !== metadata.target_field_id);
    const reset =
      changedSource ||
      list !== (previousShowAs !== RollupDisplayMode.Calculated) ||
      (sourceType !== undefined && sourceType !== (old ? old.target_field_type : oldType)) ||
      oldType !== type ||
      (type === FieldType.DateTime &&
        isEndDateCondition(Number(get(YjsDatabaseKey.condition))) &&
        !rollupHasEndDate(metadata));

    if (list && !reset) {
      delete metadata.rollup_filter_mode;
      if (old?.rollup_filter_mode !== undefined) metadata.rollup_filter_mode = old.rollup_filter_mode;
    }

    const updates: Record<string, unknown> = {
      [YjsDatabaseKey.rollup_meta]: metadata,
      [YjsDatabaseKey.rollup_target_type]: type,
    };

    if (reset) Object.assign(updates, defaultRollupPredicate(type));
    const changed = Object.entries(updates).some(([key, value]) => {
      const current =
        key === YjsDatabaseKey.rollup_meta
          ? old
          : key === YjsDatabaseKey.rollup_target_type || key === YjsDatabaseKey.condition
          ? Number(get(key as YjsDatabaseKey))
          : get(key as YjsDatabaseKey);

      const expected = key === YjsDatabaseKey.rollup_meta ? parseRollupFilterMetadata(value) : value;

      return JSON.stringify(current) !== JSON.stringify(expected);
    });

    if (!changed) return node;
    if (!map) return { ...obj, ...updates };
    Object.entries(updates).forEach(([key, value]) => map.set(key, value));
    return node;
  };

  database.get(YjsDatabaseKey.views)?.forEach((view) => {
    const filters = view.get(YjsDatabaseKey.filters);

    filters?.toArray().forEach((node, i) => {
      const updated = visit(node);

      if (updated !== node) {
        filters.delete(i);
        filters.insert(i, [updated as YDatabaseFilter]);
      }
    });
  });
}

/** A relation can switch databases while retaining its field ID. */
export function migrateRollupsForRelation(database: YDatabase, relationId: string) {
  database.get(YjsDatabaseKey.fields)?.forEach((field, fieldId) => {
    if (
      Number(field.get(YjsDatabaseKey.type)) !== FieldType.Rollup ||
      parseRollupTypeOption(field)?.relation_field_id !== relationId
    )
      return;
    resolvedTargets.delete(field);
    targetListeners.get(field)?.forEach((listener) => listener());
    migrateRollupFilters(database, fieldId, undefined, undefined, true);
  });
}
