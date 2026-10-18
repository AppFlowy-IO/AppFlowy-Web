import { useMemo } from 'react';

import { useDatabaseFields } from '@/application/database-yjs/context';
import type { FieldType } from '@/application/database-yjs/database.type';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { YjsDatabaseKey } from '@/application/types';

/** Table selection is independent of which properties are shown on bars. */
export function useTimelineTableFieldIds(
  requestedIds: readonly string[],
  primaryFieldId: string | null | undefined
): string[] {
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();

  return useMemo(() => {
    // Yjs keeps the map identity when a field is deleted or restored.
    void fieldsVersion;
    return requestedIds.filter((fieldId) => fieldId !== primaryFieldId && fields?.has(fieldId));
  }, [fields, fieldsVersion, primaryFieldId, requestedIds]);
}

/**
 * The table columns' field types, resolved once per view so every row's cells
 * read them from props instead of each subscribing to its field.
 */
export function useTimelineTableFieldTypes(tableFieldIds: readonly string[]): ReadonlyMap<string, FieldType> {
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();

  return useMemo(() => {
    void fieldsVersion;
    return new Map(
      tableFieldIds.map(
        (fieldId) => [fieldId, Number(fields?.get(fieldId)?.get(YjsDatabaseKey.type)) as FieldType] as const
      )
    );
  }, [fields, fieldsVersion, tableFieldIds]);
}
