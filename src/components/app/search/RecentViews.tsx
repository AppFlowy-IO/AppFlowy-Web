import { useAppRecent } from '@/components/app/app.hooks';
import ViewList from '@/components/app/search/ViewList';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

function RecentViews ({
  onClose,
  setLoading,
}: {
  onClose: () => void;
  setLoading: (loading: boolean) => void;
}) {
  const {
    recentViews,
    loadRecentViews,
  } = useAppRecent();
  const { t } = useTranslation();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadRecentViews?.();
      setLoading(false);
    })();
  }, [loadRecentViews, setLoading]);

  return (
    <ViewList
      views={recentViews}
      title={t('commandPalette.recentHistory')}
      onClose={onClose}
    />
  );
}

export default RecentViews;