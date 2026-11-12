import type { TFunction } from 'i18next';

import { FieldType } from '@/application/database-yjs/database.type';

export function fieldTypeLabel(
  // Plain `TFunction` instead of `ReturnType<typeof useTranslation>['t']`
  // — the latter forces TypeScript 4.9 to fully expand the typed
  // i18next key union and `pnpm type-check` aborts with
  // `RangeError: Map maximum size exceeded`. Same call-signature at the
  // use site, but with a tractable type.
  t: TFunction,
  ty: FieldType
): string {
  switch (ty) {
    case FieldType.RichText:
      return t('grid.field.textFieldName');
    case FieldType.Number:
      return t('grid.field.numberFieldName');
    case FieldType.SingleSelect:
      return t('grid.field.singleSelectFieldName');
    case FieldType.MultiSelect:
      return t('grid.field.multiSelectFieldName');
    case FieldType.Checkbox:
      return t('grid.field.checkboxFieldName');
    case FieldType.DateTime:
      return t('grid.field.dateFieldName');
    case FieldType.URL:
      return t('grid.field.urlFieldName');
    case FieldType.Media:
      return t('grid.field.mediaFieldName');
    default:
      return 'Property';
  }
}
