import { Popover } from '@/components/_shared/popover';
import { useAppRecent } from '@/components/app/app.hooks';
import BestMatch from '@/components/app/search/BestMatch';
import RecentViews from '@/components/app/search/RecentViews';
import TitleMatch from '@/components/app/search/TitleMatch';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Button, Dialog, Divider, InputBase, Tooltip } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { ReactComponent as SearchIcon } from '@/assets/search.svg';
import { ReactComponent as CheckIcon } from '@/assets/check.svg';
import { ReactComponent as DownIcon } from '@/assets/chevron_down.svg';

import { useTranslation } from 'react-i18next';
import { ReactComponent as CloseIcon } from '@/assets/close.svg';

enum SEARCH_TYPE {
  AI_SUGGESTION = 'AI_SUGGESTION',
  TITLE_MATCH = 'TITLE_MATCH',
}

export function Search () {
  const [open, setOpen] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = React.useState<string>('');
  const [searchType, setSearchType] = React.useState<SEARCH_TYPE>(SEARCH_TYPE.AI_SUGGESTION);
  const [searchTypeAnchorEl, setSearchTypeAnchorEl] = React.useState<null | HTMLElement>(null);
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

  const {
    recentViews,
    loadRecentViews,
  } = useAppRecent();
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
      <Button
        onClick={(e) => {
          e.currentTarget.blur();
          setOpen(true);
        }}
        startIcon={<SearchIcon className={'w-5 opacity-60 h-5 mr-[1px]'} />}
        size={'small'}
        className={'text-sm font-normal py-1.5 justify-start w-full hover:bg-fill-list-hover'}
        color={'inherit'}
      >
        {t('button.search')}
      </Button>
      <Dialog
        disableRestoreFocus={true}
        open={open}
        onClose={handleClose}
        classes={{
          container: 'items-start max-md:mt-auto max-md:items-center mt-[10%]',
          paper: 'overflow-hidden min-w-[600px]  max-w-[70vw]',
        }}
      >
        <div className={'flex gap-2 border-b border-line-default w-full p-4'}>
          <div className={'w-full flex gap-4 items-center'}>
            <SearchIcon className={'w-5 opacity-60 h-5 mr-[1px]'} />

            <InputBase
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              autoFocus={true}
              className={'flex-1'}
              fullWidth={true}
              placeholder={searchType === SEARCH_TYPE.AI_SUGGESTION ? t('AISearchPlaceholder') : t('searchLabel')}
            />
            <span
              style={{
                visibility: searchValue ? 'visible' : 'hidden',
              }}
              className={'p-0.5 rounded-full opacity-60 hover:opacity-100 bg-fill-list-hover cursor-pointer'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                setSearchValue('');
              }}
            ><CloseIcon className={'w-3 h-3'} /></span>
            <Tooltip title={'we currently only support searching for pages and content in documents'}>
              <span className={'cursor-default flex items-center p-1 px-2 text-xs rounded bg-fill-list-hover'}>BETA</span>
            </Tooltip>
          </div>
        </div>
        <div className={'p-4 w-full flex items-center gap-2'}>
          <div
            onClick={(e) => {
              setSearchTypeAnchorEl(e.currentTarget);
            }}
            className={'rounded-[8px] p-2 gap-2 border text-sm overflow-hidden cursor-pointer hover:border-text-title border-line-divider flex items-center'}
          >
            <span className={' max-w-[100px] truncate'}>{searchType === SEARCH_TYPE.TITLE_MATCH ? t('titleOnly') : t('AIsearch')}</span>
            <DownIcon className={'w-4 h-4'} />
          </div>
        </div>
        <Divider className={'border-line-default'} />
        {!searchValue ? <RecentViews
          loading={loadingRecentViews}
          recentViews={recentViews}
          onClose={handleClose}
        /> : searchType === SEARCH_TYPE.AI_SUGGESTION ? <BestMatch
          searchValue={searchValue}
          onClose={handleClose}
        /> : <TitleMatch
          searchValue={searchValue}
          onClose={handleClose}
        />}

      </Dialog>
      <Popover
        open={Boolean(searchTypeAnchorEl)}
        anchorEl={searchTypeAnchorEl}
        onClose={() => setSearchTypeAnchorEl(null)}
        slotProps={{
          paper: {
            className: 'p-2 w-fit my-2',
          },
        }}
      >
        {[SEARCH_TYPE.AI_SUGGESTION, SEARCH_TYPE.TITLE_MATCH].map(type => (
          <div
            key={type}
            className={'p-2 text-sm rounded-[8px] flex items-center gap-2 cursor-pointer hover:bg-fill-list-hover'}
            onClick={() => {
              setSearchType(type);
              setSearchTypeAnchorEl(null);
            }}
          >
            {type === SEARCH_TYPE.TITLE_MATCH ? t('titleOnly') : t('AIsearch')}
            {type === searchType && <CheckIcon className={'w-5 text-function-info h-5'} />}
          </div>
        ))}
      </Popover>
    </>
  );
}

export default Search;