import { FieldType } from '@/application/database-yjs';
import type { Column, Row, RowMeta } from '@/application/database-yjs';

export interface ListFieldGroups {
  leading: Column[];
  primary?: Column;
  trailing: Column[];
}

/**
 * Desktop List keeps the view's persisted field order. Properties before the
 * primary field stay on its leading side, and the remaining visible
 * properties are aligned to the trailing edge of the row.
 */
export function splitListFields(fields: Column[], groupFieldId?: string): ListFieldGroups {
  const primaryIndex = fields.findIndex((field) => field.isPrimary);
  const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : fields.length > 0 ? 0 : -1;
  const primary = resolvedPrimaryIndex >= 0 ? fields[resolvedPrimaryIndex] : undefined;
  const isListProperty = (field: Column) => !field.isPrimary && field.fieldId !== groupFieldId;

  return {
    leading: resolvedPrimaryIndex > 0 ? fields.slice(0, resolvedPrimaryIndex).filter(isListProperty) : [],
    primary,
    trailing:
      resolvedPrimaryIndex >= 0
        ? fields.slice(resolvedPrimaryIndex + 1).filter(isListProperty)
        : fields.filter(isListProperty),
  };
}

export function getListLeadingFieldMinWidth(fieldType?: FieldType): number | undefined {
  if (fieldType === FieldType.Checkbox) return 20;
  if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) return 60;
  return undefined;
}

export function getVisibleListRows(rows: Row[] | undefined, visibleLimit: number): Row[] | undefined {
  return rows?.slice(0, visibleLimit);
}

export function getListRemainingRowCount(rows: Row[] | undefined, visibleLimit: number): number {
  return rows ? Math.max(rows.length - visibleLimit, 0) : 0;
}

export type ListPrimaryIndicator = 'icon' | 'document' | 'none';

/** Emoji/custom icons take precedence over the document indicator on Desktop. */
export function resolveListPrimaryIndicator(
  meta?: Pick<RowMeta, 'icon' | 'isEmptyDocument'> | null
): ListPrimaryIndicator {
  if (meta?.icon) return 'icon';
  if (meta?.isEmptyDocument === false) return 'document';
  return 'none';
}

const LIST_ROW_INTERACTIVE_TARGET_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-list-interactive="true"]',
  '[role="button"]',
].join(',');

export function isListRowInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(LIST_ROW_INTERACTIVE_TARGET_SELECTOR));
}
