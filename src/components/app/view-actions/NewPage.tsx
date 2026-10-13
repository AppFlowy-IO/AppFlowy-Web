import { Button as MuiButton } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View, ViewLayout } from '@/application/types';
import { ReactComponent as Add } from '@/assets/icons/add_new_page.svg';
import { ReactComponent as LockSvg } from '@/assets/icons/lock.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import LoadingDots from '@/components/_shared/LoadingDots';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import {
  useAppOperations,
  useAppOutline,
  useCurrentWorkspaceId,
  useEnsureViewVisibleInOutline,
  useOpenPageModal,
} from '@/components/app/app.hooks';
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import {
  canStartSpaceCreation,
  spaceCreationUnavailableKey,
  spaceCreationUnavailableReason,
} from '@/components/app/view-actions/SpaceCreationNotice';
import {
  pageDestinationReasonKey,
  type SpaceDestinationAccess,
  useSpaceDestinationAccess,
} from '@/components/app/view-actions/usePageDestinationAccess';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
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
        <MuiButton
          data-testid='new-page-create-space-loading-cancel'
          onClick={onClose}
          size='small'
          variant='outlined'
        >
          {cancelLabel}
        </MuiButton>
      </div>
    </div>
  );
}

/** Pages can be added to a destination that is confirmed, or that could not be checked (the server decides). */
function acceptsNewPage(access: SpaceDestinationAccess | undefined) {
  return access?.state === 'allowed' || access?.state === 'unverified';
}

function NewPageDestination({
  space,
  access,
  selected,
  onSelect,
}: {
  space: View;
  access: SpaceDestinationAccess;
  selected: boolean;
  onSelect: (spaceId: string) => void;
}) {
  const { t } = useTranslation();
  const denied = access.state === 'denied';

  return (
    <Button
      type='button'
      variant='ghost'
      data-testid='space-item'
      aria-pressed={selected}
      disabled={denied}
      className='h-auto min-h-8 w-full justify-start gap-[10px] p-1 text-left font-normal'
      onClick={() => onSelect(space.view_id)}
    >
      <SpaceIcon
        value={space.extra?.space_icon || ''}
        char={space.extra?.space_icon ? undefined : space.name.slice(0, 1)}
        bgColor={space.extra?.space_icon_color}
        className='icon h-5 w-5'
      />
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='flex items-center gap-2 truncate text-sm'>
          <span className='truncate'>{space.name}</span>
          {space.is_private && <LockSvg className='text-icon-primary' />}
        </span>
        {access.state === 'denied' && (
          <span className='truncate text-xs text-text-tertiary'>{t(pageDestinationReasonKey(access.reason))}</span>
        )}
      </span>
      <span className='flex h-5 w-5 items-center justify-center'>
        {access.state === 'checking' ? (
          <Progress variant='primary' aria-label={t('spaceCreation.pageDestination.checking')} />
        ) : selected ? (
          <CheckIcon className='h-5 w-5 text-text-action' />
        ) : null}
      </span>
    </Button>
  );
}

function NewPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const workspaceId = useCurrentWorkspaceId();
  const creationPermission = useSpaceCreationCapability(workspaceId, open);
  const [loading, setLoading] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [CreateSpaceModal, setCreateSpaceModal] = useState<CreateSpaceModalType | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState('');
  const addingPageRef = useRef(false);
  const pageOpenSequenceRef = useRef(0);
  const outline = useAppOutline();
  const spaces = useMemo(() => outline ?? [], [outline]);
  const spaceIds = useMemo(() => spaces.map((space) => space.view_id), [spaces]);
  // New pages go directly under a space: each destination needs Write plus sidebar authority.
  const destinationAccess = useSpaceDestinationAccess(spaceIds, open && !createSpaceOpen);
  const selectedAccess = selectedSpaceId ? destinationAccess[selectedSpaceId] : undefined;
  const canAddToSelected = Boolean(selectedSpaceId) && acceptsNewPage(selectedAccess);
  const noDestinationAvailable =
    spaces.length > 0 && spaces.every((space) => destinationAccess[space.view_id]?.state === 'denied');
  const destinationStatus =
    selectedSpaceId && (!selectedAccess || selectedAccess.state === 'checking')
      ? t('spaceCreation.pageDestination.checking')
      : noDestinationAvailable
      ? t('spaceCreation.pageDestination.noneAvailable')
      : null;
  const createSpaceReason = spaceCreationUnavailableReason(creationPermission);

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
      if (addingPageRef.current || !addPage || !openPageModal || !acceptsNewPage(destinationAccess[parentId])) return;
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
    [addPage, destinationAccess, openPageModal, outline]
  );

  const canOpenCreateSpace = canStartSpaceCreation(creationPermission);
  const openCreateSpace = useCallback(() => {
    if (addingPageRef.current || !canOpenCreateSpace) return;
    invalidatePendingPageOpen();
    setCreateSpaceOpen(true);
  }, [canOpenCreateSpace, invalidatePendingPageOpen]);

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
          disabled: !canAddToSelected || loading,
        }}
        okLoading={loading}
      >
        <div className='flex max-h-[320px] w-[360px] flex-col gap-2 overflow-hidden max-sm:w-full'>
          <div className='flex flex-col gap-1'>
            <div className='flex items-center text-sm text-text-secondary'>
              {t('publish.addTo')}
              {` ${t('web.or')} `}
              <Button
                type='button'
                variant='link'
                size='sm'
                data-testid='new-page-create-space-button'
                disabled={loading || !canOpenCreateSpace}
                onClick={openCreateSpace}
                className='mx-1 px-0 text-sm'
              >
                {t('space.createNewSpace')}
              </Button>
            </div>
            {createSpaceReason && (
              <div
                className='flex items-center gap-2 text-xs text-text-tertiary'
                data-testid='new-page-create-space-reason'
              >
                <span>{t(spaceCreationUnavailableKey(createSpaceReason))}</span>
                {createSpaceReason === 'loadError' && (
                  <Button
                    type='button'
                    variant='link'
                    size='sm'
                    className='px-0 text-xs'
                    onClick={() => {
                      void creationPermission.refresh();
                    }}
                  >
                    {t('spaceCreation.tryAgain')}
                  </Button>
                )}
              </div>
            )}
          </div>
          {spaces.length === 0 ? (
            <div className='flex min-h-12 w-full items-center text-sm text-text-secondary'>
              {t('publish.noSpacesAvailable')}
            </div>
          ) : (
            <div className='appflowy-scroller flex w-full flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden'>
              {spaces.map((space) => (
                <NewPageDestination
                  key={space.view_id}
                  space={space}
                  access={destinationAccess[space.view_id] ?? { state: 'checking' }}
                  selected={selectedSpaceId === space.view_id}
                  onSelect={setSelectedSpaceId}
                />
              ))}
            </div>
          )}
          {destinationStatus && (
            <p role='status' className='text-xs text-text-tertiary' data-testid='new-page-destination-status'>
              {destinationStatus}
            </p>
          )}
        </div>
      </NormalModal>
      {open && createSpaceOpen ? (
        CreateSpaceModal ? (
          <CreateSpaceModal
            key={creationPermission.scopeKey}
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
