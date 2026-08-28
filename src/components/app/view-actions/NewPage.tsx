import { Button } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { ReactComponent as Add } from '@/assets/icons/add_new_page.svg';
import LoadingDots from '@/components/_shared/LoadingDots';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import {
  useAppOperations,
  useAppOutline,
  useEnsureViewVisibleInOutline,
  useOpenPageModal,
} from '@/components/app/app.hooks';
import SpaceList from '@/components/publish/header/duplicate/SpaceList';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

const CREATE_SPACE_INITIAL_PAGE = { layout: ViewLayout.Document };
const CREATE_SPACE_DIALOG_LOAD_ERROR = 'Unable to load the Create Space dialog. Please try again.';

type CreateSpaceModalType = (typeof import('@/components/app/view-actions/CreateSpaceModal'))['default'];

function CreateSpaceLoading({
  cancelLabel,
  loadingLabel,
  onClose,
}: {
  cancelLabel: string;
  loadingLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      aria-label={loadingLabel}
      aria-modal='true'
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/50'
      data-testid='new-page-create-space-loading'
      role='dialog'
    >
      <div className='flex min-w-64 flex-col items-center gap-4 rounded-lg bg-bg-body p-6 shadow-lg'>
        <LoadingDots />
        <span aria-live='polite' className='text-sm text-text-secondary'>
          {loadingLabel}
        </span>
        <Button
          data-testid='new-page-create-space-loading-cancel'
          onClick={onClose}
          size='small'
          variant='outlined'
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

function NewPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [CreateSpaceModal, setCreateSpaceModal] = useState<CreateSpaceModalType | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const addingPageRef = useRef(false);
  const pageOpenSequenceRef = useRef(0);
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

  const invalidatePendingPageOpen = useCallback(() => {
    pageOpenSequenceRef.current += 1;
  }, []);

  useEffect(
    () => () => {
      invalidatePendingPageOpen();
    },
    [invalidatePendingPageOpen]
  );

  const closeFlow = useCallback(() => {
    if (addingPageRef.current) return;
    invalidatePendingPageOpen();
    setCreateSpaceOpen(false);
    setOpen(false);
  }, [invalidatePendingPageOpen]);

  const handleAddPage = useCallback(
    async (parentId: string) => {
      if (addingPageRef.current || !addPage || !openPageModal) return;
      const pageOpenSequence = ++pageOpenSequenceRef.current;

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

        if (pageOpenSequence !== pageOpenSequenceRef.current) return;
        openPageModal(response.view_id);
        setOpen(false);
      } catch (error) {
        if (pageOpenSequence !== pageOpenSequenceRef.current) return;
        notify.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (pageOpenSequence === pageOpenSequenceRef.current) {
          addingPageRef.current = false;
          setLoading(false);
        }
      }
    },
    [addPage, openPageModal, outline]
  );

  const openCreateSpace = useCallback(() => {
    if (addingPageRef.current) return;
    invalidatePendingPageOpen();
    setCreateSpaceOpen(true);
  }, [invalidatePendingPageOpen]);

  useEffect(() => {
    if (!open || !createSpaceOpen || CreateSpaceModal) return;
    let cancelled = false;

    void import('@/components/app/view-actions/CreateSpaceModal')
      .then((module) => {
        if (!cancelled) setCreateSpaceModal(() => module.default);
      })
      .catch(() => {
        if (cancelled) return;
        notify.error(CREATE_SPACE_DIALOG_LOAD_ERROR);
        closeFlow();
      });

    return () => {
      cancelled = true;
    };
  }, [CreateSpaceModal, closeFlow, createSpaceOpen, open]);

  const handleSpaceCreated = useCallback(
    async (_spaceId: string, initialPageId?: string) => {
      const pageOpenSequence = ++pageOpenSequenceRef.current;

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

      if (pageOpenSequence !== pageOpenSequenceRef.current) return;
      openPageModal?.(initialPageId);
    },
    [ensureViewVisibleInOutline, openPageModal]
  );

  const openFlow = useCallback(() => {
    if (addingPageRef.current) return;
    invalidatePendingPageOpen();
    setCreateSpaceOpen(false);
    setOpen(true);
  }, [invalidatePendingPageOpen]);

  return (
    <>
      <div
        data-testid='new-page-button'
        onClick={openFlow}
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
      {open && createSpaceOpen ? (
        CreateSpaceModal ? (
          <CreateSpaceModal
            open
            initialPage={CREATE_SPACE_INITIAL_PAGE}
            onClose={closeFlow}
            onCreated={handleSpaceCreated}
          />
        ) : (
          <CreateSpaceLoading
            cancelLabel={t('button.cancel')}
            loadingLabel={t('loading')}
            onClose={closeFlow}
          />
        )
      ) : null}
    </>
  );
}

export default NewPage;
