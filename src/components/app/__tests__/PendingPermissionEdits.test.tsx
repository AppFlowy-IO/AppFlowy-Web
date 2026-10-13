import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { deleteCollabDB, getCachedProviderDoc } from '@/application/db';
import { discardPermissionBlockedEdits, retryPermissionBlockedSync } from '@/application/sync-outbox';

import { PendingPermissionEdits } from '../PendingPermissionEdits';

let mockPending: { blocked: string[]; queued: string[] } = { blocked: [], queued: [] };

jest.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mockPending }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/application/db', () => ({
  db: {},
  deleteCollabDB: jest.fn(async () => true),
  getCachedProviderDoc: jest.fn(),
}));
jest.mock('@/application/sync-outbox', () => ({
  retryPermissionBlockedSync: jest.fn(),
  discardPermissionBlockedEdits: jest.fn(),
}));

const session = { userId: 'user', workspaceId: 'workspace', serverUrl: 'https://server' };

function renderNotice(props: Partial<Parameters<typeof PendingPermissionEdits>[0]> = {}) {
  return render(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockPending = { blocked: ['page-a', 'page-b'], queued: [] };
  jest.mocked(retryPermissionBlockedSync).mockResolvedValue({ released: [], denied: [], unknown: [] });
  jest.mocked(discardPermissionBlockedEdits).mockResolvedValue([]);
});

test('stays hidden when no edits are waiting for edit access', () => {
  mockPending = { blocked: [], queued: ['queued-page'] };
  const { container } = renderNotice();

  expect(container.innerHTML).toBe('');
});

test('counts the waiting pages and offers Try again, Discard changes and dismiss with design-system buttons', () => {
  renderNotice();

  expect(screen.getByRole('status').textContent).toContain('workspacePermissions.pendingEdits:2');
  const buttons = [
    screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }),
    screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }),
    screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDismiss' }),
  ];

  buttons.forEach((button) => expect(button.getAttribute('data-slot')).toBe('button'));
});

test('Try again checks access afresh for the rendered session and reports pages that still wait', async () => {
  const beforeRetry = jest.fn();

  jest.mocked(retryPermissionBlockedSync).mockResolvedValue({ released: ['page-a'], denied: ['page-b'], unknown: [] });
  renderNotice({ beforeRetry });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }));
  });

  expect(beforeRetry).toHaveBeenCalledTimes(1);
  expect(retryPermissionBlockedSync).toHaveBeenCalledWith(session);
  expect(toast.error).toHaveBeenCalledWith('workspacePermissions.pendingEditsStillWaiting:1');
});

test.each([
  [{ released: [], denied: [], unknown: ['page-a'] }, 'error', 'workspacePermissions.pendingEditsRetryError'],
  [{ released: ['page-a', 'page-b'], denied: [], unknown: [] }, 'success', 'workspacePermissions.pendingEditsSent'],
] as const)('reports the retry outcome %#', async (result, kind, message) => {
  jest.mocked(retryPermissionBlockedSync).mockResolvedValue({
    released: [...result.released], denied: [...result.denied], unknown: [...result.unknown],
  });
  renderNotice();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }));
  });

  expect(toast[kind]).toHaveBeenCalledWith(message);
});

test('keeps showing released edits as saving until the socket owner uploads them', async () => {
  jest.mocked(retryPermissionBlockedSync).mockResolvedValue({ released: ['page-a', 'page-b'], denied: [], unknown: [] });
  const { rerender } = renderNotice();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }));
  });
  mockPending = { blocked: [], queued: ['page-a'] };
  rerender(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('workspacePermissions.pendingEditsSaving');
  expect(screen.queryByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' })).toBeNull();

  mockPending = { blocked: [], queued: [] };
  rerender(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('Discard changes asks for confirmation, then removes the edits and the local copies', async () => {
  const reloadPage = jest.fn();

  jest.mocked(discardPermissionBlockedEdits).mockResolvedValue(['page-a', 'page-b']);
  jest.mocked(getCachedProviderDoc).mockImplementation((id: string) => (id === 'page-b' ? ({} as never) : undefined));
  renderNotice({ reloadPage });
  fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }));
  expect(discardPermissionBlockedEdits).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog');

  expect(dialog.textContent).toContain('workspacePermissions.pendingEditsDiscardDescription:2');
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }).at(-1)!);
  });

  expect(discardPermissionBlockedEdits).toHaveBeenCalledWith(session);
  expect(deleteCollabDB).toHaveBeenCalledWith('page-a', { destroyDoc: false });
  expect(deleteCollabDB).toHaveBeenCalledWith('page-b', { destroyDoc: false });
  expect(toast.success).toHaveBeenCalledWith('workspacePermissions.pendingEditsDiscarded');
  // An open page still holds the discarded edits in memory and must reload.
  expect(reloadPage).toHaveBeenCalledTimes(1);
});

test('Cancel keeps the waiting edits', async () => {
  renderNotice();
  fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'button.cancel' }));

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(discardPermissionBlockedEdits).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toBeTruthy();
});

test('a dismissed notice stays hidden for the same pages and returns when another page starts waiting', () => {
  const { unmount } = renderNotice();

  fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
  unmount();

  renderNotice();
  expect(screen.queryByRole('status')).toBeNull();

  mockPending = { blocked: ['page-a', 'page-b', 'page-c'], queued: [] };
  renderNotice();
  expect(screen.getByRole('status').textContent).toContain('workspacePermissions.pendingEdits:3');
});
