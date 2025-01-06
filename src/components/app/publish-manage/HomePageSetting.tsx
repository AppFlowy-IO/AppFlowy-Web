import { SubscriptionPlan, View } from '@/application/types';
import { Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Button, CircularProgress, IconButton, OutlinedInput, Tooltip } from '@mui/material';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as SearchIcon } from '@/assets/search.svg';
import { ReactComponent as RemoveIcon } from '@/assets/close.svg';
import { ReactComponent as UpgradeIcon } from '@/assets/icon_upgrade.svg';

import { useSearchParams } from 'react-router-dom';

interface HomePageSettingProps {
  onRemoveHomePage: () => Promise<void>;
  onUpdateHomePage: (newPageId: string) => Promise<void>;
  homePage?: View;
  publishViews: View[];
  isOwner: boolean;
  activePlan: SubscriptionPlan | null;
}

function HomePageSetting ({
  activePlan,
  onRemoveHomePage,
  onUpdateHomePage,
  homePage,
  publishViews,
  isOwner,
}: HomePageSettingProps) {
  const [removeLoading, setRemoveLoading] = React.useState<boolean>(false);
  const [updateLoading, setUpdateLoading] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const [searchText, setSearchText] = React.useState<string>('');
  const views = useMemo(() => {
    if (!searchText) return publishViews;
    return publishViews.filter(view => view.name?.toLowerCase().includes(searchText.toLowerCase()));
  }, [publishViews, searchText]);

  const [, setSearch] = useSearchParams();
  const handleUpgrade = useCallback(async () => {
    if (!isOwner) return;
    setSearch(prev => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch, isOwner]);

  if (activePlan && activePlan !== SubscriptionPlan.Pro) {

    return <Tooltip title={!isOwner ? t('settings.sites.namespace.pleaseAskOwnerToSetHomePage') : undefined}>
      <Button
        variant={'contained'}
        color={'secondary'}
        size={'small'}
        onClick={handleUpgrade}
        endIcon={<UpgradeIcon />}
      >
        {t('subscribe.changePlan')}
      </Button>
    </Tooltip>;
  }

  return (
    <div className={'flex-1 flex items-center overflow-hidden'}>
      <Tooltip title={isOwner ? homePage?.name : t('settings.sites.error.onlyWorkspaceOwnerCanChangeHomepage')}>
        <Button
          onClick={e => {
            if (!isOwner) return;
            setAnchorEl(e.currentTarget);
          }}
          color={'inherit'}
          classes={{
            startIcon: 'mr-0',
          }}
          className={'max-w-[120px] gap-1 overflow-hidden'}
          startIcon={
            updateLoading ? <CircularProgress size={14} /> :
              homePage ? <PageIcon
                iconSize={18}
                className={'text-sm'}
                view={homePage}
              /> : <SearchIcon className={'w-4 h-4 opacity-60'} />
          }
          size={'small'}
        >
          {homePage ?
            <span className={'truncate text-left'}>{homePage.name || t('menuAppHeader.defaultNewPageName')}</span> : t('settings.sites.selectHomePage')}
        </Button>
      </Tooltip>
      {homePage &&
        <Tooltip title={isOwner ? t('settings.sites.clearHomePage') : t('settings.sites.error.onlyWorkspaceOwnerCanRemoveHomepage')}>
          <IconButton
            disabled={removeLoading}
            onClick={async (e) => {
              e.stopPropagation();
              if (!isOwner) return;
              setRemoveLoading(true);
              try {
                await onRemoveHomePage();
              } finally {
                setRemoveLoading(false);
              }
            }}
            size={'small'}
            className={'ml-1'}
          >
            {removeLoading ? <CircularProgress size={14} /> :
              <RemoveIcon className={'w-3 h-3'} />}
          </IconButton>
        </Tooltip>}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        classes={{
          paper: 'max-h-[500px] w-[320px] appflowy-scroller overflow-y-auto overflow-x-hidden',
        }}
      >
        <div
          className={'sticky w-full bg-bg-body z-[1] pr-2 p-4 top-0'}
        >
          <OutlinedInput
            value={searchText}
            fullWidth
            placeholder={t('button.search')}
            onChange={(e) => setSearchText(e.target.value)}
            size={'small'}
            autoFocus={true}
            startAdornment={<SearchIcon className={'h-4 w-4'} />}
            inputProps={{
              className: 'px-2 py-1.5 text-sm',
            }}
          />
        </div>
        <div className={'flex flex-col gap-2 p-4 pt-0 pr-2 w-full '}>
          {views.map(view => (
            <Button
              color={'inherit'}
              key={view.view_id}
              onClick={async () => {
                setUpdateLoading(true);
                await onUpdateHomePage(view.view_id);
                setUpdateLoading(false);
                setAnchorEl(null);
              }}
              startIcon={<PageIcon
                iconSize={16}
                className={'text-sm w-4 h-4 flex items-center justify-center'}
                view={view}
              />}
              className={'w-full p-1 px-2 justify-start overflow-hidden'}
            >
              <span className={'truncate'}>
                {view.name || t('menuAppHeader.defaultNewPageName')}
              </span>

            </Button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export default HomePageSetting;