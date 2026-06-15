import { YDatabaseField } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { RelationLimit, RelationTypeOption } from './relation.type';

export function parseRelationTypeOption(field: YDatabaseField) {
  const relationTypeOption = getTypeOptions(field)?.toJSON();

  return normalizeRelationTypeOption(relationTypeOption);
}

export function normalizeRelationTypeOption(value?: Partial<RelationTypeOption> | null): RelationTypeOption {
  return {
    database_id: value?.database_id ?? '',
    is_two_way: value?.is_two_way ?? false,
    reciprocal_field_id: value?.reciprocal_field_id || undefined,
    reciprocal_field_name: value?.reciprocal_field_name || undefined,
    source_limit: normalizeRelationLimit(value?.source_limit),
    target_limit: normalizeRelationLimit(value?.target_limit),
  };
}

function normalizeRelationLimit(value: unknown): RelationLimit {
  return Number(value) === RelationLimit.OneOnly ? RelationLimit.OneOnly : RelationLimit.NoLimit;
}
