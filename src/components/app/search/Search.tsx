import { Dialog, InputBase } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { useAppRecent } from '@/components/app/app.hooks';
import BestMatch from '@/components/app/search/BestMatch';
import RecentViews from '@/components/app/search/RecentViews';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createHotkey, createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

export function Search() {
  const [open, setOpen] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = React.useState<string>('');
  const handleClose = () => {
    setOpen(false);
    setSearchValue('');
  };

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    switch (true) {
      case createHotkey(HOT_KEY_NAME.SEARCH)(e):
        e.preventDefault();
        setOpen(true);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onKeyDown]);

  const { recentViews, loadRecentViews } = useAppRecent();
  const [loadingRecentViews, setLoadingRecentViews] = React.useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoadingRecentViews(true);
      await loadRecentViews?.();
      setLoadingRecentViews(false);
    })();
  }, [loadRecentViews, open]);

  return (
    <>
      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <div
            onClick={(e) => {
              e.currentTarget.blur();
              setOpen(true);
            }}
            className={dropdownMenuItemVariants()}
          >
            <SearchIcon />
            {t('button.search')}
          </div>
        </TooltipTrigger>
        <TooltipContent side='right'>
          <div className={'flex flex-col gap-1'}>
            <span>{t('search.sidebarSearchIcon')}</span>
            <div className={'text-text-secondary'}>{createHotKeyLabel(HOT_KEY_NAME.SEARCH)}</div>
          </div>
        </TooltipContent>
      </Tooltip>

      <Dialog
        disableRestoreFocus={true}
        open={open}
        onClose={handleClose}
        classes={{
          container: 'items-start max-md:mt-auto max-md:items-center mt-[10%]',
          paper: 'overflow-hidden min-w-[600px] w-[600px] max-w-[70vw]',
        }}
      >
        <div className={'flex w-full gap-2 border-b border-line-default p-4'}>
          <div className={'flex w-full items-center gap-4'}>
            <SearchIcon className={'mr-[1px] h-5 w-5 opacity-60'} />

            <InputBase
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              autoFocus={true}
              className={'flex-1'}
              fullWidth={true}
              placeholder={t('searchLabel')}
            />
            <span
              style={{
                visibility: searchValue ? 'visible' : 'hidden',
              }}
              className={'cursor-pointer rounded-full bg-fill-content-hover p-0.5 opacity-60 hover:opacity-100'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                setSearchValue('');
              }}
            >
              <CloseIcon className={'h-3 w-3'} />
            </span>
          </div>
        </div>
        {!searchValue ? (
          <RecentViews loading={loadingRecentViews} recentViews={recentViews} onClose={handleClose} />
        ) : (
          <BestMatch searchValue={searchValue} onClose={handleClose} />
        )}
      </Dialog>
    </>
  );
}

export default Search;
