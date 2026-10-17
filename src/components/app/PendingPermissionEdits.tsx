import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { db, deleteCollabDB, hasCollabDocInMemory } from '@/application/db';
import { SyncOutboxRecord } from '@/application/db/tables/sync_outbox';
import {
  discardPermissionBlockedEdits,
  retryPermissionBlockedSync,
  settleDiscardedEdits,
  subscribeDiscardedEdits,
} from '@/application/sync-outbox';
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
  /** Objects of `released` with edits queued for upload (not waiting for access). */
  queued: string[];
  /** The released objects this result looked for. */
  released: ReadonlySet<string>;
};

type PendingEditsScope = { userId: string; workspaceId: string; serverUrl: string };

/** One query's findings, which the next query of the same scope builds on. */
type PendingEditsQuery = {
  scope: string;
  /** The scope's durable denials, as object and revision. */
  denials: string;
  edits: PendingEdits;
};

const NOTHING_RELEASED: ReadonlySet<string> = new Set();
const NO_PENDING_EDITS: PendingEdits = { blocked: [], queued: [], released: NOTHING_RELEASED };

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * A row is flagged as waiting only in a transaction that finds its object's
 * durable denial (sync_permission_blocks). So after a first read of every row,
 * only the rows of denied objects, of objects already waiting (a release keeps
 * the flags of rows written while its access check ran) and of released
 * objects are read, and ordinary edits elsewhere never re-run the live query.
 * Every row is read again whenever the denials change, as another denial may
 * have come and gone since the last query (a tab that was frozen).
 */
async function queryPendingEdits(
  { userId, workspaceId, serverUrl }: PendingEditsScope,
  released: ReadonlySet<string>,
  last: PendingEditsQuery | undefined
): Promise<PendingEditsQuery> {
  const scope = JSON.stringify([serverUrl, userId, workspaceId]);
  const previous = last?.scope === scope ? last : undefined;

  return db.transaction('r', db.sync_outbox, db.sync_permission_blocks, async () => {
    const blocks = await db.sync_permission_blocks
      .where('[serverUrl+userId+workspaceId]')
      .equals([serverUrl, userId, workspaceId])
      .toArray();
    const denials = blocks.map((block) => `${block.objectId}:${block.revision}`).join();
    const blocked = new Set<string>();
    const queued = new Set<string>();
    const collect = (record: SyncOutboxRecord) => {
      if (record.serverUrl !== serverUrl) return;
      if (record.permissionBlocked) blocked.add(record.objectId);
      else if (released.has(record.objectId)) queued.add(record.objectId);
    };

    if (!previous || previous.denials !== denials) {
      await db.sync_outbox.where('[userId+workspaceId]').equals([userId, workspaceId]).each(collect);
    } else {
      const watched = new Set([...blocks.map((block) => block.objectId), ...previous.edits.blocked, ...released]);

      await Promise.all(
        Array.from(watched, (objectId) =>
          db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, objectId]).each(collect)
        )
      );
    }

    const edits = { blocked: Array.from(blocked).sort(), queued: Array.from(queued).sort(), released };
    const shown = previous?.edits ?? NO_PENDING_EDITS;
    const unchanged =
      shown.released === released && sameIds(edits.blocked, shown.blocked) && sameIds(edits.queued, shown.queued);

    // The same object when nothing changed, so the notice does not re-render.
    return { scope, denials, edits: unchanged ? shown : edits };
  });
}

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
  const [released, setReleased] = useState<ReadonlySet<string>>(NOTHING_RELEASED);
  const [busy, setBusy] = useState<'retry' | 'discard' | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const lastQueryRef = useRef<PendingEditsQuery>();
  const queryRunRef = useRef(0);
  const pending = useLiveQuery(async (): Promise<PendingEdits> => {
    const run = ++queryRunRef.current;
    const query = await queryPendingEdits(session, released, lastQueryRef.current);

    // A run superseded by a newer one is dropped by the live query; so is its state.
    if (run === queryRunRef.current) lastQueryRef.current = query;
    return query.edits;
  }, [session, released], NO_PENDING_EDITS);

  const reloadPageRef = useRef(reloadPage);
  const reloadingRef = useRef(false);
  // This tab's own discard reloads or settles once all of it is deleted.
  const discardingRef = useRef(false);

  reloadPageRef.current = reloadPage;

  // Discarded edits must not come back from a copy this tab still holds in
  // memory (a manifest reply after a reconnect, a full sync). Whichever tab
  // discarded them, this tab reloads the affected pages from the server, or
  // settles the discard when it holds none of them; until then the outbox
  // refuses those pages.
  useEffect(() => subscribeDiscardedEdits(session, (objectIds) => {
    if (reloadingRef.current || discardingRef.current) return;
    const held = objectIds.filter((id) => hasCollabDocInMemory(id));

    if (held.length === 0) {
      settleDiscardedEdits(session, objectIds);
      return;
    }

    reloadingRef.current = true;
    // Without the local copy the reloaded tab opens these pages from the server.
    void Promise.all(held.map((id) => deleteCollabDB(id, { destroyDoc: false }).catch(() => false)))
      .finally(() => reloadPageRef.current());
  }), [session]);

  // A released page leaves `released` once none of its edits are queued or
  // waiting any more (they were uploaded or discarded), so its later ordinary
  // edits never show the saving notice. Until the live query sees the release,
  // the page still counts as waiting and is kept. Only a result read for the
  // current `released` has looked for the queued edits of its pages.
  useEffect(() => {
    if (pending.released !== released) return;
    const present = new Set([...pending.blocked, ...pending.queued]);

    if (Array.from(released).some((id) => !present.has(id))) {
      setReleased(new Set(Array.from(released).filter((id) => present.has(id))));
    }
  }, [pending, released]);

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
    discardingRef.current = true;
    try {
      const discarded = await discardPermissionBlockedEdits(session);
      // The local copy still contains these edits. Reset it so they can never be
      // reconstructed and sent later; a page held in memory reloads from the
      // server. Other tabs do the same when they see the discard.
      const held = discarded.filter((id) => hasCollabDocInMemory(id));

      await Promise.all(discarded.map((id) => deleteCollabDB(id, { destroyDoc: false }).catch(() => false)));
      setConfirmingDiscard(false);
      toast.success(t('workspacePermissions.pendingEditsDiscarded'));
      if (held.length > 0) {
        reloadingRef.current = true;
        reloadPage();
      } else {
        settleDiscardedEdits(session, discarded);
      }
    } catch {
      toast.error(t('workspacePermissions.pendingEditsDiscardError'));
    } finally {
      discardingRef.current = false;
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
