import { Button, CircularProgress, IconButton, OutlinedInput, Tooltip } from '@mui/material';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { SubscriptionPlan, View } from '@/application/types';
import { ReactComponent as RemoveIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as UpgradeIcon } from '@/assets/icons/upgrade.svg';
import { Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { isAppFlowyHosted } from '@/utils/subscription';

interface HomePageSettingProps {
  onRemoveHomePage: () => Promise<void>;
  onUpdateHomePage: (newPageId: string) => Promise<void>;
  homePage?: View;
  publishViews: View[];
  isOwner: boolean;
  activePlan: SubscriptionPlan | null;
  canEdit?: boolean;
}

function HomePageSetting({
  activePlan,
  onRemoveHomePage,
  onUpdateHomePage,
  homePage,
  publishViews,
  isOwner,
  canEdit = true,
}: HomePageSettingProps) {
  const [removeLoading, setRemoveLoading] = React.useState<boolean>(false);
  const [updateLoading, setUpdateLoading] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const [searchText, setSearchText] = React.useState<string>('');
  const views = useMemo(() => {
    if (!searchText) return publishViews;
    return publishViews.filter((view) => view.name?.toLowerCase().includes(searchText.toLowerCase()));
  }, [publishViews, searchText]);

  const [, setSearch] = useSearchParams();
  const handleUpgrade = useCallback(async () => {
    if (!isOwner) return;
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch, isOwner]);

  // Don't show homepage setting when namespace is not editable (e.g., UUID namespace)
  if (!canEdit) {
    return null;
  }

  if (activePlan && activePlan !== SubscriptionPlan.Pro) {
    // Only show upgrade button on official hosts (self-hosted instances have Pro features enabled by default)
    if (!isAppFlowyHosted()) {
      return null;
    }

    return (
      <Tooltip title={!isOwner ? t('settings.sites.namespace.pleaseAskOwnerToSetHomePage') : undefined}>
        <Button
          variant={'contained'}
          color={'secondary'}
          size={'small'}
          onClick={handleUpgrade}
          endIcon={<UpgradeIcon />}
          data-testid="homepage-upgrade-button"
        >
          {t('subscribe.changePlan')}
        </Button>
      </Tooltip>
    );
  }

  return (
    <div className={'flex flex-1 items-center overflow-hidden'} data-testid="homepage-setting">
      <Tooltip title={isOwner ? homePage?.name : t('settings.sites.error.onlyWorkspaceOwnerCanChangeHomepage')}>
        <Button
          onClick={(e) => {
            if (!isOwner) return;
            setAnchorEl(e.currentTarget);
          }}
          color={'inherit'}
          classes={{
            startIcon: 'mr-0',
          }}
          className={'max-w-[120px] gap-1 overflow-hidden'}
          startIcon={
            updateLoading ? (
              <CircularProgress size={14} />
            ) : homePage ? (
              <PageIcon iconSize={18} className={'text-sm'} view={homePage} />
            ) : (
              <SearchIcon className={'opacity-60'} />
            )
          }
          size={'small'}
        >
          {homePage ? (
            <span className={'truncate text-left'}>{homePage.name || t('menuAppHeader.defaultNewPageName')}</span>
          ) : (
            t('settings.sites.selectHomePage')
          )}
        </Button>
      </Tooltip>
      {homePage && (
        <Tooltip
          title={
            isOwner ? t('settings.sites.clearHomePage') : t('settings.sites.error.onlyWorkspaceOwnerCanRemoveHomepage')
          }
        >
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
            {removeLoading ? <CircularProgress size={14} /> : <RemoveIcon className={'h-3 w-3'} />}
          </IconButton>
        </Tooltip>
      )}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        classes={{
          paper: 'max-h-[500px] w-[320px] appflowy-scroller overflow-y-auto overflow-x-hidden',
        }}
      >
        <div className={'sticky top-0 z-[1] w-full bg-background-primary p-4 pr-2'}>
          <OutlinedInput
            value={searchText}
            fullWidth
            placeholder={t('button.search')}
            onChange={(e) => setSearchText(e.target.value)}
            size={'small'}
            autoFocus={true}
            startAdornment={<SearchIcon className={'h-5 w-5'} />}
            inputProps={{
              className: 'px-2 py-1.5 text-sm',
            }}
          />
        </div>
        <div className={'flex w-full flex-col gap-2 p-4 pr-2 pt-0 '}>
          {views.map((view) => (
            <Button
              color={'inherit'}
              key={view.view_id}
              onClick={async () => {
                setUpdateLoading(true);
                await onUpdateHomePage(view.view_id);
                setUpdateLoading(false);
                setAnchorEl(null);
              }}
              startIcon={
                <PageIcon iconSize={16} className={'flex h-4 w-4 items-center justify-center text-sm'} view={view} />
              }
              className={'w-full justify-start overflow-hidden p-1 px-2'}
            >
              <span className={'truncate'}>{view.name || t('menuAppHeader.defaultNewPageName')}</span>
            </Button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export default HomePageSetting;
