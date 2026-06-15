import { useEffect } from 'react';

import { useAppRecent } from '@/components/app/app.hooks';

export function useRecent () {
  const {
    recentViews,
    loadRecentViews,
  } = useAppRecent();

  useEffect(() => {
    void loadRecentViews?.();
  }, [loadRecentViews]);

  return {
    views: recentViews,
  };
}