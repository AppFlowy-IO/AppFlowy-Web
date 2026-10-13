import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { db, deleteCollabDB, getCachedProviderDoc } from '@/application/db';
import { discardPermissionBlockedEdits, retryPermissionBlockedSync } from '@/application/sync-outbox';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';

type PendingEdits = {
  /** Objects with edits waiting for edit access. */
  blocked: string[];
  /** Objects with edits queued for upload (not waiting for access). */
  queued: string[];
};

const NO_PENDING_EDITS: PendingEdits = { blocked: [], queued: [] };

function dismissalStorageKey(serverUrl: string, userId: string, workspaceId: string) {
  return `af_pending_edits_dismissed:${JSON.stringify([serverUrl, userId, workspaceId])}`;
}

function readDismissed(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');

    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(key: string, ids: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // Dismissal is a convenience; the notice simply returns on the next render.
  }
}

/**
 * Edits made without current edit access stay on this device until the user
 * chooses Try again (sent only if access is current) or Discard changes.
 * Dismissing hides the notice for the pages it listed until another page's
 * edits start waiting.
 */
export function PendingPermissionEdits({
  userId,
  workspaceId,
  serverUrl,
  beforeRetry,
  reloadPage = () => window.location.reload(),
}: {
  userId: string;
  workspaceId: string;
  serverUrl: string;
  /** Drops cached permission verdicts so Try again checks access afresh. */
  beforeRetry: () => void;
  reloadPage?: () => void;
}) {
  const { t } = useTranslation();
  const messageId = useId();
  const session = useMemo(() => ({ userId, workspaceId, serverUrl }), [userId, workspaceId, serverUrl]);
  const storageKey = dismissalStorageKey(serverUrl, userId, workspaceId);
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));
  // Released by Try again but not yet uploaded by the socket owner.
  const [released, setReleased] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<'retry' | 'discard' | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const pending = useLiveQuery(async (): Promise<PendingEdits> => {
    const blocked = new Set<string>();
    const queued = new Set<string>();

    await db.sync_outbox.where('[userId+workspaceId]').equals([userId, workspaceId]).each((record) => {
      if (record.serverUrl !== serverUrl) return;
      (record.permissionBlocked ? blocked : queued).add(record.objectId);
    });
    return { blocked: Array.from(blocked).sort(), queued: Array.from(queued).sort() };
  }, [userId, workspaceId, serverUrl], NO_PENDING_EDITS);

  const blockedIds = new Set(pending.blocked);
  const saving = pending.queued.filter((id) => released.has(id) && !blockedIds.has(id));
  const showBlocked = pending.blocked.some((id) => !dismissed.has(id));
  const showSaving = !showBlocked && saving.some((id) => !dismissed.has(id));

  const dismiss = () => {
    const next = new Set([...dismissed, ...pending.blocked, ...saving]);

    setDismissed(next);
    writeDismissed(storageKey, next);
  };

  const retry = async () => {
    setBusy('retry');
    beforeRetry();
    try {
      const result = await retryPermissionBlockedSync(session);

      if (result.released.length > 0) setReleased((current) => new Set([...current, ...result.released]));
      if (result.denied.length > 0) {
        toast.error(t('workspacePermissions.pendingEditsStillWaiting', { count: result.denied.length }));
      } else if (result.unknown.length > 0 || result.released.length === 0) {
        toast.error(t('workspacePermissions.pendingEditsRetryError'));
      } else {
        toast.success(t('workspacePermissions.pendingEditsSent'));
      }
    } catch {
      toast.error(t('workspacePermissions.pendingEditsRetryError'));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy('discard');
    try {
      const discarded = await discardPermissionBlockedEdits(session);
      // The local copy still contains these edits. Reset it so they can never be
      // reconstructed and sent later; an open page reloads from the server.
      const open = discarded.some((id) => getCachedProviderDoc(id));

      await Promise.all(discarded.map((id) => deleteCollabDB(id, { destroyDoc: false }).catch(() => false)));
      setConfirmingDiscard(false);
      toast.success(t('workspacePermissions.pendingEditsDiscarded'));
      if (open) reloadPage();
    } catch {
      toast.error(t('workspacePermissions.pendingEditsDiscardError'));
    } finally {
      setBusy(null);
    }
  };

  if (!showBlocked && !showSaving && !confirmingDiscard) return null;

  return (
    <>
      {(showBlocked || showSaving) && (
        <section
          aria-labelledby={messageId}
          data-testid='pending-permission-edits'
          className='fixed bottom-24 right-6 z-30 flex w-[320px] max-w-[calc(100vw-3rem)] flex-col gap-3 rounded-400 border border-border-primary bg-surface-primary p-4 shadow-toast'
        >
          <div className='flex items-start gap-2'>
            <p id={messageId} role='status' aria-live='polite' className='flex-1 text-sm font-medium text-text-primary'>
              {showBlocked
                ? t('workspacePermissions.pendingEdits', { count: pending.blocked.length })
                : t('workspacePermissions.pendingEditsSaving')}
            </p>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('workspacePermissions.pendingEditsDismiss')}
              onClick={dismiss}
            >
              <CloseIcon aria-hidden='true' className='h-4 w-4' />
            </Button>
          </div>
          {showBlocked && (
            <>
              <p className='text-xs text-text-secondary'>{t('workspacePermissions.pendingEditsDescription')}</p>
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' loading={busy === 'retry'} disabled={busy !== null} onClick={() => void retry()}>
                  {t('workspacePermissions.pendingEditsTryAgain')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  danger
                  disabled={busy !== null}
                  onClick={() => setConfirmingDiscard(true)}
                >
                  {t('workspacePermissions.pendingEditsDiscard')}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      <AlertDialog
        open={confirmingDiscard}
        onOpenChange={(open) => {
          if (!open && busy !== 'discard') setConfirmingDiscard(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workspacePermissions.pendingEditsDiscardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workspacePermissions.pendingEditsDiscardDescription', { count: pending.blocked.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'discard'}>{t('button.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={busy === 'discard'}
              onClick={(event) => {
                event.preventDefault();
                void discard();
              }}
            >
              {t('workspacePermissions.pendingEditsDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
