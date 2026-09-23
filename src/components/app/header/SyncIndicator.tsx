import { CircularProgress, Tooltip } from '@mui/material';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { getSyncStatus, subscribeSyncStatus } from '@/application/sync-status/store';

const labels = {
  checking: 'Checking sync…',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  error: 'Unable to sync',
};

const descriptions = {
  checking: 'Checking this page with the server.',
  syncing: 'Sending your changes to the server.',
  synced: 'Your changes have been received by the server. Verification and saving run in the background.',
  offline: 'Waiting for a connection. Pending changes will retry automatically.',
  error: 'Some changes could not be saved. Keep this page open and check your connection or storage.',
};

export function SyncIndicator({ viewId }: { viewId?: string }) {
  const { t } = useTranslation();
  const snapshot = useCallback(() => getSyncStatus(viewId ?? ''), [viewId]);
  const status = useSyncExternalStore(subscribeSyncStatus, snapshot, snapshot);
  const busy = status === 'checking' || status === 'syncing';
  // Announce only states that need action; routine syncing would be read on every edit.
  const announce = status === 'error' || status === 'offline';
  const label = t(`syncIndicator.${status}`, { defaultValue: labels[status] });

  if (!viewId) return null;

  return (
    <Tooltip title={t(`syncIndicator.${status}Description`, { defaultValue: descriptions[status] })}>
      <span
        role='status'
        data-testid='sync-indicator'
        data-sync-status={status}
        className='flex items-center gap-1.5 whitespace-nowrap text-xs text-text-caption'
      >
        {busy ? (
          <CircularProgress size={12} color='inherit' />
        ) : (
          <span aria-hidden='true' className={status === 'synced' ? 'text-function-success' : ''}>
            {status === 'synced' ? '✓' : status === 'error' ? '!' : '○'}
          </span>
        )}
        <span aria-hidden='true' className='hidden sm:inline'>
          {label}
        </span>
        {/* role=status is always a polite live region; only its text decides what is announced. */}
        <span className='sr-only' data-testid='sync-indicator-announcement'>
          {announce ? label : ''}
        </span>
      </span>
    </Tooltip>
  );
}
