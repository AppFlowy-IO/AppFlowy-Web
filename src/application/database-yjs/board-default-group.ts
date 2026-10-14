import { FieldType } from '@/application/database-yjs/database.type';
import { DatabaseViewLayout, YDatabaseFields, YDatabaseView, YjsDatabaseKey } from '@/application/types';

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

    return [FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox].includes(type);
  });

  if (!fieldId) return;
  return { id: `default-board:${fieldId}`, fieldId };
}
