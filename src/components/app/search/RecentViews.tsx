import { useAppRecent } from '@/components/app/app.hooks';
import ViewList from '@/components/app/search/ViewList';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

function RecentViews ({
  onClose
}: {
  onClose: () => void;
}) {
  const {
    recentViews,
    loadRecentViews
  } = useAppRecent();
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadRecentViews?.();
      setLoading(false);
    })();
  }, [loadRecentViews]);
  

  return (
    <ViewList views={recentViews} title={t('commandPalette.recentHistory')} onClose={onClose} loading={loading} />
  );
}

export default RecentViews;