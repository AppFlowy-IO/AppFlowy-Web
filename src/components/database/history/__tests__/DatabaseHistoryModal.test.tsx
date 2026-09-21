// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { format } from 'date-fns';
import * as Y from 'yjs';

import { getDatabaseHistory, getDatabaseRestoreJob, startDatabaseRestore } from '@/application/services/domains/database-history';

import DatabaseHistoryModal from '../DatabaseHistoryModal';
import { loadDatabaseHistoryPreview } from '../databaseHistoryPreviewSession';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}));
jest.mock('@/application/services/domains/database-history', () => ({
  getDatabaseHistory: jest.fn(), getDatabaseRestoreJob: jest.fn(), startDatabaseRestore: jest.fn(), DATABASE_HISTORY_PAGE_SIZE: 30,
}));
jest.mock('@/application/services/js-services/http/cloud-config', () => ({ defaultConfig: { baseURL: 'server' } }));
jest.mock('../databaseHistoryPreviewSession', () => ({ loadDatabaseHistoryPreview: jest.fn() }));
jest.mock('../DatabaseHistoryPreviewProvider', () => ({
  DatabaseHistoryPreview: ({ root }: { root: Y.Doc }) => <div data-testid='historical-preview'>{root.guid}</div>,
}));
const mockStart = jest.fn();
let mockRestoreCompleted = 0;
let mockUseRealRestore = false;

jest.mock('../useDatabaseHistoryRestore', () => ({
  databaseHistoryError: (error: Error) => error.message,
  useDatabaseHistoryRestore: (...args: unknown[]) => mockUseRealRestore
    ? jest.requireActual('../useDatabaseHistoryRestore').useDatabaseHistoryRestore(...args)
    : ({ start: mockStart, completed: mockRestoreCompleted, isRestoring: false, job: null, error: null }),
}));

const records = [1, 2].map((n) => ({
  version: `v${n}`, parent: null, name: `Version ${n}`, created_at: '2026-09-10T00:00:00Z',
  changed_at: `2026-09-10T00:00:00.00000${n}Z`, created_by: null, is_deleted: false,
  row_count: 0, document_count: 0, size_bytes: 0,
}));
const props = {
  open: true, onOpenChange: jest.fn(), workspaceId: 'w', databaseId: 'd', databasePageId: 'page',
  activeViewId: 'tab', userId: 'user', onRestored: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRestoreCompleted = 0;
  mockUseRealRestore = false;
  localStorage.clear();
  jest.mocked(getDatabaseHistory).mockResolvedValue(records);
});

test('renders database metadata without a document-only author filter and confirms whole-database restore', async () => {
  const session = { root: new Y.Doc({ guid: 'historical-root' }), rows: {}, destroy: jest.fn() };

  jest.mocked(loadDatabaseHistoryPreview).mockResolvedValue(session);
  const { unmount } = render(<DatabaseHistoryModal {...props} />);

  await screen.findByTestId('historical-preview');
  expect(screen.queryByText('versionHistory.onlyYours')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('database-history-restore'));
  expect(screen.getByText(/whole database, including shared views, their sidebar entries, and rows/)).toBeInTheDocument();
  expect(mockStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('database-history-confirm-restore'));
  expect(mockStart).toHaveBeenCalledWith('v1');
  unmount();
  expect(session.destroy).toHaveBeenCalledTimes(1);
});

test('destroys an obsolete preview that finishes after another version was selected', async () => {
  const first = { root: new Y.Doc({ guid: 'obsolete' }), rows: {}, destroy: jest.fn() };
  const second = { root: new Y.Doc({ guid: 'selected' }), rows: {}, destroy: jest.fn() };
  let resolveFirst!: (value: typeof first) => void;

  jest.mocked(loadDatabaseHistoryPreview)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(second);
  const { unmount } = render(<DatabaseHistoryModal {...props} />);

  await waitFor(() => expect(loadDatabaseHistoryPreview).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Version 2'));
  await screen.findByText('selected');
  await act(async () => resolveFirst(first));
  expect(first.destroy).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('obsolete')).not.toBeInTheDocument();
  expect(jest.mocked(loadDatabaseHistoryPreview).mock.calls[0][0].signal.aborted).toBe(true);
  unmount();
  expect(second.destroy).toHaveBeenCalledTimes(1);
});

test('shows preview errors without rendering live or incomplete database data', async () => {
  jest.mocked(loadDatabaseHistoryPreview).mockRejectedValue(new Error('Snapshot was pruned'));
  render(<DatabaseHistoryModal {...props} />);
  await screen.findByText('Snapshot was pruned');
  expect(screen.queryByTestId('historical-preview')).not.toBeInTheDocument();
});


test('automatic and recovery versions use saved timestamps as their primary labels', async () => {
  const named = [records[0], records[1], { ...records[1], version: 'v3' }].map((record, index) => ({
    ...record, name: index === 0 ? 'Before restore' : 'Database snapshot',
    created_at: ['2026-09-10T00:00:00Z', '2026-09-09T00:00:00Z', '2026-09-08T00:00:00Z'][index],
  }));

  jest.mocked(getDatabaseHistory).mockResolvedValue(named);
  jest.mocked(loadDatabaseHistoryPreview).mockResolvedValue({ root: new Y.Doc(), rows: {}, destroy: jest.fn() });
  render(<DatabaseHistoryModal {...props} />);
  const versions = await screen.findAllByTestId('database-history-version');

  expect(screen.queryByText('Database snapshot')).not.toBeInTheDocument();
  expect(screen.queryByText('Before restore')).not.toBeInTheDocument();
  versions.forEach((version, index) => {
    expect(version.querySelector('time')).toHaveAttribute('dateTime', named[index].created_at);
    expect(version.querySelector('time')).toHaveTextContent(format(new Date(named[index].created_at), 'PPpp'));
    expect(version.querySelector('time')?.parentElement).toHaveClass(
      index === 0 ? 'text-text-info' : 'text-text-primary'
    );
  });
});


