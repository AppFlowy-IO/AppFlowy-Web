import { useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/** One toast at a time: a new save replaces the previous one. */
export const SAVED_TOAST_ID = 'dashboard-saved-for-everyone';
export const SAVED_TOAST_DURATION_MS = 5000;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The part of the dashboard's history manager the toast needs. */
export interface SavedToastHistory {
  subscribe: (listener: () => void) => () => void;
  latestUndoGroup: () => object | null;
  undoIfLatest: (group: object) => boolean;
}

export interface SavedToastOptions {
  t: Translate;
  historyManager: SavedToastHistory;
  /** The history group of the save; Undo reverts exactly that step. */
  group: object;
}

let releaseActive: (() => void) | null = null;

function SavedToast({ t, onUndo, onDismiss }: { t: Translate; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    // The Toaster's toast box already has the inverse surface, its padding
    // and shadow; this box covers it exactly, so the measured surface is the
    // toast's own (radius 8, padding 8×16).
    <div
      className='-mx-4 -my-2 flex items-center gap-2 rounded-300 bg-dash-toast-bg px-4 py-2 text-sm text-text-on-fill'
      data-parity-id='dash-saved-toast'
      data-testid='dashboard-saved-toast'
      role='status'
    >
      <span>{t('dashboard.private.saved', { defaultValue: 'Changes saved for everyone.' })}</span>
      <Button
        className='h-auto px-1 py-0 font-semibold text-text-action hover:bg-transparent hover:text-text-action-hover'
        data-testid='dashboard-saved-toast-undo'
        onClick={onUndo}
        size='sm'
        variant='ghost'
      >
        {t('dashboard.private.undo', { defaultValue: 'Undo' })}
      </Button>
    </div>
  );
}

/**
 * "Changes saved for everyone." with an Undo button, for 5 seconds at the
 * bottom centre. Undo reverts the save only while it is still the latest
 * entry of the dashboard's history; any newer entry (or an undo from the
 * keyboard) closes the toast. Escape closes it.
 */
export function showSavedForEveryoneToast({ t, historyManager, group }: SavedToastOptions) {
  releaseActive?.();
  let unsubscribe: (() => void) | null = null;
  const release = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (releaseActive === release) releaseActive = null;
  };

  const dismiss = () => {
    release();
    toast.dismiss(SAVED_TOAST_ID);
  };

  const undo = () => {
    historyManager.undoIfLatest(group);
    dismiss();
  };

  releaseActive = release;
  unsubscribe = historyManager.subscribe(() => {
    if (historyManager.latestUndoGroup() !== group) dismiss();
  });
  toast.custom(() => <SavedToast onDismiss={dismiss} onUndo={undo} t={t} />, {
    id: SAVED_TOAST_ID,
    duration: SAVED_TOAST_DURATION_MS,
    onAutoClose: release,
    onDismiss: release,
  });
}
