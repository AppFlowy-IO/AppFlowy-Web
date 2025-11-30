import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { View, YDoc } from '@/application/types';

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
    setNotFound(true);
  }, []);

  const retryLoadView = useRetryFunction(loadView, handleError);
  const retryLoadViewMeta = useRetryFunction(loadViewMeta, handleError);

  const updateVisibleViewIds = useCallback(async (meta: View | null) => {
    // Use allowedViewIds directly if provided (embedded database block)
    // This comes from view_ids in block data, with backward compatibility for view_id
    if (allowedViewIdsRef.current && allowedViewIdsRef.current.length > 0) {
      // Use meta.name if available, otherwise use empty string (embedded databases don't need name)
      setDatabaseName(meta?.name ?? '');
      setVisibleViewIds(allowedViewIdsRef.current);

      return;
    }

    // Fallback: load all child views (standalone database view, not embedded)
    // This requires meta to be available
    if (!meta) {
      return;
    }

    const viewIds = meta.children.map((v) => v.view_id) || [];

    viewIds.unshift(meta.view_id);

    setDatabaseName(meta.name);
    setVisibleViewIds(viewIds);
  }, []);

  const loadViewMetaWithCallback = useCallback(
    async (id: string, callback?: (meta: View | null) => void) => {
      if (id === viewId) {
        const meta = await retryLoadViewMeta(viewId, updateVisibleViewIds);

        if (meta) {
          await updateVisibleViewIds(meta);
          setNotFound(false);
          return meta;
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
    [retryLoadViewMeta, updateVisibleViewIds, viewId]
  );

  const onChangeView = useCallback((viewId: string) => {
    setSelectedViewId(viewId);
  }, []);

  useEffect(() => {
    if (!viewId) return;
    
    const loadViewData = async () => {
      try {
        const view = await retryLoadView(viewId);

        console.debug('[DatabaseBlock] loaded view doc', { viewId });

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

  useLayoutEffect(() => {
    // For embedded databases with allowedViewIds, we can proceed even if meta loading fails
    // The view_ids from block data are sufficient
    const hasAllowedViewIds = allowedViewIdsRef.current && allowedViewIdsRef.current.length > 0;

    if (hasAllowedViewIds) {
      // Set visible view IDs immediately from block data, don't wait for meta
      setVisibleViewIds(allowedViewIdsRef.current!);
      setSelectedViewId(allowedViewIdsRef.current!.includes(viewId) ? viewId : allowedViewIdsRef.current![0]);
    }

    void loadViewMetaWithCallback(viewId).then((meta) => {
      if (!viewIdsRef.current.includes(viewId) && viewIdsRef.current.length > 0) {
        setSelectedViewId(viewIdsRef.current[0]);
        console.debug('[DatabaseBlock] selected first child view', { viewId, selected: viewIdsRef.current[0] });
      } else {
        setSelectedViewId(viewId);
        console.debug('[DatabaseBlock] selected requested view', { viewId });
      }

      if (meta) {
        console.debug('[DatabaseBlock] loaded view meta', {
          viewId,
          children: meta.children?.map((c) => c.view_id),
          name: meta.name,
        });
      }

      setNotFound(false);
    }).catch((error) => {
      console.error('[DatabaseBlock] failed to load view meta', { viewId, error });

      // For embedded databases, don't set notFound if we have allowedViewIds
      // The doc loading is what matters, meta is optional
      if (!hasAllowedViewIds) {
        setNotFound(true);
      }
    });
  }, [loadViewMetaWithCallback, viewId]);

  return {
    notFound,
    doc,
    selectedViewId,
    visibleViewIds,
    databaseName,
    onChangeView,
    loadViewMeta: loadViewMetaWithCallback,
  };
};
