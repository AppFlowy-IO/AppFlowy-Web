import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';

import {
  changeSyncCounts,
  markSyncDiscovered,
  markSyncReady,
  resetSyncStatus,
  setSyncAlias,
  setSyncConnected,
  setSyncParent,
} from '@/application/sync-status/store';
import { SyncIndicator } from '@/components/app/header/SyncIndicator';

jest.mock('react-i18next', () => {
  const { syncIndicator } = jest.requireActual<{ syncIndicator: Record<string, string> }>(
    '@/@types/translations/en.json'
  );

  return {
    useTranslation: () => ({
      t: (key: string, options: { defaultValue: string }) =>
        syncIndicator[key.replace('syncIndicator.', '')] ?? options.defaultValue,
    }),
  };
});

async function update(action: () => void) {
  await act(async () => {
    action();
  });
}

function advance(milliseconds: number) {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

function expectHidden() {
  expect(screen.queryByTestId('sync-indicator')).toBeNull();
  expect(screen.queryByText('Synced')).toBeNull();
}

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  await update(() => {
    resetSyncStatus();
    setSyncConnected(true);
    markSyncDiscovered();
    markSyncReady('page');
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it('stays hidden when synced, checking, or offline without unsettled edits', async () => {
  render(<SyncIndicator viewId='page' />);
  advance(10_000);
  expectHidden();
  await update(resetSyncStatus);
  advance(10_000);
  expectHidden();
  await update(() => setSyncConnected(false));
  advance(10_000);
  expectHidden();
  expect(jest.getTimerCount()).toBe(0);
});

it('shows the shared AppFlowy loading dots after three seconds, with Syncing on hover', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(2_999);
  expectHidden();
  advance(1);
  const indicator = screen.getByRole('status', { name: 'Syncing' });

  expect(indicator.getAttribute('data-sync-status')).toBe('syncing');
  expect(indicator.querySelector('[aria-hidden="true"] [style]')?.getAttribute('style')).toContain('dots-loading');
  expect(indicator.textContent).toBe('');
  expect(indicator.getAttribute('aria-live')).toBe('off');
  expect(indicator.tabIndex).toBe(0);
  expect(screen.getByTestId('sync-indicator-announcement').textContent).toBe('');
  fireEvent.mouseOver(indicator);
  advance(100);
  expect(screen.getByRole('tooltip').textContent).toBe('Syncing');
});

it('never flashes for an edit accepted just before the delay expires', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(2_999);
  await update(() => changeSyncCounts('page', 0, 1));
  advance(120_000);
  expectHidden();
  expect(jest.getTimerCount()).toBe(0);
});

it('hides immediately on acceptance while the recovery payload awaits a Worker snapshot', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(3_000);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
  advance(120_000);
  expectHidden();
  await update(() => changeSyncCounts('page', -1, -1));
  expectHidden();
});

it('keeps one deadline while typing continues and later receipts leave an earlier update missing', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(2_000);
  await update(() => {
    changeSyncCounts('page', 30, 30);
    changeSyncCounts('other-page', 1, 0);
  });
  expect(jest.getTimerCount()).toBe(1);
  advance(999);
  expectHidden();
  advance(1);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  await update(() => changeSyncCounts('page', -30, -30));
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
});

it('starts a fresh delay for each new unsynced period', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(3_000);
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
  await update(() => changeSyncCounts('page', 1, 0));
  expectHidden();
  advance(2_999);
  expectHidden();
  advance(1);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
});

it('restarts the delay when an accepted edit requires resync', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 1));
  advance(10_000);
  expectHidden();
  await update(() => changeSyncCounts('page', 0, -1));
  advance(2_999);
  expectHidden();
  advance(1);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
});

