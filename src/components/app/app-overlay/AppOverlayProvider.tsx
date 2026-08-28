import React, { useCallback, useEffect, useMemo, useState } from 'react';

import LoadingDots from '@/components/_shared/LoadingDots';
import { findView } from '@/components/_shared/outline/utils';
import { notify } from '@/components/_shared/notify';
import { AppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppOperations, useAppOutline } from '@/components/app/app.hooks';
import DeletePageConfirm from '@/components/app/view-actions/DeletePageConfirm';
import DeleteSpaceConfirm from '@/components/app/view-actions/DeleteSpaceConfirm';
import RenameModal from '@/components/app/view-actions/RenameModal';

type CreateSpaceModalType = (typeof import('@/components/app/view-actions/CreateSpaceModal'))['default'];
type ManageSpaceType = (typeof import('@/components/app/view-actions/ManageSpace'))['default'];

const SPACE_DIALOG_LOAD_ERROR = 'Unable to load the space dialog. Please try again.';

function SpaceDialogLoading({
  onClose,
  testId,
}: {
  onClose: () => void;
  testId: 'create-space-loading' | 'manage-space-loading';
}) {
  return (
    <div
      aria-label='Loading space dialog'
      aria-modal='true'
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/50'
      data-testid={testId}
      role='dialog'
    >
      <div className='flex min-w-64 flex-col items-center gap-4 rounded-lg bg-bg-body p-6 shadow-lg'>
        <LoadingDots />
        <span aria-live='polite' className='text-sm text-text-secondary'>
          Loading...
        </span>
        <button
          className='rounded-md border border-border-primary px-4 py-2 text-sm text-text-primary'
          data-testid={`${testId}-cancel`}
          onClick={onClose}
          type='button'
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AppOverlayProvider ({
  children,
}: {
  children: React.ReactNode;
}) {
  const [renameViewId, setRenameViewId] = useState<string | null>(null);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [manageSpaceId, setManageSpaceId] = useState<string | null>(null);
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = useState(false);
  const [CreateSpaceModal, setCreateSpaceModal] = useState<CreateSpaceModalType | null>(null);
  const [ManageSpace, setManageSpace] = useState<ManageSpaceType | null>(null);
  const [deleteSpaceId, setDeleteSpaceId] = useState<string | null>(null);
  const [blockingLoaderMessage, setBlockingLoaderMessage] = useState<string | null>(null);
  const { updatePage } = useAppOperations();

  const showBlockingLoader = useCallback((message?: string) => {
    setBlockingLoaderMessage(message || 'Loading...');
  }, []);

  const hideBlockingLoader = useCallback(() => {
    setBlockingLoaderMessage(null);
  }, []);
  const openCreateSpaceModal = useCallback(() => {
    setCreateSpaceModalOpen(true);
  }, []);
  const outline = useAppOutline();
  const renameView = useMemo(() => {
    if (!renameViewId) return null;
    if (!outline) return null;

    return findView(outline, renameViewId);
  }, [outline, renameViewId]);
  const closeRenameModal = useCallback(() => setRenameViewId(null), []);
  const closeDeleteModal = useCallback(() => setDeleteViewId(null), []);
  const closeManageSpaceModal = useCallback(() => setManageSpaceId(null), []);
  const closeCreateSpaceModal = useCallback(() => setCreateSpaceModalOpen(false), []);
  const closeDeleteSpaceModal = useCallback(() => setDeleteSpaceId(null), []);

  useEffect(() => {
    if (!manageSpaceId || ManageSpace) return;
    let cancelled = false;

    void import('@/components/app/view-actions/ManageSpace')
      .then((module) => {
        if (!cancelled) setManageSpace(() => module.default);
      })
      .catch(() => {
        if (cancelled) return;
        notify.error(SPACE_DIALOG_LOAD_ERROR);
        closeManageSpaceModal();
      });

    return () => {
      cancelled = true;
    };
  }, [ManageSpace, closeManageSpaceModal, manageSpaceId]);

  useEffect(() => {
    if (!createSpaceModalOpen || CreateSpaceModal) return;
    let cancelled = false;

    void import('@/components/app/view-actions/CreateSpaceModal')
      .then((module) => {
        if (!cancelled) setCreateSpaceModal(() => module.default);
      })
      .catch(() => {
        if (cancelled) return;
        notify.error(SPACE_DIALOG_LOAD_ERROR);
        closeCreateSpaceModal();
      });

    return () => {
      cancelled = true;
    };
  }, [CreateSpaceModal, closeCreateSpaceModal, createSpaceModalOpen]);

  const contextValue = useMemo(
    () => ({
      openRenameModal: setRenameViewId,
      openDeleteModal: setDeleteViewId,
      openManageSpaceModal: setManageSpaceId,
      openCreateSpaceModal,
      openDeleteSpaceModal: setDeleteSpaceId,
      showBlockingLoader,
      hideBlockingLoader,
    }),
    // setState setters (setRenameViewId, setDeleteViewId, setManageSpaceId, setDeleteSpaceId) are
    // guaranteed stable by React and safely omitted from the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCreateSpaceModal, showBlockingLoader, hideBlockingLoader]
  );

  return (
    <AppOverlayContext.Provider value={contextValue}>
      {children}
      {renameViewId && updatePage && renameView && <RenameModal
        updatePage={updatePage}
        view={renameView}
        open={Boolean(renameViewId)}
        onClose={closeRenameModal}
        viewId={renameViewId}
      />}
      {deleteViewId && <DeletePageConfirm
        open={Boolean(deleteViewId)}
        onClose={closeDeleteModal}
        viewId={deleteViewId}
      />}
      {manageSpaceId ? (
        ManageSpace ? (
          <ManageSpace
            open
            onClose={closeManageSpaceModal}
            viewId={manageSpaceId}
          />
        ) : (
          <SpaceDialogLoading onClose={closeManageSpaceModal} testId='manage-space-loading' />
        )
      ) : null}
      {createSpaceModalOpen ? (
        CreateSpaceModal ? (
          <CreateSpaceModal
            onCreated={closeCreateSpaceModal}
            open
            onClose={closeCreateSpaceModal}
          />
        ) : (
          <SpaceDialogLoading onClose={closeCreateSpaceModal} testId='create-space-loading' />
        )
      ) : null}
      {deleteSpaceId && <DeleteSpaceConfirm
        viewId={deleteSpaceId}
        open={Boolean(deleteSpaceId)}
        onClose={closeDeleteSpaceModal}
      />}
      {/* Blocking loader overlay - prevents user interaction during operations like duplicate */}
      {blockingLoaderMessage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
          data-testid="blocking-loader"
        >
          <div className="flex flex-col items-center gap-4 rounded-lg bg-bg-body p-6 shadow-lg">
            <LoadingDots />
            <span className="text-text-title">{blockingLoaderMessage}</span>
          </div>
        </div>
      )}
    </AppOverlayContext.Provider>
  );
}
