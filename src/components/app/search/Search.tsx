import { Popover } from '@/components/_shared/popover';
import BestMatch from '@/components/app/search/BestMatch';
import RecentViews from '@/components/app/search/RecentViews';
import TitleMatch from '@/components/app/search/TitleMatch';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Button, CircularProgress, Dialog, InputBase, Tooltip } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { ReactComponent as SearchIcon } from '@/assets/search.svg';
import { ReactComponent as CheckIcon } from '@/assets/check.svg';
// import { ReactComponent as DownIcon } from '@/assets/chevron_down.svg';

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
  const [loading, setLoading] = React.useState<boolean>(false);
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
        classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%]' }}
      >
        <div className={'flex gap-2 border-b border-line-default w-full p-4'}>
          <div className={'w-full flex gap-4 items-center min-w-[500px] max-w-[70vw]'}>
            {loading ? <CircularProgress size={14} /> : <SearchIcon className={'w-5 opacity-60 h-5 mr-[1px]'} />}

            <InputBase
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              autoFocus={true}
              className={'flex-1'}
              fullWidth={true}
              placeholder={t('commandPalette.placeholder')}
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
              <span className={'cursor-pointer flex items-center p-1 px-2 text-xs rounded bg-fill-list-hover'}>BETA</span>
            </Tooltip>
            {/*<Tooltip title={searchType === SEARCH_TYPE.TITLE_MATCH ? undefined : 'we currently only support searching for pages and content in documents'}>*/}
            {/*  <div*/}
            {/*    onClick={e => {*/}
            {/*      setSearchTypeAnchorEl(e.currentTarget);*/}
            {/*    }}*/}
            {/*    className={'cursor-pointer flex items-center p-1 px-2 text-xs rounded bg-fill-list-hover'}*/}
            {/*  >*/}
            {/*    {*/}
            {/*      searchType === SEARCH_TYPE.TITLE_MATCH ?*/}
            {/*        t('titleMatch') :*/}
            {/*        t('aiMatch')*/}
            {/*    }*/}
            {/*    <DownIcon className={'w-3 h-3 ml-1 opacity-60'} />*/}
            {/*  </div>*/}
            {/*</Tooltip>*/}
          </div>
        </div>
        {!searchValue ? <RecentViews
          setLoading={setLoading}
          onClose={handleClose}
        /> : searchType === SEARCH_TYPE.AI_SUGGESTION ? <BestMatch
          searchValue={searchValue}
          setLoading={setLoading}
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
        {[SEARCH_TYPE.TITLE_MATCH, SEARCH_TYPE.AI_SUGGESTION].map(type => (
          <div
            key={type}
            className={'px-2 py-1.5 text-xs rounded-[8px] flex items-center gap-2 cursor-pointer hover:bg-fill-list-hover'}
            onClick={() => {
              setSearchType(type);
              setSearchTypeAnchorEl(null);
            }}
          >
            {type === SEARCH_TYPE.TITLE_MATCH ? t('titleMatch') : t('aiMatch')}
            {type === searchType && <CheckIcon className={'w-4 text-function-info h-4 ml-2'} />}
          </div>
        ))}
      </Popover>
    </>
  );
}

export default Search;