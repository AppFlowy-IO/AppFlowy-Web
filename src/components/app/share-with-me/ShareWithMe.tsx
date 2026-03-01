import { Collapse } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as DownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as FillUsersIcon } from '@/assets/icons/fill_users.svg';
import { findShareWithMeSpace } from '@/components/_shared/outline/utils';
import { useAppHandlers, useAppOutline } from '@/components/app/app.hooks';
import { ShareViewItem } from '@/components/app/share-with-me/ShareViewItem';

const LOCAL_STORAGE_KEY = 'share_with_me_expanded';

export function ShareWithMe({ width }: { width: number }) {
  const { t } = useTranslation();
  const { toView: navigateToView, refreshOutline } = useAppHandlers();
  const outline = useAppOutline();

  const [isExpanded, setIsExpanded] = useState(() => {
    return localStorage.getItem(LOCAL_STORAGE_KEY) !== 'false';
  });
  const [expandIds, setExpandIds] = useState<string[]>([]);

  const toggleExpand = (id: string, isExpand: boolean) => {
    setExpandIds((prev) => {
      if (isExpand) {
        return [...prev, id];
      }

      return prev.filter((expandId) => expandId !== id);
    });
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    localStorage.setItem(LOCAL_STORAGE_KEY, String(!isExpanded));
  };

  const handleDataRefresh = useCallback(async () => {
    await refreshOutline?.();
  }, [refreshOutline]);

  // Get shareWithMe data from outline
  const shareWithMe = useMemo(() => {
    if (!Array.isArray(outline)) {
      return null;
    }

    return findShareWithMeSpace(outline);
  }, [outline]);

  if (!shareWithMe?.children || shareWithMe?.children?.length === 0) return null;

  return (
    <div className={'relative mb-3 flex w-full flex-col'}>
      <div onClick={handleToggleExpand} className={'my-0.5 flex h-fit w-full cursor-pointer flex-col gap-2'}>
        <div
          className={
            'flex w-full items-center justify-start gap-1 overflow-hidden rounded-[8px] p-1 text-sm font-medium text-text-primary hover:bg-fill-content-hover focus:outline-none'
          }
        >
          <FillUsersIcon className={'h-6 min-w-6'} />
          <div className={'truncate'}>{t('sideBar.shareWithMe')}</div>
          <DownIcon className={`h-5 min-w-3 font-medium ${!isExpanded ? '-rotate-90' : ''}`} />
        </div>
      </div>
      <Collapse in={isExpanded} className={'flex transform flex-col gap-2 px-0 transition-all'}>
        {shareWithMe.children.map((view) => (
          <ShareViewItem
            key={view.view_id}
            view={view}
            width={width}
            expandIds={expandIds}
            toggleExpand={toggleExpand}
            navigateToView={navigateToView}
            onDataRefresh={handleDataRefresh}
          />
        ))}
      </Collapse>
    </div>
  );
}
