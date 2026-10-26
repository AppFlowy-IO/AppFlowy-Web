import { FieldType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, YDatabaseFields, YDatabaseView, YjsDatabaseKey } from '@/application/types';

/**
 * Desktop lets a Board group by every groupable type, but the web Board only
 * draws select and checkbox columns.
 */
export const BOARD_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
];

/**
 * Legacy Board schemas and older creation receipts can omit persisted grouping.
 * Resolve their default without writing to the collab, so readers can open them too.
 * A persisted group always wins, including one whose field was later deleted.
 */
export function resolveDefaultBoardGroup(view?: YDatabaseView, fields?: YDatabaseFields) {
  if (!view || !fields || Number(view.get(YjsDatabaseKey.layout)) !== DatabaseViewLayout.Board) return;
  if (view.get(YjsDatabaseKey.groups)?.length) return;

  const orderedIds = view.get(YjsDatabaseKey.field_orders)?.toArray().map((field) => field.id) ?? [];
  const fieldIds = [...new Set([...orderedIds, ...fields.keys()])];
  const fieldId = fieldIds.find((id) => {
    const type = Number(fields.get(id)?.get(YjsDatabaseKey.type));

    return BOARD_GROUPABLE_FIELD_TYPES.includes(type);
  });

  if (!fieldId) return;
  return { id: `default-board:${fieldId}`, fieldId };
}

/**
 * A Board without persisted grouping and without a Select, MultiSelect or
 * Checkbox property has nothing to group by. Desktop then creates a "Status"
 * Single select property; editable web Boards do the same. A schema with no
 * fields at all is still loading and never qualifies.
 */
export function boardNeedsGroupingField(view?: YDatabaseView, fields?: YDatabaseFields) {
  if (!view || !fields?.size || Number(view.get(YjsDatabaseKey.layout)) !== DatabaseViewLayout.Board) return false;
  if (view.get(YjsDatabaseKey.groups)?.length) return false;

  return !resolveDefaultBoardGroup(view, fields);
}
