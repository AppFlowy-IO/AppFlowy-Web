import { View } from '@/application/types';
import ViewList from '@/components/app/search/ViewList';
import React from 'react';
import { useTranslation } from 'react-i18next';

function RecentViews ({
  onClose,
  loading,
  recentViews,
}: {
  onClose: () => void;
  loading: boolean;
  recentViews?: View[];
}) {

  const { t } = useTranslation();

  return (
    <ViewList
      loading={loading}
      views={recentViews}
      title={t('recentPages')}
      onClose={onClose}
    />
  );
}

export default RecentViews;