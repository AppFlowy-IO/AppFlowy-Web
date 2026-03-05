import React, { useCallback, useMemo, useState } from 'react';

import LoadingDots from '@/components/_shared/LoadingDots';
import { findView } from '@/components/_shared/outline/utils';
import { AppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppHandlers, useAppOutline } from '@/components/app/app.hooks';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';
import DeletePageConfirm from '@/components/app/view-actions/DeletePageConfirm';
import DeleteSpaceConfirm from '@/components/app/view-actions/DeleteSpaceConfirm';
import ManageSpace from '@/components/app/view-actions/ManageSpace';
import RenameModal from '@/components/app/view-actions/RenameModal';

export function AppOverlayProvider ({
  children,
}: {
  children: React.ReactNode;
}) {
  const [renameViewId, setRenameViewId] = useState<string | null>(null);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [manageSpaceId, setManageSpaceId] = useState<string | null>(null);
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = useState(false);
  const [deleteSpaceId, setDeleteSpaceId] = useState<string | null>(null);
  const [blockingLoaderMessage, setBlockingLoaderMessage] = useState<string | null>(null);
  const { updatePage } = useAppHandlers();

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
      {manageSpaceId && <ManageSpace
        open={Boolean(manageSpaceId)}
        onClose={closeManageSpaceModal}
        viewId={manageSpaceId}
      />}
      {createSpaceModalOpen && <CreateSpaceModal
        onCreated={closeCreateSpaceModal}
        open={createSpaceModalOpen}
        onClose={closeCreateSpaceModal}
      />}
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
