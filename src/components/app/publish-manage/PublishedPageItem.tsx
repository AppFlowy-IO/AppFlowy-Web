import { View } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { PublishNameSetting } from '@/components/app/publish-manage/PublishNameSetting';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { copyTextToClipboard } from '@/utils/copy';
import { openUrl } from '@/utils/url';
import { Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as MoreIcon } from '@/assets/more.svg';
import { ReactComponent as GlobalIcon } from '@/assets/publish.svg';
import { ReactComponent as CopyIcon } from '@/assets/copy.svg';
import { ReactComponent as TrashIcon } from '@/assets/trash.svg';
import { ReactComponent as SettingIcon } from '@/assets/settings.svg';

function PublishedPageItem ({ onClose, view, onUnPublish, onPublish }: {
  view: View,
  onClose?: () => void;
  onUnPublish: (viewId: string) => Promise<void>;
  onPublish: (view: View, publishName: string) => Promise<void>
}) {
  const { t } = useTranslation();
  const [openSetting, setOpenSetting] = React.useState<boolean>(false);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [publishInfo, setPublishInfo] = React.useState<{
    namespace: string,
    publishName: string,
    publisherEmail: string
    publishedAt: string
  } | undefined>(undefined);
  const toView = useAppHandlers().toView;
  const service = useService();
  const [unPublishLoading, setUnPublishLoading] = React.useState<boolean>(false);
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const isPublisher = publishInfo?.publisherEmail === currentUser?.email;

  const getPublishInfo = useCallback(async (viewId: string) => {
    if (!service) return;

    try {
      const res = await service?.getPublishInfo(viewId);

      setPublishInfo(res);
      return res;
    } catch (e) {
      console.error(e);
    }
  }, [service]);

  const url = useMemo(() => {
    return `${window.origin}/${publishInfo?.namespace}/${publishInfo?.publishName}`;
  }, [publishInfo]);

  useEffect(() => {
    void getPublishInfo(view.view_id);
  }, [getPublishInfo, view.view_id]);

  const actions = useMemo(() => {
    return [
      {
        value: 'visit',
        label: t('shareAction.visitSite'),
        IconComponent: GlobalIcon,
        onClick: () => {
          void openUrl(url, '_blank');
        },
      },
      {
        value: 'copy',
        label: t('shareAction.copyLink'),
        IconComponent: CopyIcon,
        onClick: () => {
          void copyTextToClipboard(url);
          notify.success(t('shareAction.copyLinkSuccess'));
        },
      },
      {
        value: 'unpublish',
        disabled: unPublishLoading,
        label: t('shareAction.unPublish'),
        tooltip: !(isOwner || isPublisher) ? t('settings.sites.error.publishPermissionDenied') : undefined,
        IconComponent: unPublishLoading ? CircularProgress : TrashIcon,
        onClick: async () => {
          if (!(isOwner || isPublisher)) {
            return;
          }

          setUnPublishLoading(true);
          try {
            await onUnPublish(view.view_id);
          } catch (e) {
            console.error(e);
          } finally {
            setUnPublishLoading(false);
          }
        },
      },
      {
        value: 'setting',
        label: t('settings.title'),
        tooltip: !(isOwner || isPublisher) ? t('settings.sites.error.publishPermissionDenied') : undefined,

        IconComponent: SettingIcon,
        onClick: () => {
          if (!(isOwner || isPublisher)) return;
          setAnchorEl(null);
          setOpenSetting(true);
        },
      },

    ];
  }, [t, isOwner, isPublisher, unPublishLoading, url, onUnPublish, view.view_id]);

  return (
    <div
      className={'w-full px-1 flex text-sm font-medium items-center gap-4'}
    >
      <div className={'flex-1 overflow-hidden'}>
        <Tooltip
          disableInteractive={true}
          title={
            <div>
              Open {view.name || t('menuAppHeader.defaultNewPageName')}
            </div>
          }
        >
          <Button
            color={'inherit'}
            key={view.view_id}
            onClick={async () => {
              await toView(view.view_id);
              onClose?.();
            }}
            size={'small'}
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
        </Tooltip>
      </div>
      <div className={'flex-1 overflow-hidden'}>
        <Tooltip
          disableInteractive={true}
          title={<div className={'whitespace-pre-wrap break-words'}>
            {`Open Page in New Tab \n${publishInfo?.publishName || ''}`}
          </div>}
        >
          <Button
            color={'inherit'}
            key={view.view_id}
            onClick={() => {
              void openUrl(url, '_blank');
            }}
            size={'small'}
            className={'w-full p-1 px-2 justify-start overflow-hidden'}
          >
              <span className={'truncate'}>
                {publishInfo?.publishName}
              </span>
          </Button>
        </Tooltip>
      </div>
      <div className={'flex-1  overflow-hidden flex gap-2 justify-between'}>
        {dayjs(publishInfo?.publishedAt).format('MMM D, YYYY')}
        <IconButton
          onClick={(e) => {
            setAnchorEl(e.currentTarget);
          }}
          size={'small'}
        >
          <MoreIcon />
        </IconButton>
      </div>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(null);
        }}
      >
        <div className={'flex flex-col w-[200px] gap-2 p-2'}>
          {actions.map((action) => {
            return <Tooltip
              key={action.value}
              title={action.tooltip}
              disableInteractive={true}
            >
              <Button
                disabled={action.disabled}
                onClick={action.onClick}
                size={'small'}
                className={'justify-start'}
                startIcon={<action.IconComponent className={'w-4 h-4'} />}
                color={'inherit'}
              >{action.label}</Button>
            </Tooltip>;
          })}
        </div>
      </Popover>
      {openSetting && publishInfo && <PublishNameSetting
        onUnPublish={() => {
          return onUnPublish(view.view_id);
        }}
        onPublish={async (publishName: string) => {
          await onPublish(view, publishName);
          void getPublishInfo(view.view_id);
        }}
        onClose={() => {
          setOpenSetting(false);
        }}
        url={url}
        open={openSetting}
        defaultName={publishInfo.publishName}
      />}
    </div>
  );
}

export default PublishedPageItem;