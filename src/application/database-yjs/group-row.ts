import { getGroupCellData } from '@/application/database-yjs/group';
import { YjsDatabaseKey } from '@/application/types';
import type { FieldId, YDatabaseFields, YDatabaseView } from '@/application/types';

export function getGroupRowCellsData(
  fields?: YDatabaseFields,
  groupFieldId?: string,
  groupId?: string,
  view?: YDatabaseView
): Record<FieldId, string> | undefined {
  const field = groupFieldId ? fields?.get(groupFieldId) : undefined;

  if (!groupFieldId || !field || !groupId) return undefined;

  if (groupId === field.get(YjsDatabaseKey.id)) {
    // An explicit missing-value group must override same-field filter prefills.
    return { [groupFieldId]: '' };
  }

  // Read configuration at insertion time: overflow groups use the current
  // interval, which may have changed since the row action was rendered.
  const content = view
    ?.get(YjsDatabaseKey.groups)
    ?.toArray()
    .find((group) => group.get(YjsDatabaseKey.field_id) === groupFieldId)
    ?.get(YjsDatabaseKey.content);
  const value = getGroupCellData(groupId, field, content);

  return value === undefined ? undefined : { [groupFieldId]: value };
}
