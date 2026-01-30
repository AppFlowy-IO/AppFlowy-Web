import { useCallback } from 'react';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useService } from '@/components/main/app.hooks';

/**
 * Hook to check if a row document exists on the server.
 * Used to determine if we need to create an orphaned view before syncing.
 */
export function useCheckIfRowDocumentExists() {
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();

  return useCallback(
    async (documentId: string): Promise<boolean> => {
      if (!service || !workspaceId) {
        return false;
      }

      return service.checkIfCollabExists(workspaceId, documentId);
    },
    [service, workspaceId]
  );
}
