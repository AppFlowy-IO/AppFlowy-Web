import { Tooltip } from '@mui/material';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { getPendingSyncStatus, subscribeSyncStatus } from '@/application/sync-status/store';
import LoadingDots from '@/components/_shared/LoadingDots';

const labels = {
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Unable to sync',
};

const descriptions = {
  offline: 'Waiting for a connection. Pending changes will retry automatically.',
  error: 'Some changes could not be saved. Keep this page open and check your connection or storage.',
};

export function SyncIndicator({ viewId }: { viewId?: string }) {
  const snapshot = useCallback(() => getPendingSyncStatus(viewId ?? ''), [viewId]);
  const status = useSyncExternalStore(subscribeSyncStatus, snapshot, snapshot);

  // Unmounting cancels the delay on acceptance; the key prevents it leaking across page navigation.
  return viewId && status ? <PendingSyncIndicator key={viewId} status={status} /> : null;
}

function PendingSyncIndicator({ status }: { status: NonNullable<ReturnType<typeof getPendingSyncStatus>> }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // One timer per uninterrupted wait, independent of edits, receipts, or connection transitions.
    const timer = setTimeout(() => setVisible(true), 3_000);

    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const announce = status !== 'syncing';
  const label = t(`syncIndicator.${status}`, { defaultValue: labels[status] });
  const tooltip =
    status === 'syncing' ? label : t(`syncIndicator.${status}Description`, { defaultValue: descriptions[status] });

  return (
    <Tooltip title={tooltip}>
      <div
        role='status'
        aria-label={label}
        aria-live={announce ? 'polite' : 'off'}
        tabIndex={0}
        data-testid='sync-indicator'
        data-sync-status={status}
        className='flex h-6 w-6 items-center justify-center'
      >
        <div aria-hidden='true'>
          <LoadingDots size={14} className='motion-reduce:[&>div]:!animate-none' />
        </div>
        {/* Routine syncing has an accessible name without being announced on every edit. */}
        <span className='sr-only' data-testid='sync-indicator-announcement'>
          {announce ? label : ''}
        </span>
      </div>
    </Tooltip>
  );
}
