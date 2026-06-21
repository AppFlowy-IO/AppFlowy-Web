import { Filter } from '@/application/database-yjs';

export interface RelationTypeOption {
  database_id: string;
  is_two_way: boolean;
  reciprocal_field_id?: string;
  reciprocal_field_name?: string;
  source_limit: RelationLimit;
  target_limit: RelationLimit;
}

export enum RelationLimit {
  NoLimit = 0,
  OneOnly = 1,
}

export enum RelationFilterCondition {
  RelationIsEmpty = 0,
  RelationIsNotEmpty = 1,
  RelationContains = 2,
  RelationDoesNotContain = 3,
  RelationLegacyTextIsEmpty = 6,
  RelationLegacyTextIsNotEmpty = 7,
}

export interface RelationFilter extends Filter {
  condition: RelationFilterCondition;
}
