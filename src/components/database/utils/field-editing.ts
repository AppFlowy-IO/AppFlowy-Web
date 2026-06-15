import { FieldType } from '@/application/database-yjs';

// Field types whose cell content is not user-editable on web. The property
// menu (relation/calc config etc.) is still openable for these — gate that
// at the call site, not here. Rollup cells are computed (read-only) but the
// property must be configurable, so it is intentionally NOT in this list.
const unsupportedFieldTypes: FieldType[] = [];

export function isFieldEditingEnabled(fieldType?: FieldType): boolean {
  if (fieldType === undefined) {
    return true;
  }

  if (unsupportedFieldTypes.includes(fieldType)) {
    return false;
  }

  return true;
}

export function isFieldEditingDisabled(fieldType?: FieldType): boolean {
  return !isFieldEditingEnabled(fieldType);
}
