import { FieldType } from '@/application/database-yjs';

const isRelationRollupEditEnabled = import.meta.env.APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT === 'true';

export function isFieldEditingEnabled(fieldType?: FieldType): boolean {
  if (fieldType === undefined) {
    return true;
  }

  switch (fieldType) {
    case FieldType.Relation:
    case FieldType.Rollup:
      return isRelationRollupEditEnabled;
    default:
      return true;
  }
}

export function isFieldEditingDisabled(fieldType?: FieldType): boolean {
  return !isFieldEditingEnabled(fieldType);
}
