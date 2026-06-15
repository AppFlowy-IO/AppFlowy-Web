import orderBy from 'lodash-es/orderBy';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MobileOutlineWithCover from '@/components/_shared/mobile-outline/MobileOutlineWithCover';
import { useAppFavorites, useToView } from '@/components/app/app.hooks';

function MobileFavorite ({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    favoriteViews,
    loadFavoriteViews,
  } = useAppFavorites();

  useEffect(() => {
    void loadFavoriteViews?.();
  }, [loadFavoriteViews]);

  const navigateToView = useToView();
  const { t } = useTranslation();
  const sortedViews = useMemo(() => {
    return orderBy(favoriteViews, ['favorited_at'], ['desc']);
  }, [favoriteViews]);

  return (
    <div className={'flex flex-col gap-5 py-2'}>
      {sortedViews?.map((view) => (
        <MobileOutlineWithCover
          timePrefix={t('sideBar.favoriteAt') + ' '}
          key={view.view_id}
          time={view.favorited_at}
          view={view}
          navigateToView={async (viewId: string) => {
            await navigateToView(viewId);
            onClose();
          }}
        />
      ))}
    </div>
  );
}

export default MobileFavorite;