import CircularProgress from '@mui/material/CircularProgress';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { useToView } from '@/components/app/app.hooks';
import ListItem from '@/components/app/search/ListItem';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

function ViewList({
  title,
  views,
  onClose,
  loading,
}: {
  title: string;
  views?: View[];
  onClose: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [selectedView, setSelectedView] = React.useState<string>('');
  const navigateToView = useToView();
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!views) return;
      if (createHotkey(HOT_KEY_NAME.ENTER)(e) && selectedView) {
        e.preventDefault();
        e.stopPropagation();
        void navigateToView(selectedView);
        onClose();
      } else if (
        createHotkey(HOT_KEY_NAME.DOWN)(e) ||
        createHotkey(HOT_KEY_NAME.UP)(e) ||
        createHotkey(HOT_KEY_NAME.TAB)(e)
      ) {
        e.preventDefault();
        const currentIndex = views.findIndex((view) => view.view_id === selectedView);
        let nextViewId = '';

        if (currentIndex === -1) {
          nextViewId = views[0].view_id;
        } else {
          if (createHotkey(HOT_KEY_NAME.DOWN)(e) || createHotkey(HOT_KEY_NAME.TAB)(e)) {
            nextViewId = views[(currentIndex + 1) % views.length].view_id;
          } else {
            nextViewId = views[(currentIndex - 1 + views.length) % views.length].view_id;
          }
        }

        setSelectedView(nextViewId);
        const el = ref.current?.querySelector(`[data-item-id="${nextViewId}"]`);

        if (el) {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest',
          });
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigateToView, onClose, views, selectedView]);

  return (
    <div ref={ref} className={'flex flex-col'}>
      <div className={'flex items-center gap-4 px-4 pb-2 pt-5'}>
        {!loading && views && views.length === 0 ? (
          t('noSearchResults')
        ) : (
          <>
            {title}
            {loading && <CircularProgress size={14} />}
          </>
        )}
      </div>
      <div className={'appflowy-scroller flex max-h-[360px]  min-h-[280px] flex-col overflow-y-auto'}>
        {views?.map((view) => (
          <ListItem
            key={view.view_id}
            selectedView={selectedView}
            view={view}
            onClick={() => {
              setSelectedView(view.view_id);
              void navigateToView(view.view_id);
              onClose();
            }}
            onClose={onClose}
          />
        ))}
      </div>
      <div className={'flex w-full items-center gap-2 p-4 text-xs text-text-secondary'}>
        <span className={'rounded bg-fill-content-hover p-1'}>TAB</span>
        to navigate
      </div>
    </div>
  );
}

export default ViewList;
