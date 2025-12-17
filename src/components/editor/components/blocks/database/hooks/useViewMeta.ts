import { useCallback, useEffect, useState } from 'react';

import { Log } from '@/utils/log';
import { View } from '@/application/types';

interface UseViewMetaProps {
  viewId: string;
  loadViewMeta?: (viewId: string, callback?: (meta: View | null) => void) => Promise<View | null>;
  /**
   * If true, meta loading errors won't set notFound state.
   * Used for embedded databases where block data is sufficient.
   */
  ignoreMetaErrors?: boolean;
  onNotFound?: () => void;
}

interface UseViewMetaResult {
  databaseName: string;
  loadViewMeta: (id: string, callback?: (meta: View | null) => void) => Promise<View | null>;
}

/**
 * Hook for loading view metadata.
 *
 * Handles:
 * - Loading view meta with retry logic
 * - Extracting database name from meta
 * - Error handling based on database type
 */
export function useViewMeta({
  viewId,
  loadViewMeta: loadViewMetaFn,
  ignoreMetaErrors = false,
  onNotFound,
}: UseViewMetaProps): UseViewMetaResult {
  const [databaseName, setDatabaseName] = useState<string>('');

  const loadWithRetry = useCallback(
    async (
      id: string,
      callback?: (meta: View | null) => void,
      retries = 3
    ): Promise<View | null> => {
      if (!loadViewMetaFn) return null;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const result = await loadViewMetaFn(id, callback);

          if (result) return result;
        } catch (error) {
          if (attempt === retries) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }

      return null;
    },
    [loadViewMetaFn]
  );

  const loadViewMeta = useCallback(
    async (id: string, callback?: (meta: View | null) => void): Promise<View | null> => {
      try {
        const meta = await loadWithRetry(id, callback);

        if (meta) {
          if (id === viewId) {
            setDatabaseName(meta.name ?? '');
          }

          return meta;
        }

        // For embedded databases, return null instead of rejecting
        if (ignoreMetaErrors) {
          return null;
        }

        return Promise.reject(new Error('View not found'));
      } catch (error) {
        Log.debug('[useViewMeta] Meta load failed', { id, error, ignoreMetaErrors });

        if (ignoreMetaErrors) {
          return null;
        }

        onNotFound?.();
        throw error;
      }
    },
    [loadWithRetry, viewId, ignoreMetaErrors, onNotFound]
  );

  // Initial load
  useEffect(() => {
    if (!viewId) return;

    void loadViewMeta(viewId).catch((error) => {
      console.error('[useViewMeta] Initial load failed', { viewId, error });
    });
  }, [viewId, loadViewMeta]);

  return { databaseName, loadViewMeta };
}
