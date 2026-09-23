import { act, render, screen } from '@testing-library/react';

import {
  changeSyncCounts,
  markSyncDiscovered,
  markSyncReady,
  resetSyncStatus,
  setSyncAlias,
  setSyncConnected,
} from '@/application/sync-status/store';
import { SyncIndicator } from '@/components/app/header/SyncIndicator';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}));

beforeEach(() => resetSyncStatus());

it('shows synced on server acceptance without waiting for a Worker snapshot', async () => {
  render(<SyncIndicator viewId='page' />);
  const indicator = screen.getByRole('status');
  const expectStatus = (status: string, label: string) => {
    expect(indicator.getAttribute('data-sync-status')).toBe(status);
    expect(indicator.textContent).toContain(label);
    expect(screen.getByTestId('sync-indicator-announcement').textContent).toBe(
      status === 'error' || status === 'offline' ? label : ''
    );
  };

  expectStatus('offline', 'Offline');
  await act(async () => {
    setSyncConnected(true);
  });
  expectStatus('checking', 'Checking sync');
  expect(screen.getByRole('progressbar')).toBeTruthy();
  await act(async () => {
    changeSyncCounts('page', 1, 0);
  });
  expectStatus('syncing', 'Syncing');
  await act(async () => {
    markSyncDiscovered();
    markSyncReady('page');
    changeSyncCounts('page', 0, 1);
  });
  expectStatus('synced', 'Synced');
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(indicator.textContent).toContain('✓');
  expect(indicator.getAttribute('aria-label')).toBe(
    'Your changes have been received by the server. Verification and saving run in the background.'
  );
  await act(async () => {
    changeSyncCounts('page', 0, 0, 1);
  });
  expectStatus('error', 'Unable to sync');
  expect(screen.queryByRole('progressbar')).toBeNull();
  await act(async () => {
    changeSyncCounts('page', -1, -1, -1);
    markSyncDiscovered();
    markSyncReady('page');
  });
  expectStatus('synced', 'Synced');
  expect(indicator.textContent).toContain('✓');
});

it('follows view changes and canonical database aliases and hides without a view', async () => {
  const { rerender } = render(<SyncIndicator />);

  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => {
    setSyncConnected(true);
    markSyncDiscovered();
    markSyncReady('database');
    setSyncAlias('view', 'database');
  });
  rerender(<SyncIndicator viewId='view' />);
  expect(screen.getByRole('status').getAttribute('data-sync-status')).toBe('synced');
  await act(async () => {
    changeSyncCounts('database', 1, 0);
  });
  expect(screen.getByRole('status').getAttribute('data-sync-status')).toBe('syncing');
  rerender(<SyncIndicator viewId='other-page' />);
  expect(screen.getByRole('status').getAttribute('data-sync-status')).toBe('checking');
});
