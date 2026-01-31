import { useCallback } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { useService } from '@/components/main/app.hooks';

/**
 * Hook to create an orphaned view (row document) on the server.
 * This registers the document with the server so WebSocket sync can work.
 *
 * Called "orphaned" because the document isn't in the folder hierarchy -
 * it's a row document inside a database.
 *
 * @returns A function that creates the orphaned view and returns the doc_state
 *          (Y.js document state) as Uint8Array to initialize the local document.
 */
export function useCreateOrphanedView() {
  const service = useService();
  const { workspaceId } = useDatabaseContext();

  return useCallback(
    async (payload: { document_id: string }): Promise<Uint8Array> => {
      if (!workspaceId || !service) {
        throw new Error('No workspace or service found');
      }

      return service.createOrphanedView(workspaceId, payload);
    },
    [workspaceId, service]
  );
}
