import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Log } from '@/utils/log';
import { View, YDoc } from '@/application/types';

import { createLoadingStrategy, isEmbeddedDatabase, DatabaseLoadingConfig } from './loadingStrategies';
import { useRetryFunction } from './useRetryFunction';

interface UseDatabaseLoadingProps {
  viewId: string;
  allowedViewIds?: string[];
  loadView?: (viewId: string) => Promise<YDoc | null>;
  loadViewMeta?: (viewId: string, callback?: (meta: View | null) => void) => Promise<View | null>;
}

export const useDatabaseLoading = ({ viewId, allowedViewIds, loadView, loadViewMeta }: UseDatabaseLoadingProps) => {
  const [notFound, setNotFound] = useState(false);
  const [doc, setDoc] = useState<YDoc | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string>(viewId);
  const [visibleViewIds, setVisibleViewIds] = useState<string[]>([]);
  const [databaseName, setDatabaseName] = useState<string>('');

  const viewIdsRef = useRef<string[]>([viewId]);
  const allowedViewIdsRef = useRef<string[] | undefined>(allowedViewIds);
  const initialSelectionDoneRef = useRef(false);

  // Create loading strategy based on configuration
  const config: DatabaseLoadingConfig = useMemo(
    () => ({
      viewId,
      allowedViewIds,
      loadView,
      loadViewMeta,
    }),
    [viewId, allowedViewIds, loadView, loadViewMeta]
  );

  const strategy = useMemo(() => createLoadingStrategy(config), [config]);
  const isEmbedded = isEmbeddedDatabase(allowedViewIds);

  // Keep the ref updated
  useEffect(() => {
    allowedViewIdsRef.current = allowedViewIds;
  }, [allowedViewIds]);

  // When allowedViewIds change without the primary view changing, keep visible tabs in sync
  useEffect(() => {
    if (!allowedViewIds || allowedViewIds.length === 0) {
      return;
    }

    setVisibleViewIds(allowedViewIds);
    setSelectedViewId((current) => (allowedViewIds.includes(current) ? current : allowedViewIds[0] ?? current));
  }, [allowedViewIds]);

  const handleError = useCallback(() => {
    // Use strategy to determine if notFound should be set
    if (!strategy.shouldSetNotFoundOnMetaError()) {
      Log.debug('[useDatabaseLoading] Ignoring meta load error (strategy)');
      return;
    }

    setNotFound(true);
  }, [strategy]);

  const retryLoadView = useRetryFunction(loadView, handleError);
  const retryLoadViewMeta = useRetryFunction(loadViewMeta, handleError);

  const updateVisibleViewIds = useCallback(
    async (meta: View | null) => {
      const viewIds = strategy.getVisibleViewIds(meta);
      const name = strategy.getDatabaseName(meta);

      setDatabaseName(name);
      setVisibleViewIds(viewIds);
    },
    [strategy]
  );

  const loadViewMetaWithCallback = useCallback(
    async (id: string, callback?: (meta: View | null) => void) => {
      // Use strategy to determine if we should skip loading
      if (strategy.shouldSkipMetaLoad(id)) {
        Log.debug('[useDatabaseLoading] Skipping meta load (strategy)', { id, viewId });
        return null;
      }

      if (id === viewId) {
        try {
          const meta = await retryLoadViewMeta(viewId, updateVisibleViewIds);

          if (meta) {
            await updateVisibleViewIds(meta);
            setNotFound(false);
            return meta;
          }
        } catch (error) {
          // For embedded databases, return null instead of rejecting
          if (isEmbedded) {
            Log.debug('[useDatabaseLoading] Meta load failed for embedded base view, continuing', {
              viewId,
              error,
            });
            return null;
          }

          throw error;
        }

        // For embedded databases, return null instead of rejecting
        if (isEmbedded) {
          return null;
        }

        return Promise.reject(new Error('View not found'));
      } else {
        const meta = await retryLoadViewMeta(id, callback);

        if (meta) {
          setNotFound(false);
          return meta;
        }

        return Promise.reject(new Error('View not found'));
      }
    },
    [isEmbedded, retryLoadViewMeta, strategy, updateVisibleViewIds, viewId]
  );

  const onChangeView = useCallback((viewId: string) => {
    setSelectedViewId(viewId);
  }, []);

  /**
   * Called when a new view is added to the database.
   * Updates visibleViewIds immediately to ensure the new tab renders
   * before the selection change takes effect.
   */
  const onViewAdded = useCallback((newViewId: string) => {
    setVisibleViewIds((current) => {
      if (current.includes(newViewId)) {
        return current;
      }

      return [...current, newViewId];
    });
    setSelectedViewId(newViewId);
  }, []);

  // Load the view document
  useEffect(() => {
    if (!viewId) return;

    const loadViewData = async () => {
      try {
        const view = await retryLoadView(viewId);

        Log.debug('[DatabaseBlock] loaded view doc', { viewId });

        setDoc(view);
        setNotFound(false);
      } catch (error) {
        console.error('[DatabaseBlock] failed to load view doc', { viewId, error });
        setNotFound(true);
      }
    };

    void loadViewData();
  }, [viewId, retryLoadView]);

  useEffect(() => {
    viewIdsRef.current = visibleViewIds;
  }, [visibleViewIds]);

  // Initial load of view meta
  useLayoutEffect(() => {
    // For embedded databases with allowedViewIds, we can proceed even if meta loading fails
    // The view_ids from block data are sufficient
    if (isEmbedded && allowedViewIdsRef.current && !initialSelectionDoneRef.current) {
      // Set visible view IDs immediately from block data, don't wait for meta
      setVisibleViewIds(allowedViewIdsRef.current);
      setSelectedViewId(allowedViewIdsRef.current.includes(viewId) ? viewId : allowedViewIdsRef.current[0]);
    }

    void loadViewMetaWithCallback(viewId)
      .then((meta) => {
        // Only set selectedViewId on initial load, not on subsequent re-runs
        // This prevents overwriting user's view selection when allowedViewIds changes
        if (!initialSelectionDoneRef.current) {
          if (!viewIdsRef.current.includes(viewId) && viewIdsRef.current.length > 0) {
            setSelectedViewId(viewIdsRef.current[0]);
            Log.debug('[DatabaseBlock] selected first child view', { viewId, selected: viewIdsRef.current[0] });
          } else {
            setSelectedViewId(viewId);
            Log.debug('[DatabaseBlock] selected requested view', { viewId });
          }

          initialSelectionDoneRef.current = true;
        }

        if (meta) {
          Log.debug('[DatabaseBlock] loaded view meta', {
            viewId,
            children: meta.children?.map((c) => c.view_id),
            name: meta.name,
          });
        }

        setNotFound(false);
      })
      .catch((error) => {
        console.error('[DatabaseBlock] failed to load view meta', { viewId, error });

        // For embedded databases, don't set notFound if we have allowedViewIds
        // The doc loading is what matters, meta is optional
        if (!isEmbedded) {
          setNotFound(true);
        }
      });
  }, [loadViewMetaWithCallback, viewId, isEmbedded]);

  return {
    notFound,
    doc,
    selectedViewId,
    visibleViewIds,
    databaseName,
    onChangeView,
    onViewAdded,
    loadViewMeta: loadViewMetaWithCallback,
  };
};
