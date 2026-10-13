import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { deleteCollabDB, hasCollabDocInMemory } from '@/application/db';
import {
  discardPermissionBlockedEdits,
  retryPermissionBlockedSync,
  settleDiscardedEdits,
  subscribeDiscardedEdits,
} from '@/application/sync-outbox';

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
  hasCollabDocInMemory: jest.fn(() => false),
}));
jest.mock('@/application/sync-outbox', () => ({
  retryPermissionBlockedSync: jest.fn(),
  discardPermissionBlockedEdits: jest.fn(),
  settleDiscardedEdits: jest.fn(),
  subscribeDiscardedEdits: jest.fn(() => () => undefined),
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
  jest.mocked(hasCollabDocInMemory).mockReturnValue(false);
  jest.mocked(subscribeDiscardedEdits).mockImplementation(() => () => undefined);
});

/** The listener the notice registered for discards announced by any tab. */
function discardListener() {
  const calls = jest.mocked(subscribeDiscardedEdits).mock.calls;

  expect(calls.at(-1)?.[0]).toEqual(session);
  return calls.at(-1)![1];
}

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

test('forgets a released page once its edits are saved, so later ordinary edits show no notice', async () => {
  const rerenderNotice = (rerender: (ui: React.ReactElement) => void) =>
    rerender(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />);

  mockPending = { blocked: ['page-a'], queued: [] };
  jest.mocked(retryPermissionBlockedSync).mockResolvedValue({ released: ['page-a'], denied: [], unknown: [] });
  const { rerender } = renderNotice();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }));
  });
  // The live query has not seen the release yet: the page still counts as waiting.
  rerenderNotice(rerender);
  expect(screen.getByRole('status').textContent).toContain('workspacePermissions.pendingEdits:1');

  mockPending = { blocked: [], queued: ['page-a'] };
  rerenderNotice(rerender);
  expect(screen.getByRole('status').textContent).toContain('workspacePermissions.pendingEditsSaving');

  // The released edits are uploaded.
  mockPending = { blocked: [], queued: [] };
  rerenderNotice(rerender);
  expect(screen.queryByRole('status')).toBeNull();

  // Much later the page has ordinary queued edits (offline, or while a check runs).
  mockPending = { blocked: [], queued: ['page-a'] };
  rerenderNotice(rerender);
  expect(screen.queryByRole('status')).toBeNull();
});

test('forgets a released page whose edits were already saved when Try again finished', async () => {
  mockPending = { blocked: ['page-a'], queued: [] };
  jest.mocked(retryPermissionBlockedSync).mockImplementation(async () => {
    // The socket owner uploaded the released rows before this tab resumed.
    mockPending = { blocked: [], queued: [] };
    return { released: ['page-a'], denied: [], unknown: [] };
  });
  const { rerender } = renderNotice();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' }));
  });
  rerender(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();

  mockPending = { blocked: [], queued: ['page-a'] };
  rerender(<PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('Discard changes asks for confirmation, then removes the edits and the local copies', async () => {
  const reloadPage = jest.fn();

  jest.mocked(discardPermissionBlockedEdits).mockResolvedValue(['page-a', 'page-b']);
  jest.mocked(hasCollabDocInMemory).mockImplementation((id: string) => id === 'page-b');
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
  expect(settleDiscardedEdits).not.toHaveBeenCalled();
});

test('a tab that holds none of the discarded pages settles the discard instead of reloading', async () => {
  const reloadPage = jest.fn();

  jest.mocked(discardPermissionBlockedEdits).mockResolvedValue(['page-a']);
  renderNotice({ reloadPage });
  fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }));
  await screen.findByRole('alertdialog');
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }).at(-1)!);
  });

  expect(reloadPage).not.toHaveBeenCalled();
  expect(settleDiscardedEdits).toHaveBeenCalledWith(session, ['page-a']);
});

test('leaves a discard announced during this tab’s own discard to that discard', async () => {
  const reloadPage = jest.fn();
  let finishDiscard!: (ids: string[]) => void;

  jest.mocked(discardPermissionBlockedEdits).mockReturnValue(new Promise((resolve) => {
    finishDiscard = resolve;
  }));
  jest.mocked(hasCollabDocInMemory).mockImplementation((id: string) => id === 'page-a');
  renderNotice({ reloadPage });
  fireEvent.click(screen.getByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }));
  await screen.findByRole('alertdialog');
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'workspacePermissions.pendingEditsDiscard' }).at(-1)!);
  });

  // A refused upload asks for settlement while the rows are still being deleted.
  await act(async () => {
    discardListener()(['page-a']);
  });
  expect(reloadPage).not.toHaveBeenCalled();

  await act(async () => {
    finishDiscard(['page-a', 'page-b']);
  });
  expect(deleteCollabDB).toHaveBeenCalledWith('page-b', { destroyDoc: false });
  expect(reloadPage).toHaveBeenCalledTimes(1);
});

test('reloads when another tab discarded edits to a page this tab still holds', async () => {
  const reloadPage = jest.fn();

  mockPending = { blocked: [], queued: [] };
  jest.mocked(hasCollabDocInMemory).mockImplementation((id: string) => id === 'page-b');
  renderNotice({ reloadPage });

  await act(async () => {
    discardListener()(['page-a', 'page-b']);
  });

  // The local copy goes first, so the reloaded tab opens the page from the server.
  expect(deleteCollabDB).toHaveBeenCalledWith('page-b', { destroyDoc: false });
  expect(deleteCollabDB).not.toHaveBeenCalledWith('page-a', expect.anything());
  expect(reloadPage).toHaveBeenCalledTimes(1);
  expect(settleDiscardedEdits).not.toHaveBeenCalled();

  // Further notices while the reload is under way do not reload again.
  await act(async () => {
    discardListener()(['page-b']);
  });
  expect(reloadPage).toHaveBeenCalledTimes(1);
});

test('settles another tab’s discard without reloading when this tab holds none of the pages', async () => {
  const reloadPage = jest.fn();

  mockPending = { blocked: [], queued: [] };
  renderNotice({ reloadPage });
  await act(async () => {
    discardListener()(['page-a']);
  });

  expect(settleDiscardedEdits).toHaveBeenCalledWith(session, ['page-a']);
  expect(deleteCollabDB).not.toHaveBeenCalled();
  expect(reloadPage).not.toHaveBeenCalled();
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
