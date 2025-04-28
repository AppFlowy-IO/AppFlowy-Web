import { createContext, useContext } from 'react';

export const AppOverlayContext = createContext<{
  openRenameModal: (viewId: string) => void;
  openDeleteModal: (viewId: string) => void;
  openManageSpaceModal: (viewId: string) => void;
  openCreateSpaceModal: () => void;
  openDeleteSpaceModal: (viewId: string) => void;
}>({
  openRenameModal: () => {
    //
  },
  openDeleteModal: () => {
    //
  },
  openManageSpaceModal: () => {
    //
  },
  openCreateSpaceModal: () => {
    //
  },
  openDeleteSpaceModal: () => {
    //
  },
});

export function useAppOverlayContext () {
  const context = useContext(AppOverlayContext);

  if (!context) {
    throw new Error('useAppOverlayContext must be used within an AppOverlayProvider');
  }

  return context;
}