it('preserves the pending delay across disconnect and reconnect', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(1_000);
  await update(() => setSyncConnected(false));
  advance(1_999);
  expectHidden();
  advance(1);
  const indicator = screen.getByRole('status', { name: 'Offline' });

  expect(indicator.getAttribute('aria-live')).toBe('polite');
  expect(screen.getByTestId('sync-indicator-announcement').textContent).toBe('Offline');
  fireEvent.mouseOver(indicator);
  advance(100);
  expect(screen.getByRole('tooltip').textContent).toContain('Pending changes will retry automatically.');
  await update(() => setSyncConnected(true));
  expect(screen.getByRole('status', { name: 'Syncing' })).toBe(indicator);
  expect(screen.getByRole('tooltip').textContent).toBe('Syncing');
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('times offline edits from the edit, not from the earlier connection loss', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => setSyncConnected(false));
  advance(20_000);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(2_999);
  expectHidden();
  advance(1);
  expect(screen.getByRole('status', { name: 'Offline' })).toBeTruthy();
  await update(() => changeSyncCounts('page', 0, 1));
  expectHidden();
});

it('keeps failed edits visible with an actionable tooltip until recovery', async () => {
  render(<SyncIndicator viewId='page' />);
  await update(() => changeSyncCounts('page', 1, 0));
  advance(2_000);
  await update(() => changeSyncCounts('page', 0, 0, 1));
  advance(999);
  expectHidden();
  advance(1);
  const indicator = screen.getByRole('status', { name: 'Unable to sync' });

  expect(screen.getByTestId('sync-indicator-announcement').textContent).toBe('Unable to sync');
  fireEvent.mouseOver(indicator);
  advance(100);
  expect(screen.getByRole('tooltip').textContent).toContain('Keep this page open');
  await update(() => changeSyncCounts('page', 0, 1));
  expect(screen.getByRole('status', { name: 'Unable to sync' })).toBe(indicator);
  await update(() => changeSyncCounts('page', -1, -1, -1));
  expectHidden();
});

it('cancels the previous page delay and visible dots on navigation', async () => {
  const { rerender } = render(<SyncIndicator viewId='page' />);

  await update(() => {
    changeSyncCounts('page', 1, 0);
    changeSyncCounts('other-page', 1, 0);
  });
  advance(3_000);
  expect(screen.getByRole('status')).toBeTruthy();
  rerender(<SyncIndicator viewId='other-page' />);
  expectHidden();
  advance(2_999);
  expectHidden();
  advance(1);
  expect(screen.getByRole('status')).toBeTruthy();
  rerender(<SyncIndicator viewId='clean-page' />);
  expectHidden();
  expect(jest.getTimerCount()).toBe(0);
  rerender(<SyncIndicator viewId='page' />);
  advance(1_000);
  rerender(<SyncIndicator viewId='clean-page' />);
  advance(3_000);
  expectHidden();
});

it('follows database aliases and row-document edits and hides without a view', async () => {
  const { rerender } = render(<SyncIndicator />);

  expectHidden();
  await update(() => {
    setSyncAlias('view', 'database');
    setSyncParent('row', 'database');
    setSyncParent('row-document', 'row');
    changeSyncCounts('row-document', 1, 0);
  });
  advance(3_000);
  expectHidden();
  rerender(<SyncIndicator viewId='view' />);
  advance(3_000);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  rerender(<SyncIndicator />);
  expectHidden();
  rerender(<SyncIndicator viewId='row' />);
  advance(3_000);
  expect(screen.getByRole('status', { name: 'Syncing' })).toBeTruthy();
  await update(() => changeSyncCounts('row-document', 0, 1));
  expectHidden();
});

it('cleans up the only timer on unmount, including Strict Mode effect replay', async () => {
  const { unmount } = render(
    <StrictMode>
      <SyncIndicator viewId='page' />
    </StrictMode>
  );

  await update(() => changeSyncCounts('page', 1, 0));
  expect(jest.getTimerCount()).toBe(1);
  advance(1_000);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
  advance(3_000);
  expectHidden();
});
