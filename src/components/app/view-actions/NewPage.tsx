import { Button } from '@mui/material';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { ReactComponent as Add } from '@/assets/icons/add_new_page.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import {
  useAppOperations,
  useAppOutline,
  useEnsureViewVisibleInOutline,
  useOpenPageModal,
} from '@/components/app/app.hooks';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';
import SpaceList from '@/components/publish/header/duplicate/SpaceList';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

const CREATE_SPACE_INITIAL_PAGE = { layout: ViewLayout.Document };

function NewPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const addingPageRef = useRef(false);
  const outline = useAppOutline();
  const spaceList = useMemo(() => {
    if (!outline) return [];

    return outline.map((view) => ({
      id: view.view_id,
      extra: JSON.stringify(view.extra),
      name: view.name,
      isPrivate: view.is_private,
    }));
  }, [outline]);

  const { addPage } = useAppOperations();
  const openPageModal = useOpenPageModal();
  const ensureViewVisibleInOutline = useEnsureViewVisibleInOutline();

  const closeFlow = useCallback(() => {
    if (addingPageRef.current) return;
    setCreateSpaceOpen(false);
    setOpen(false);
  }, []);

  const handleAddPage = useCallback(
    async (parentId: string) => {
      if (addingPageRef.current || !addPage || !openPageModal) return;
      addingPageRef.current = true;
      setLoading(true);
      try {
        // Append after the last child so the new page appears at the bottom.
        const parentSpace = outline?.find((view) => view.view_id === parentId);
        const lastChild = parentSpace?.children?.[parentSpace.children.length - 1];

        Log.debug('[handleAddPage]', { parentId, layout: ViewLayout.Document, prev_view_id: lastChild?.view_id });
        const response = await addPage(parentId, {
          layout: ViewLayout.Document,
          prev_view_id: lastChild?.view_id,
        });

        openPageModal(response.view_id);
        setOpen(false);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      } finally {
        addingPageRef.current = false;
        setLoading(false);
      }
    },
    [addPage, openPageModal, outline]
  );

  const openCreateSpace = useCallback(() => {
    if (addingPageRef.current) return;
    setCreateSpaceOpen(true);
  }, []);

  const handleSpaceCreated = useCallback(
    async (_spaceId: string, initialPageId?: string) => {
      setCreateSpaceOpen(false);
      setOpen(false);
      if (!initialPageId) return;

      // The creation response can arrive before the folder projection reaches
      // the current outline. Hydrate the exact child ID before opening it so
      // ViewModal starts with authoritative metadata for the created document.
      try {
        await ensureViewVisibleInOutline?.(initialPageId);
      } catch (error) {
        Log.warn('[NewPage] Failed to hydrate a newly created page in the outline', {
          initialPageId,
          error,
        });
      }

      openPageModal?.(initialPageId);
    },
    [ensureViewVisibleInOutline, openPageModal]
  );

  return (
    <>
      <div
        data-testid='new-page-button'
        onClick={() => setOpen(true)}
        className={cn(dropdownMenuItemVariants(), 'w-full')}
      >
        <Add />
        {t('newPageText')}
      </div>
      <NormalModal
        data-testid='new-page-modal'
        okText={t('button.add')}
        title={t('publish.duplicateTitle')}
        open={open && !createSpaceOpen}
        onClose={closeFlow}
        classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' }}
        onOk={() => {
          void handleAddPage(selectedSpaceId);
        }}
        okButtonProps={{
          disabled: !selectedSpaceId || loading,
        }}
        okLoading={loading}
      >
        <SpaceList
          loading={false}
          spaceList={spaceList}
          value={selectedSpaceId}
          onChange={setSelectedSpaceId}
          title={
            <div className='flex items-center text-sm text-text-secondary'>
              {t('publish.addTo')}
              {` ${t('web.or')} `}
              <Button
                data-testid='new-page-create-space-button'
                disabled={loading}
                onClick={openCreateSpace}
                size='small'
                className='mx-1 text-sm'
              >
                {t('space.createNewSpace')}
              </Button>
            </div>
          }
        />
      </NormalModal>
      <CreateSpaceModal
        open={open && createSpaceOpen}
        initialPage={CREATE_SPACE_INITIAL_PAGE}
        onClose={closeFlow}
        onCreated={handleSpaceCreated}
      />
    </>
  );
}

export default NewPage;
