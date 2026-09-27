import { useMemo } from 'react';

import { useDatabaseFields } from '@/application/database-yjs/context';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';

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
