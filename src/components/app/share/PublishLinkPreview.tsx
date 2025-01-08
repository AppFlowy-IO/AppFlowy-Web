import { NormalModal } from '@/components/_shared/modal';
import { PublishManage } from '@/components/app/publish-manage';
import { PublishNameSetting } from '@/components/app/publish-manage/PublishNameSetting';
import { CircularProgress, IconButton, InputBase, Tooltip } from '@mui/material';
import { ReactComponent as LinkIcon } from '@/assets/link.svg';
import { ReactComponent as DownIcon } from '@/assets/chevron_down.svg';
import { ReactComponent as CheckIcon } from '@/assets/check.svg';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

function PublishLinkPreview ({
  publishInfo,
  onUnPublish,
  onPublish,
  url,
  isOwner,
  isPublisher,
  onClose,
}: {
  publishInfo: { namespace: string, publishName: string };
  onUnPublish: () => Promise<void>;
  onPublish: (publishName?: string) => Promise<void>;
  url: string;
  isOwner: boolean;
  isPublisher: boolean;
  onClose?: () => void;
}) {
  const [siteOpen, setSiteOpen] = React.useState<boolean>(false);
  const [renameOpen, setRenameOpen] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const [publishName, setPublishName] = React.useState<string>(publishInfo.publishName);
  const [focused, setFocused] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(false);

  useEffect(() => {
    setPublishName(publishInfo.publishName);

  }, [publishInfo.publishName]);
  const handlePublish = async () => {
    if (loading) return;
    if (publishName === publishInfo.publishName) return;
    setLoading(true);
    try {
      await onPublish(publishName);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className={'overflow-hidden items-center w-full flex'}>
        <div className={'flex-1 overflow-hidden flex items-center gap-1'}>
          <div className={'border w-[177px] truncate bg-fill-list-hover border-line-divider rounded-[6px] py-1 px-2'}>{window.location.origin}</div>
          {'/'}
          <div className={'border gap-1 w-[100px] border-line-divider rounded-[6px] py-1 px-2 flex items-center'}>
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
                <DownIcon className={'w-4 h-4'} />
              </IconButton>
            </Tooltip>

          </div>
          {'/'}
          <div
            className={'border gap-1  flex items-center truncate w-[140px] border-line-divider rounded-[6px] py-1 px-2'}
          >
            <InputBase
              disabled={!isOwner && !isPublisher}
              inputProps={{
                className: 'pb-0',
              }}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  void handlePublish();
                }
              }}
              size={'small'}
              value={publishName}
              onChange={e => {
                setPublishName(e.target.value);
              }}
              className={'flex-1 truncate'}
            />
            {(isOwner || isPublisher) && <Tooltip
              placement={'top'}
              title={focused ? t('button.save') : t('settings.sites.customUrl')}
            >
              <IconButton
                size={'small'}
                onMouseDown={e => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (focused) {
                    void handlePublish();
                    return;
                  }

                  setRenameOpen(true);
                  onClose?.();
                }}
              >
                {loading ? <CircularProgress size={14} /> :
                  focused ? <CheckIcon className={'w-4 h-4'} /> :
                    <DownIcon className={'w-4 h-4'} />}
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
              color={'inherit'}
              size={'small'}
            >
              <LinkIcon className={'w-4 h-4'} />
            </IconButton>
          </Tooltip>
        </div>
        {renameOpen && <PublishNameSetting
          defaultName={publishInfo.publishName}
          onClose={() => { setRenameOpen(false); }}
          open={renameOpen}
          onUnPublish={onUnPublish}
          onPublish={onPublish}
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