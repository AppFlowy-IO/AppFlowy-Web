import { Filter } from '@/application/database-yjs';

export interface RelationTypeOption {
  database_id: string;
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