test('the shared filter menu resets pagination and loads the chosen date range', async () => {
  const page = Array.from({ length: 30 }, (_, index) => ({ ...records[0], version: `v${index}` }));

  jest.mocked(getDatabaseHistory).mockResolvedValue(page);
  jest.mocked(loadDatabaseHistoryPreview).mockResolvedValue({ root: new Y.Doc(), rows: {}, destroy: jest.fn() });
  render(<DatabaseHistoryModal {...props} />);
  fireEvent.click(await screen.findByText('Load older versions'));
  await waitFor(() => expect(getDatabaseHistory).toHaveBeenLastCalledWith('w', 'd', expect.objectContaining({
    cursor: { before_changed_at: page[29].changed_at, before_version: 'v29' },
  })));

  fireEvent.keyDown(screen.getByRole('button', { name: 'Filter versions' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'versionHistory.last7Days' }));
  await waitFor(() => expect(getDatabaseHistory).toHaveBeenLastCalledWith('w', 'd', expect.objectContaining({
    cursor: undefined,
    since: expect.any(Number),
  })));
  const since = jest.mocked(getDatabaseHistory).mock.calls[jest.mocked(getDatabaseHistory).mock.calls.length - 1]?.[2]?.since;

  expect(Math.abs(Number(since) - (Date.now() - 7 * 86_400_000))).toBeLessThan(2000);
  expect(screen.queryByText('versionHistory.onlyYours')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
});

test('empty history disables restore and still allows closing the dialog', async () => {
  jest.mocked(getDatabaseHistory).mockResolvedValue([]);
  render(<DatabaseHistoryModal {...props} />);
  await screen.findByText('No versions available.');
  expect(screen.getByTestId('database-history-restore')).toBeDisabled();
  expect(loadDatabaseHistoryPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
});

test('opening history finishes a saved successful restore without closing the newly opened dialog', async () => {
  mockUseRealRestore = true;
  const storageKey = 'af_database_history_restore:v1:server:user:w:d';

  localStorage.setItem(storageKey, JSON.stringify({
    version: 'v1', idempotencyKey: 'original-key', jobId: 'saved-job', enqueueUncertain: true,
  }));
  jest.mocked(getDatabaseRestoreJob).mockResolvedValue({
    job_id: 'saved-job', workspace_id: 'w', database_id: 'd', target_version: 'v1', state: 'succeeded',
    staged_bytes: 0, staged_rows: 0, created_at: '', updated_at: '', started_at: null, finished_at: null, error: null,
    result: { version: 'v1', pre_restore_version: 'recovery', restored_rows: 0, restored_documents: 0, tombstoned_rows: 0 },
  });
  jest.mocked(loadDatabaseHistoryPreview).mockImplementation(async ({ version }) => ({
    root: new Y.Doc({ guid: version }), rows: {}, destroy: jest.fn(),
  }));
  props.onRestored.mockResolvedValue(undefined);
  render(<DatabaseHistoryModal {...props} />);

  await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  await screen.findByTestId('historical-preview');
  expect(props.onRestored).toHaveBeenCalledWith('d', 'saved-job');
  expect(startDatabaseRestore).not.toHaveBeenCalled();
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByTestId('database-history-restore')).toBeEnabled();
});

test('completed restores close once without previewing the recovery version and reopen on the latest page', async () => {
  const page = Array.from({ length: 30 }, (_, index) => ({ ...records[0], version: `page-${index}` }));
  const older = { ...records[1], version: 'older', name: 'Older version' };
  const recovery = { ...records[0], version: 'recovery', name: 'Before restore' };

  jest.mocked(getDatabaseHistory)
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce([older])
    .mockResolvedValueOnce([recovery, ...records]);
  jest.mocked(loadDatabaseHistoryPreview).mockImplementation(async ({ version }) => ({
    root: new Y.Doc({ guid: version }), rows: {}, destroy: jest.fn(),
  }));
  const { rerender } = render(<DatabaseHistoryModal {...props} />);

  await screen.findByText('page-0');
  fireEvent.click(screen.getByText('Load older versions'));
  fireEvent.click(await screen.findByText('Older version'));
  await screen.findByText('older');
  expect(getDatabaseHistory).toHaveBeenCalledTimes(2);
  expect(loadDatabaseHistoryPreview).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByTestId('database-history-restore'));
  fireEvent.click(screen.getByTestId('database-history-confirm-restore'));
  expect(mockStart).toHaveBeenCalledWith('older');
  mockRestoreCompleted = 1;
  rerender(<DatabaseHistoryModal {...props} />);
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  rerender(<DatabaseHistoryModal {...props} />);
  expect(props.onOpenChange).toHaveBeenCalledTimes(1);
  expect(getDatabaseHistory).toHaveBeenCalledTimes(2);
  expect(loadDatabaseHistoryPreview).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('recovery')).not.toBeInTheDocument();

  rerender(<DatabaseHistoryModal {...props} open={false} />);
  rerender(<DatabaseHistoryModal {...props} />);
  await screen.findByText('recovery');
  expect(getDatabaseHistory).toHaveBeenCalledTimes(3);
  expect(getDatabaseHistory).toHaveBeenLastCalledWith('w', 'd', expect.objectContaining({ cursor: undefined }));
  expect(props.onOpenChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Before restore')).not.toBeInTheDocument();
});
