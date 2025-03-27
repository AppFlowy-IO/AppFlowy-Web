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
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as GlobalIcon } from '@/assets/publish.svg';
import { ReactComponent as CopyIcon } from '@/assets/copy.svg';
import { ReactComponent as TrashIcon } from '@/assets/trash.svg';
import { ReactComponent as SettingIcon } from '@/assets/settings.svg';

function PublishedPageItem({ namespace, onClose, view, onUnPublish }: {
  view: View,
  onClose?: () => void;
  onUnPublish: (viewId: string) => Promise<void>;
  onPublish: (view: View, publishName: string) => Promise<void>;
  namespace: string;
}) {
  const { t } = useTranslation();
  const [openSetting, setOpenSetting] = React.useState<boolean>(false);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [publishName, setPublishName] = React.useState<string>(view.publish_name || '');
  const toView = useAppHandlers().toView;
  const [unPublishLoading, setUnPublishLoading] = React.useState<boolean>(false);
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const workspaceId = userWorkspaceInfo?.selectedWorkspace?.id;
  const isPublisher = view?.publisher_email === currentUser?.email;
  const service = useService();

  useEffect(() => {
    setPublishName(view.publish_name || '');
  }, [view.publish_name]);

  const url = useMemo(() => {
    return `${window.origin}/${namespace}/${publishName}`;
  }, [namespace, publishName]);

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
        tooltip: !(isOwner || isPublisher) ? t('settings.sites.error.unPublishPermissionDenied') : undefined,
        IconComponent: unPublishLoading ? CircularProgress : TrashIcon,
        onClick: async() => {
          if(!(isOwner || isPublisher)) {
            return;
          }

          setUnPublishLoading(true);
          try {
            await onUnPublish(view.view_id);
          } catch(e) {
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
          if(!(isOwner || isPublisher)) return;
          setAnchorEl(null);
          setOpenSetting(true);
        },
      },

    ];
  }, [t, isOwner, isPublisher, unPublishLoading, url, onUnPublish, view.view_id]);

  const updatePublishName = useCallback(async(newPublishName: string) => {
    if(!service || !workspaceId || !view) return;
    try {
      await service.updatePublishConfig(workspaceId, {
        view_id: view.view_id,
        publish_name: newPublishName,
      });
      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e.message);
    }

  }, [service, view, workspaceId]);

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
            onClick={async() => {
              await toView(view.view_id);
              onClose?.();
            }}
            size={'small'}
            startIcon={<PageIcon
              iconSize={16}
              className={'text-sm w-5 h-5 flex items-center justify-center'}
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
            {`Open Page in New Tab \n${publishName || ''}`}
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
                {publishName}
              </span>
          </Button>
        </Tooltip>
      </div>
      <div className={'flex-1  overflow-hidden flex gap-2 justify-between'}>
        {view?.publish_timestamp ? dayjs(view.publish_timestamp).format('MMM D, YYYY') : ''}
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
                startIcon={<action.IconComponent
                  size={14}
                  className={'w-4 h-4'}
                />}
                color={'inherit'}
              >{action.label}</Button>
            </Tooltip>;
          })}
        </div>
      </Popover>
      {openSetting && <PublishNameSetting
        onUnPublish={() => {
          return onUnPublish(view.view_id);
        }}
        updatePublishName={async(publishName: string) => {
          await updatePublishName(publishName);
          setPublishName(publishName);
        }}
        onClose={() => {
          setOpenSetting(false);
        }}
        url={url}
        open={openSetting}
        defaultName={publishName}
      />}
    </div>
  );
}

export default PublishedPageItem;