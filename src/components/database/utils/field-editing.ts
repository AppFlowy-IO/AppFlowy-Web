import { FieldType } from '@/application/database-yjs';

const isRelationEditEnabled = import.meta.env.APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT === 'true';

// Field types that are not yet supported on web
const unsupportedFieldTypes = [FieldType.Rollup];

export function isFieldEditingEnabled(fieldType?: FieldType): boolean {
  if (fieldType === undefined) {
    return true;
  }

  // Rollup is always disabled on web (coming soon)
  if (unsupportedFieldTypes.includes(fieldType)) {
    return false;
  }

  switch (fieldType) {
    case FieldType.Relation:
      return isRelationEditEnabled;
    default:
      return true;
  }
}

export function isFieldEditingDisabled(fieldType?: FieldType): boolean {
  return !isFieldEditingEnabled(fieldType);
}
