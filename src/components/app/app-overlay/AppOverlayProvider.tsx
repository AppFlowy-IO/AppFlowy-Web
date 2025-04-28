import { findView } from '@/components/_shared/outline/utils';
import { AppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppHandlers, useAppOutline } from '@/components/app/app.hooks';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';
import DeletePageConfirm from '@/components/app/view-actions/DeletePageConfirm';
import DeleteSpaceConfirm from '@/components/app/view-actions/DeleteSpaceConfirm';
import ManageSpace from '@/components/app/view-actions/ManageSpace';
import RenameModal from '@/components/app/view-actions/RenameModal';
import React, { useMemo, useState } from 'react';

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
  const { updatePage } = useAppHandlers();
  const outline = useAppOutline();
  const renameView = useMemo(() => {
    if (!renameViewId) return null;
    if (!outline) return null;

    return findView(outline, renameViewId);
  }, [outline, renameViewId]);

  return (
    <AppOverlayContext.Provider
      value={{
        openRenameModal: setRenameViewId,
        openDeleteModal: setDeleteViewId,
        openManageSpaceModal: setManageSpaceId,
        openCreateSpaceModal: () => {
          setCreateSpaceModalOpen(true);
        },
        openDeleteSpaceModal: setDeleteSpaceId,
      }}
    >
      {children}
      {renameViewId && updatePage && renameView && <RenameModal
        updatePage={updatePage}
        view={renameView}
        open={Boolean(renameViewId)}
        onClose={() => {
          setRenameViewId(null);
        }}
        viewId={renameViewId}
      />}
      {deleteViewId && <DeletePageConfirm
        open={Boolean(deleteViewId)}
        onClose={() => {
          setDeleteViewId(null);
        }}
        viewId={deleteViewId}
      />}
      {manageSpaceId && <ManageSpace
        open={Boolean(manageSpaceId)}
        onClose={() => {
          setManageSpaceId(null);
        }}
        viewId={manageSpaceId}
      />}
      {createSpaceModalOpen && <CreateSpaceModal
        onCreated={() => {
          setCreateSpaceModalOpen(false);
        }}
        open={createSpaceModalOpen}
        onClose={() => setCreateSpaceModalOpen(false)}
      />}
      {deleteSpaceId && <DeleteSpaceConfirm
        viewId={deleteSpaceId}
        open={Boolean(deleteSpaceId)}
        onClose={
          () => {
            setDeleteSpaceId(null);
          }
        }
      />}
    </AppOverlayContext.Provider>
  );
}