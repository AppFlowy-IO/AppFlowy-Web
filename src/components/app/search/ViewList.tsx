import { View } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers } from '@/components/app/app.hooks';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

function ViewList ({
  title,
  views,
  onClose,
}: {
  title: string;
  views?: View[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedView, setSelectedView] = React.useState<string>('');
  const { toView: navigateToView } = useAppHandlers();
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!views) return;
      if (createHotkey(HOT_KEY_NAME.ENTER)(e) && selectedView) {
        e.preventDefault();
        e.stopPropagation();
        void navigateToView(selectedView);
        onClose();
      } else if (createHotkey(HOT_KEY_NAME.DOWN)(e) || createHotkey(HOT_KEY_NAME.UP)(e) || createHotkey(HOT_KEY_NAME.TAB)(e)) {
        e.preventDefault();
        const currentIndex = views.findIndex(view => view.view_id === selectedView);
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
    <div
      ref={ref}
      className={'flex flex-col'}
    >
      <div className={'px-4 py-2'}>
        {title}
      </div>
      <div className={'flex min-h-[280px] flex-col  max-h-[360px] appflowy-scroller overflow-y-auto'}>
        {views?.length ? views.map(view => (
          <div
            data-item-id={view.view_id}
            style={{
              backgroundColor: selectedView === view.view_id ? 'var(--fill-list-active)' : undefined,
            }}
            onClick={() => {
              void navigateToView(view.view_id);
              onClose();
            }}
            key={view.view_id}
            className={'flex items-center border-t border-line-default w-full p-4 cursor-pointer hover:bg-fill-list-active gap-2'}
          >
            <PageIcon
              view={view}
              className={'w-5 h-5'}
            />
            <div className={'text-sm font-normal flex-1 truncate'}>
              {view.name.trim() || t('menuAppHeader.defaultNewPageName')}
            </div>
          </div>
        )) : <div className={'text-center p-6 text-sm text-text-caption'}>
          {t('findAndReplace.noResult')}
        </div>}
      </div>
      <div className={'w-full p-4 flex text-text-caption text-xs gap-2 items-center'}>
        <span className={'rounded bg-fill-list-hover p-1'}>TAB</span>
        to navigate
      </div>
    </div>
  );
}

export default ViewList;