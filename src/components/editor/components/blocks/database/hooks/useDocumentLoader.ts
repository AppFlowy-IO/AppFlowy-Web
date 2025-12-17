import { useCallback, useEffect, useState } from 'react';

import { Log } from '@/utils/log';
import { YDoc } from '@/application/types';

interface UseDocumentLoaderProps {
  viewId: string;
  loadView?: (viewId: string) => Promise<YDoc | null>;
}

interface UseDocumentLoaderResult {
  doc: YDoc | null;
  notFound: boolean;
  setNotFound: (notFound: boolean) => void;
}

/**
 * Hook for loading a database document.
 *
 * Handles:
 * - Loading the YDoc for the given viewId
 * - Retry logic on failure
 * - NotFound state management
 */
export function useDocumentLoader({
  viewId,
  loadView,
}: UseDocumentLoaderProps): UseDocumentLoaderResult {
  const [doc, setDoc] = useState<YDoc | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadWithRetry = useCallback(
    async (id: string, retries = 3): Promise<YDoc | null> => {
      if (!loadView) return null;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const result = await loadView(id);

          if (result) return result;
        } catch (error) {
          if (attempt === retries) {
            throw error;
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }

      return null;
    },
    [loadView]
  );

  useEffect(() => {
    if (!viewId) return;

    const loadDocument = async () => {
      try {
        const loadedDoc = await loadWithRetry(viewId);

        Log.debug('[useDocumentLoader] loaded doc', { viewId });
        setDoc(loadedDoc);
        setNotFound(false);
      } catch (error) {
        console.error('[useDocumentLoader] failed to load doc', { viewId, error });
        setNotFound(true);
      }
    };

    void loadDocument();
  }, [viewId, loadWithRetry]);

  return { doc, notFound, setNotFound };
}
