import { AFConfigContext } from '@/components/main/app.hooks';
import React, { useCallback, useContext, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { NormalModal } from '@/components/_shared/modal';
import SelectWorkspace from '@/components/publish/header/duplicate/SelectWorkspace';
import { useLoadWorkspaces } from '@/components/publish/header/duplicate/useDuplicate';
import SpaceList from '@/components/publish/header/duplicate/SpaceList';
import { downloadPage, openAppFlowySchema } from '@/utils/url';
import { PublishContext } from '@/application/publish';
import { Types, ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';

function getCollabTypeFromViewLayout (layout: ViewLayout) {
  switch (layout) {
    case ViewLayout.Document:
      return Types.Document;
    case ViewLayout.Grid:
    case ViewLayout.Board:
    case ViewLayout.Calendar:
      return Types.Database;
    default:
      return null;
  }
}

function DuplicateModal ({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const service = useContext(AFConfigContext)?.service;
  const viewMeta = useContext(PublishContext)?.viewMeta;
  const viewId = viewMeta?.view_id;
  const layout = viewMeta?.layout as ViewLayout;
  const [loading, setLoading] = React.useState<boolean>(false);
  const [successModalOpen, setSuccessModalOpen] = React.useState<boolean>(false);
  const [newViewId, setNewViewId] = React.useState<string | undefined>(undefined);
  const {
    workspaceList,
    spaceList,
    setSelectedSpaceId,
    setSelectedWorkspaceId,
    selectedWorkspaceId,
    selectedSpaceId,
    workspaceLoading,
    spaceLoading,
    loadWorkspaces,
    loadSpaces,
  } = useLoadWorkspaces();

  useEffect(() => {
    if (open) {
      void loadWorkspaces();
    }
  }, [loadWorkspaces, open]);

  useEffect(() => {
    if (selectedWorkspaceId && open) {
      void loadSpaces(selectedWorkspaceId);
    }
  }, [loadSpaces, selectedWorkspaceId, open]);

  const handleDuplicate = useCallback(async () => {
    if (!viewId) return;
    const collabType = getCollabTypeFromViewLayout(layout);

    if (collabType === null) return;

    setLoading(true);
    try {
      const newViewId = await service?.duplicatePublishView({
        workspaceId: selectedWorkspaceId,
        spaceViewId: selectedSpaceId,
        viewId,
        collabType,
      });

      onClose();
      setSuccessModalOpen(true);
      setNewViewId(newViewId);
    } catch (e) {
      setNewViewId(undefined);
      notify.error(t('publish.duplicateFailed'));
    } finally {
      setLoading(false);
    }
  }, [viewId, layout, service, selectedWorkspaceId, selectedSpaceId, onClose, t]);

  return (
    <>
      <NormalModal
        okButtonProps={{
          disabled: !selectedWorkspaceId || !selectedSpaceId,
        }}
        onCancel={onClose}
        okText={t('button.add')}
        title={t('publish.duplicateTitle')}
        open={open}
        onClose={onClose}
        classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' }}
        onOk={handleDuplicate}
        okLoading={loading}
      >
        <div className={'flex flex-col gap-4'}>
          <SelectWorkspace
            loading={workspaceLoading}
            workspaceList={workspaceList}
            value={selectedWorkspaceId}
            onChange={setSelectedWorkspaceId}
          />
          <SpaceList
            loading={spaceLoading}
            spaceList={spaceList}
            value={selectedSpaceId}
            onChange={setSelectedSpaceId}
          />
        </div>
      </NormalModal>
      <NormalModal
        PaperProps={{
          sx: {
            maxWidth: 420,
          },
        }}
        okText={t('openInBrowser')}
        cancelText={t('openInApp')}
        onOk={() => {
          if (!newViewId || !selectedWorkspaceId) return;
          window.open(`/app/${selectedWorkspaceId}/${newViewId}`, '_self');
        }}
        onCancel={() => {
          window.open(openAppFlowySchema, '_self');
        }}
        onClose={() => setSuccessModalOpen(false)}
        open={successModalOpen}
        title={
          <div className={'text-left'}>
            {t('addToWorkspace')}
          </div>
        }
      >
        <div className={'w-full whitespace-pre-wrap break-words pb-1 text-text-caption'}>
          <Trans
            i18nKey="downloadTip"
            components={{
              link: <span
                onClick={() => {
                  window.open(downloadPage, '_blank');
                }}
                className={'hover:underline cursor-pointer text-fill-default'}
              >{t('here')}</span>,
            }}
          />
        </div>
      </NormalModal>
    </>
  );
}

export default DuplicateModal;