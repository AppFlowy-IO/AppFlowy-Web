import React, { useContext } from 'react';

import { QuickNote } from '@/application/types';
import { QuickNoteService } from '@/application/services/domains';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';

type ToastContextType = {
  onOpen: (message: string) => void;
  onClose: () => void;
  open: boolean;
};

export const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export const LISI_LIMIT = 100;

export function useToastContext() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToastContext must be used within a ToastContext.Provider');
  }

  return context;
}

export function useAddNode({
  onEnterNote,
  onAdd,
}: {
  onEnterNote: (node: QuickNote) => void;
  onAdd: (note: QuickNote) => void;
}) {
  const toast = useToastContext();

  const [loading, setLoading] = React.useState(false);
  const currentWorkspaceId = useCurrentWorkspaceId();

  const handleAdd = async () => {
    if (!currentWorkspaceId || loading) return;
    setLoading(true);
    try {
      const note = await QuickNoteService.create(currentWorkspaceId, [{
        type: 'paragraph',
        delta: [{ insert: '' }],
        children: [],
      }]);

      onEnterNote(note);
      onAdd(note);
      // eslint-disable-next-line
    } catch (e: any) {
      console.error(e);
      toast.onOpen(e.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    handleAdd,
    loading,
  };
}
