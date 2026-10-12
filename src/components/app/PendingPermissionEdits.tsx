import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { db, hasUnscopedCollabData } from '@/application/db';
import { retryPermissionBlockedSync } from '@/application/sync-outbox';

/** Access loss keeps recoverable bytes separate from automatic synchronization. */
export function PendingPermissionEdits({ userId, workspaceId, serverUrl, beforeRetry }: {
  userId: string;
  workspaceId: string;
  serverUrl: string;
  beforeRetry: () => void;
}) {
  const { t } = useTranslation();
  const [legacyStorage, setLegacyStorage] = useState(false);

  useEffect(() => {
    let active = true;

    void hasUnscopedCollabData().then((found) => { if (active) setLegacyStorage(found); }).catch(() => undefined);
    return () => { active = false; };
  }, [userId, workspaceId, serverUrl]);
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useLiveQuery(async () => {
    const objects = new Set<string>();
    const legacy = new Set<string>();

    await db.sync_outbox.where('[userId+workspaceId]').equals([userId, workspaceId]).each((record) => {
      if (record.serverUrl === serverUrl && record.permissionBlocked) objects.add(record.objectId);
      if (record.serverUrl === undefined) legacy.add(record.objectId);
    });
    return { blocked: objects.size, legacy: legacy.size };
  }, [userId, workspaceId, serverUrl], { blocked: 0, legacy: 0 });

  if (!pending.blocked && !pending.legacy && !legacyStorage) return null;
  const retry = async () => {
    setRetrying(true);
    setFailed(false);
    beforeRetry();
    try { await retryPermissionBlockedSync({ userId, workspaceId, serverUrl }); } catch { setFailed(true); }
    finally { setRetrying(false); }
  };

  return <div role='status' className='fixed bottom-4 right-4 z-[1500] max-w-sm rounded-lg border border-line-border bg-bg-body p-4 shadow-lg'>
    {pending.blocked > 0 && <>
      <p>{t('workspacePermissions.pendingEdits', { count: pending.blocked })}</p>
      <p className='mt-2 text-sm text-text-secondary'>{t('workspacePermissions.pendingEditsDescription')}</p>
    </>}
    {(pending.legacy > 0 || legacyStorage) && <p>{t('workspacePermissions.legacyPendingEdits')}</p>}
    {failed && <p role='alert'>{t('workspacePermissions.pendingEditsRetryError')}</p>}
    {pending.blocked > 0 && <button type='button' disabled={retrying} onClick={() => void retry()} className='mt-3 rounded border px-3 py-1'>
      {t(retrying ? 'workspacePermissions.loading' : 'workspacePermissions.retryPendingEdits')}
    </button>}
  </div>;
}
