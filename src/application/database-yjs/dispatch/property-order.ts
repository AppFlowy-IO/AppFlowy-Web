import { useCallback } from 'react';

import { useReorderColumnDispatch } from '@/application/database-yjs/dispatch';

/** Every property, including Verification, has a native field order. */
export function useReorderPropertiesDispatch() {
  const reorderColumn = useReorderColumnDispatch();

  return useCallback((movedId: string, orderedIds: string[]) => {
    const index = orderedIds.indexOf(movedId);

    if (index >= 0) reorderColumn(movedId, orderedIds[index - 1]);
  }, [reorderColumn]);
}
