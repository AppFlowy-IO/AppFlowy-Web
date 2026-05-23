import CircularProgress from '@mui/material/CircularProgress';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { useToView } from '@/components/app/app.hooks';
import ListItem from '@/components/app/search/ListItem';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export interface SearchViewListItem {
  id: string;
  view: View;
  rowId?: string | null;
  title?: string;
  subtitle?: string;
  preview?: string;
}

function ViewList({
  title,
  items,
  views,
  onClose,
  loading,
  loadingMore,
  hasMore,
  header,
  query,
  onLoadMore,
}: {
  title: string;
  items?: SearchViewListItem[];
  views?: View[];
  onClose: () => void;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  header?: React.ReactNode;
  query?: string;
  onLoadMore?: () => void;
}) {
  const { t } = useTranslation();
  const [selectedItemId, setSelectedItemId] = React.useState<string>('');
  const navigateToView = useToView();
  const ref = React.useRef<HTMLDivElement>(null);
  const listItems = React.useMemo<SearchViewListItem[] | undefined>(() => {
    if (items) return items;

    return views?.map((view) => ({
      id: view.view_id,
      view,
    }));
  }, [items, views]);

  useEffect(() => {
    setSelectedItemId('');
  }, [listItems]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listItems?.length) return;
      if (createHotkey(HOT_KEY_NAME.ENTER)(e) && selectedItemId) {
        e.preventDefault();
        e.stopPropagation();
        const selectedItem = listItems.find((item) => item.id === selectedItemId);

        if (selectedItem) {
          void navigateToView(selectedItem.view.view_id, selectedItem.rowId || undefined);
        }

        onClose();
      } else if (
        createHotkey(HOT_KEY_NAME.DOWN)(e) ||
        createHotkey(HOT_KEY_NAME.UP)(e) ||
        createHotkey(HOT_KEY_NAME.TAB)(e)
      ) {
        e.preventDefault();
        const currentIndex = listItems.findIndex((item) => item.id === selectedItemId);
        let nextItemId = '';

        if (currentIndex === -1) {
          nextItemId = listItems[0].id;
        } else {
          if (createHotkey(HOT_KEY_NAME.DOWN)(e) || createHotkey(HOT_KEY_NAME.TAB)(e)) {
            nextItemId = listItems[(currentIndex + 1) % listItems.length].id;
          } else {
            nextItemId = listItems[(currentIndex - 1 + listItems.length) % listItems.length].id;
          }
        }

        setSelectedItemId(nextItemId);
        const el = ref.current?.querySelector(`[data-item-id="${nextItemId}"]`);

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
  }, [navigateToView, onClose, listItems, selectedItemId]);

  return (
    <div ref={ref} className={'flex flex-col'}>
      {header}
      <div className={'flex items-center gap-4 px-4 pb-2 pt-5'}>
        {!loading && listItems && listItems.length === 0 ? (
          t('noSearchResults')
        ) : (
          <>
            {title}
            {loading && <CircularProgress size={14} />}
          </>
        )}
      </div>
      <div className={'appflowy-scroller flex max-h-[360px]  min-h-[280px] flex-col overflow-y-auto'}>
        {listItems?.map((item) => (
          <ListItem
            key={item.id}
            itemId={item.id}
            selected={selectedItemId === item.id}
            subtitle={item.subtitle}
            title={item.title}
            preview={item.preview}
            query={query}
            view={item.view}
            onClick={() => {
              setSelectedItemId(item.id);
              void navigateToView(item.view.view_id, item.rowId || undefined);
              onClose();
            }}
            onClose={onClose}
          />
        ))}
        {hasMore && (
          <button
            type={'button'}
            className={
              'mx-4 my-2 flex min-h-[40px] items-center justify-center gap-2 rounded px-3 text-sm font-medium text-text-title hover:bg-fill-list-hover disabled:cursor-default disabled:text-text-caption disabled:hover:bg-transparent'
            }
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore && <CircularProgress size={14} />}
            {loadingMore
              ? t('loading', {
                  defaultValue: 'Loading...',
                })
              : t('button.loadMore', {
                  defaultValue: 'Load more',
                })}
          </button>
        )}
      </div>
      <div className={'flex w-full items-center gap-2 p-4 text-xs text-text-secondary'}>
        <span className={'rounded bg-fill-content-hover p-1'}>TAB</span>
        to navigate
      </div>
    </div>
  );
}

export default ViewList;
