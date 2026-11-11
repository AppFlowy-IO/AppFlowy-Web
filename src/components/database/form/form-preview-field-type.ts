import { FieldType } from '@/application/database-yjs/database.type';
import type { PublicQuestionKind } from '@/application/types/form';

export function previewFieldType(kind: PublicQuestionKind): FieldType {
  switch (kind) {
    case 'number':
      return FieldType.Number;
    case 'single_select':
      return FieldType.SingleSelect;
    case 'multi_select':
      return FieldType.MultiSelect;
    case 'date':
      return FieldType.DateTime;
    case 'files':
      return FieldType.Media;
    case 'checkbox':
      return FieldType.Checkbox;
    case 'url':
      return FieldType.URL;
    default:
      return FieldType.RichText;
  }
}
