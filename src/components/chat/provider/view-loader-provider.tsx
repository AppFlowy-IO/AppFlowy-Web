import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { filterDocumentViews } from '@/components/chat/lib/views';
import { View } from '@/components/chat/types/request';

interface ViewLoaderProviderProps {
  viewsLoading: boolean;
  fetchViews: (filter?: (v: View[]) => View[]) => Promise<View | undefined>;
  getView: (viewId: string, forceRefresh?: boolean) => Promise<View | undefined>;
}

export const ViewLoaderContext = createContext<ViewLoaderProviderProps | undefined>(undefined);

export function useViewLoader() {
  const context = useContext(ViewLoaderContext);

  if (!context) {
    throw new Error('useViewLoader: useViewLoader must be used within a ViewLoaderProvider');
  }

  return context;
}

export const ViewLoaderProvider = ({
  getView,
  fetchViews,
  children,
}: {
  getView: (viewId: string, forceRefresh?: boolean) => Promise<View>;
  fetchViews: (forceRefresh?: boolean) => Promise<View>;
  children: React.ReactNode;
}) => {
  const [viewsLoading, setViewsLoading] = useState(false);

  const fetchViewsImpl = useCallback(
    async (filter?: (v: View[]) => View[]) => {
      try {
        setViewsLoading(true);
        const view = await fetchViews(true);
        const result = {
          ...view,
          children: filter ? filter(view.children) : filterDocumentViews(view.children),
        };

        return result;
        // eslint-disable-next-line
      } catch (e: any) {
        // do not show toast for no views
      } finally {
        setViewsLoading(false);
      }
    },
    [fetchViews]
  );

  const getViewImpl = useCallback(
    async (viewId: string, forceRefresh = true) => {
      try {
        return await getView(viewId, forceRefresh);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [getView]
  );
  const contextValue = useMemo(
    () => ({ viewsLoading, getView: getViewImpl, fetchViews: fetchViewsImpl }),
    [viewsLoading, getViewImpl, fetchViewsImpl]
  );

  return (
    <ViewLoaderContext.Provider value={contextValue}>
      {children}
    </ViewLoaderContext.Provider>
  );
};
