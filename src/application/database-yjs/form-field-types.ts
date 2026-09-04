import { FieldType } from '@/application/database-yjs/database.type';

/**
 * Database field types that can be projected into respondent-editable form
 * questions. Keep this list aligned with the cloud's `project_kind` and the
 * desktop `formQuestionFieldTypes` list.
 */
export const FORM_QUESTION_FIELD_TYPES: readonly FieldType[] = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.URL,
  FieldType.Media,
];

const FORM_QUESTION_FIELD_TYPE_SET = new Set<FieldType>(FORM_QUESTION_FIELD_TYPES);

export function isFormQuestionFieldType(fieldType: FieldType): boolean {
  return FORM_QUESTION_FIELD_TYPE_SET.has(fieldType);
}
