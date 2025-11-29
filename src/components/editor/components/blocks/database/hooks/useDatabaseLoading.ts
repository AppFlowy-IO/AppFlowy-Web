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
  const [iidName, setIidName] = useState<string>('');

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
    if (!meta) {
      return;
    }

    // Use allowedViewIds directly if provided (embedded database block)
    // This comes from view_ids in block data, with backward compatibility for view_id
    if (allowedViewIdsRef.current && allowedViewIdsRef.current.length > 0) {
      setIidName(meta.name);
      setVisibleViewIds(allowedViewIdsRef.current);

      return;
    }

    // Fallback: load all child views (standalone database view, not embedded)
    const viewIds = meta.children.map((v) => v.view_id) || [];

    viewIds.unshift(meta.view_id);

    setIidName(meta.name);
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
      setNotFound(true);
    });
  }, [loadViewMetaWithCallback, viewId]);

  return {
    notFound,
    doc,
    selectedViewId,
    visibleViewIds,
    iidName,
    onChangeView,
    loadViewMeta: loadViewMetaWithCallback,
  };
};
