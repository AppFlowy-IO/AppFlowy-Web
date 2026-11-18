import { FieldType } from '@/application/database-yjs/database.type';
import { RuleTrigger } from '@/application/services/js-services/http/automation-api';
import {
  checkboxFilterConditions,
  numberFilterConditions,
  personFilterConditions,
  singleSelectFilterConditions,
  multiSelectFilterConditions,
  textFilterConditions,
  Translate,
} from '@/components/database/components/filters/filter-conditions';

const supportedTypes = new Set([
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.URL,
  FieldType.Relation,
  FieldType.Person,
]);

export function supportsPropertyEvent(ty: FieldType): boolean {
  return supportedTypes.has(ty);
}

export function propertyOperators(ty: number | undefined, t: Translate) {
  switch (ty) {
    case FieldType.RichText:
    case FieldType.URL:
      return textFilterConditions(t);
    case FieldType.Number:
      return numberFilterConditions(t);
    case FieldType.Checkbox:
      return checkboxFilterConditions(t);
    case FieldType.SingleSelect:
      return singleSelectFilterConditions(t);
    case FieldType.MultiSelect:
      return multiSelectFilterConditions(t);
    case FieldType.Person:
      return personFilterConditions(t);
    case FieldType.Relation:
      return [
        { value: 0, text: t('grid.personFilter.isEmpty') },
        { value: 1, text: t('grid.personFilter.isNotEmpty') },
        { value: 2, text: t('grid.personFilter.contains') },
        { value: 3, text: t('grid.personFilter.doesNotContain') },
      ];
    default:
      return [];
  }
}

export function propertyOperand(ty: number | undefined, condition: number | undefined) {
  if (condition === undefined || !propertyOperators(ty, (key) => key).some((op) => op.value === condition))
    return undefined;
  switch (ty) {
    case FieldType.RichText:
    case FieldType.URL:
      return condition >= 6 ? 'none' : 'text';
    case FieldType.Number:
      return condition >= 6 ? 'none' : 'number';
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return condition >= 4 ? 'none' : 'options';
    case FieldType.Person:
      return condition >= 2 ? 'none' : 'person';
    case FieldType.Relation:
      return condition < 2 ? 'none' : 'relation';
    default:
      return 'none';
  }
}

export function propertyIdentityIds(content: string): string[] {
  try {
    const ids: unknown = JSON.parse(content);

    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : [];
  } catch {
    return [];
  }
}

export function validPropertyEvent(trigger: RuleTrigger): boolean {
  const { field_id, ty, condition, content } = trigger;

  if (!field_id || typeof content !== 'string' || new Blob([content]).size > 4096) return false;
  const operand = propertyOperand(ty, condition);

  if (!operand) return false;
  if (operand === 'none') return content === '';
  if (operand === 'text') return content.trim().length > 0;
  if (operand === 'number')
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(content) && Number.isFinite(Number(content));
  const ids = operand === 'options' ? content.split(',') : propertyIdentityIds(content);

  return (
    ids.length > 0 &&
    ids.length <= 32 &&
    new Set(operand === 'options' ? ids : ids.map((id) => id.toLowerCase())).size === ids.length &&
    ids.every((id) =>
      operand === 'options' ? id.length > 0 && id === id.trim() : /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
    )
  );
}
