import { FieldType } from '@/application/database-yjs/database.type';

export * from './type_option';
export * from './date';
export * from './number';
export * from './select-option';
export * from './text';
export * from './checkbox';
export * from './checklist';
export * from './relation';
export * from './person';

export function getFieldName (fieldType: FieldType) {
  switch (fieldType) {
    case FieldType.RichText:
      return 'Text';
    case FieldType.Number:
      return 'Numbers';
    case FieldType.Checkbox:
      return 'Checkbox';
    case FieldType.SingleSelect:
      return 'Select';
    case FieldType.MultiSelect:
      return 'Multiselect';
    case FieldType.DateTime:
      return 'Date';
    case FieldType.Checklist:
      return 'Checklist';
    case FieldType.Relation:
      return 'Relation';
    case FieldType.FileMedia:
      return 'Files & media';
    case FieldType.URL:
      return 'URL';
    case FieldType.LastEditedTime:
      return 'Last modified';
    case FieldType.CreatedTime:
      return 'Created at';
    case FieldType.AISummaries:
      return 'AI Summary';
    case FieldType.AITranslations:
      return 'AI Translate';
    case FieldType.Person:
      return 'Person';
    default:
      return 'Text';
  }
}
