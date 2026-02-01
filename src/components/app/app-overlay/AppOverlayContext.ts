import { createContext, useContext } from 'react';

export const AppOverlayContext = createContext<{
  openRenameModal: (viewId: string) => void;
  openDeleteModal: (viewId: string) => void;
  openManageSpaceModal: (viewId: string) => void;
  openCreateSpaceModal: () => void;
  openDeleteSpaceModal: (viewId: string) => void;
  /**
   * Show a blocking loading overlay that prevents user interaction.
   * Used during operations like duplicate to prevent opening incomplete pages.
   */
  showBlockingLoader: (message?: string) => void;
  /**
   * Hide the blocking loading overlay.
   */
  hideBlockingLoader: () => void;
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
  showBlockingLoader: () => {
    //
  },
  hideBlockingLoader: () => {
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