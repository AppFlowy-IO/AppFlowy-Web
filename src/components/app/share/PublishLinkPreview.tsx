import { UpdatePublishConfigPayload } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { PublishManage } from '@/components/app/publish-manage';
import { PublishNameSetting } from '@/components/app/publish-manage/PublishNameSetting';
import { copyTextToClipboard } from '@/utils/copy';
import { CircularProgress, IconButton, InputBase, Tooltip } from '@mui/material';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as DownIcon } from '@/assets/icons/toggle_list.svg';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

function PublishLinkPreview({
  viewId,
  publishInfo,
  onUnPublish,
  updatePublishConfig,
  url,
  isOwner,
  isPublisher,
  onClose,
}: {
  viewId: string;
  publishInfo: { namespace: string, publishName: string };
  onUnPublish: () => Promise<void>;
  updatePublishConfig: (payload: UpdatePublishConfigPayload) => Promise<void>;
  url: string;
  isOwner: boolean;
  isPublisher: boolean;
  onClose?: () => void;
}) {
  const [siteOpen, setSiteOpen] = React.useState<boolean>(false);
  const [renameOpen, setRenameOpen] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [publishName, setPublishName] = React.useState<string>(publishInfo.publishName);
  const [loading, setLoading] = React.useState<boolean>(false);

  useEffect(() => {
    setPublishName(publishInfo.publishName);
  }, [publishInfo.publishName]);
  
  const handleUpdatePublishName = async(newName: string) => {
    if(loading) return;
    if(newName === publishInfo.publishName) return;
    setLoading(true);
    setPublishName(newName);
    try {
      await updatePublishConfig({
        publish_name: newName,
        view_id: viewId,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className={'overflow-hidden items-center w-full flex'}>
        <div className={'flex-1 overflow-hidden flex items-center gap-1'}>
          <Tooltip
            placement={'top'}
            title={window.location.origin}
          >
            <div className={'border flex-1 cursor-default truncate bg-fill-list-hover border-line-divider rounded-[6px] py-1 px-2'}>{window.location.origin}</div>
          </Tooltip>
          {'/'}
          <div className={'border gap-1 w-[110px] border-line-divider rounded-[6px] py-1 px-2 flex items-center'}>
            <Tooltip
              placement={'top'}
              title={publishInfo.namespace}
            >
              <span className={'flex-1 truncate'}>{publishInfo.namespace}</span>
            </Tooltip>
            <Tooltip
              placement={'top'}
              title={t('settings.sites.namespaceDescription')}
            >
              <IconButton
                size={'small'}
                onClick={() => {
                  setSiteOpen(true);
                  onClose?.();
                }}
              >
                <DownIcon className={'transform rotate-90'} />
              </IconButton>
            </Tooltip>

          </div>
          {'/'}


          <div
            className={'border gap-1  flex items-center truncate w-[150px] border-line-divider rounded-[6px] py-1 px-2'}
          >
            <Tooltip
              placement={'top'}
              title={publishName}
            >
              <InputBase
                disabled={!isOwner && !isPublisher}
                inputProps={{
                  className: 'pb-0',
                }}
                onBlur={() => {
                  void handleUpdatePublishName(publishName);
                }}
                onKeyDown={async(e) => {
                  if(e.key === 'Enter') {
                    void handleUpdatePublishName(publishName);
                  }
                }}
                size={'small'}
                value={publishName}
                onChange={e => {
                  setPublishName(e.target.value);
                }}
                className={'flex-1 truncate'}
              />
            </Tooltip>
            {(isOwner || isPublisher) && <Tooltip
              placement={'top'}
              title={t('settings.sites.customUrl')}
            >
              <IconButton
                size={'small'}
                onMouseDown={e => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();

                  setRenameOpen(true);
                  onClose?.();
                }}
              >
                {loading ? <CircularProgress size={14} /> :
                  <DownIcon className={'transform rotate-90'} />}
              </IconButton>
            </Tooltip>}

          </div>
        </div>
        <div className={'text-text-title p-1'}>
          <Tooltip
            placement={'top'}
            title={t('shareAction.copyLink')}
          >
            <IconButton
              onClick={async() => {
                await copyTextToClipboard(url);
                notify.success(t('shareAction.copyLinkSuccess'));
              }}
              color={'inherit'}
              size={'small'}
            >
              <LinkIcon />
            </IconButton>
          </Tooltip>
        </div>
        {renameOpen && <PublishNameSetting
          defaultName={publishInfo.publishName}
          onClose={() => { setRenameOpen(false); }}
          open={renameOpen}
          onUnPublish={onUnPublish}
          updatePublishName={handleUpdatePublishName}
          url={url}
        />}
        <NormalModal
          okButtonProps={{
            className: 'hidden',
          }}
          cancelButtonProps={{
            className: 'hidden',
          }}
          classes={{
            paper: 'w-[700px] appflowy-scroller max-w-[90vw] max-h-[90vh] h-[600px] overflow-hidden',
          }}
          overflowHidden
          onClose={() => {
            setSiteOpen(false);
          }}
          scroll={'paper'}
          open={siteOpen}
          title={<div className={'justify-start flex items-center'}>{t('settings.sites.title')}</div>}
        >
          <div className={'w-full h-full overflow-x-hidden overflow-y-auto'}>
            <PublishManage
              onClose={() => {
                setSiteOpen(false);
              }}
            />
          </div>

        </NormalModal>
      </div>

    </>
  );
}

export default PublishLinkPreview;