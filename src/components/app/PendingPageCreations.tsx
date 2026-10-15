import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AtomicCreationPendingError,
  AtomicCreationRecord,
  captureAtomicCreationOwner,
  getAtomicCreationActivityRevision,
  isAtomicCreationInFlight,
  listPendingAtomicCreationsForCurrentUser,
  subscribeAtomicCreationActivity,
} from '@/application/atomic-creation';
import { recoverDefaultPage } from '@/application/services/js-services/http/page-default-creation';
import {
  useAppOperations,
  useCurrentWorkspaceIdOptional,
  useEnsureViewVisibleInOutline,
} from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/utils/errors';
import { Log } from '@/utils/log';

/** A pending command belongs to the workspace, so closing its originating dialog does not lose retry. */
export function PendingPageCreations() {
  const workspaceId = useCurrentWorkspaceIdOptional();
  const ensureVisible = useEnsureViewVisibleInOutline();
  const { toView } = useAppOperations();
  const { t } = useTranslation();
  const lifetime = useRef(0);
  const [recovering, setRecovering] = useState<string>();
  const revision = useSyncExternalStore(subscribeAtomicCreationActivity, getAtomicCreationActivityRevision);

  useEffect(
    () => () => {
      lifetime.current += 1;
    },
    []
  );
  const records = useLiveQuery(
    async () => {
      if (!workspaceId) return [];
      try {
        return (await listPendingAtomicCreationsForCurrentUser(workspaceId)).filter(
          (record) => (record.kind === 'document' || record.kind === 'database') && !isAtomicCreationInFlight(record.id)
        );
      } catch {
        // Auth/sync composition can still be starting. Its activity/session remount owns retry.
        return [];
      }
    },
    [workspaceId, revision],
    []
  );

  const retry = async (record: AtomicCreationRecord) => {
    if (!workspaceId || recovering) return;
    const epoch = lifetime.current;

    setRecovering(record.id);
    try {
      const owner = captureAtomicCreationOwner(workspaceId, () => {
        if (lifetime.current !== epoch) throw new Error('Creation recovery owner changed');
      });
      const page = await recoverDefaultPage(owner, record, {
        activate: async (created) => {
          owner.assertCurrent();
          const ancestors = await ensureVisible?.(created.view_id);

          owner.assertCurrent();
          if (!ancestors?.length) throw new Error('Created page navigation is not ready');
        },
      });

      owner.assertCurrent();
      await toView?.(page.view_id);
    } catch (error) {
      Log.warn('[AtomicCreation] Page recovery remains pending', {
        requestId: record.requestId,
        message: getErrorMessage(error instanceof AtomicCreationPendingError ? error.cause : error),
      });
      // A page the server refused is released (it leaves this list), so say why instead.
      if (lifetime.current === epoch) {
        toast.error(error instanceof AtomicCreationPendingError ? t('atomicCreation.pending') : getErrorMessage(error));
      }
    } finally {
      if (lifetime.current === epoch) setRecovering(undefined);
    }
  };

  if (!records.length) return null;
  return (
    <aside
      aria-label={t('atomicCreation.pending')}
      className='fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2 rounded-lg border border-border-primary bg-background-primary p-3 shadow-lg'
    >
      <p className='text-sm text-text-primary'>{t('atomicCreation.pending')}</p>
      {records.map((record) => (
        <Button key={record.id} variant='outline' size='sm' disabled={!!recovering} onClick={() => void retry(record)}>
          {t('atomicCreation.finishPage')}
        </Button>
      ))}
    </aside>
  );
}
