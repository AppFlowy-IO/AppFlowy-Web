import { act, renderHook, waitFor } from '@testing-library/react';

import { usePendingWorkspaceInvitations } from '../usePendingWorkspaceInvitations';

const mockList = jest.fn();

jest.mock('@/application/services/js-services/http/workspace-api', () => ({
  listPendingWorkspaceInvitations: () => mockList(),
}));

const invitation = {
  invite_id: 'invite-1',
  workspace_id: 'workspace-1',
  workspace_name: 'Demo',
  inviter_name: 'Alice',
  inviter_email: 'alice@example.com',
  inviter_icon: '',
  workspace_icon: '',
  member_count: 2,
  status: 'Pending',
};

beforeEach(() => {
  mockList.mockReset();
});

test('loads pending invitations and keeps the last list when a refresh fails', async () => {
  mockList.mockResolvedValueOnce([invitation]).mockRejectedValueOnce({ code: -1, message: 'Network Error' });
  const { result } = renderHook(() => usePendingWorkspaceInvitations());

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toEqual([invitation]);
  let loaded = true;

  await act(async () => {
    loaded = await result.current.refresh();
  });
  expect(loaded).toBe(false);
  expect(result.current.status).toBe('error');
  expect(result.current.items).toEqual([invitation]);
});

test('a server without the invitation list route simply has none to show', async () => {
  mockList.mockRejectedValue({ code: 404, httpStatus: 404 });
  const { result } = renderHook(() => usePendingWorkspaceInvitations());

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toEqual([]);
});

test('a response after unmount is ignored', async () => {
  let resolve!: (value: unknown[]) => void;

  mockList.mockReturnValue(new Promise((done) => (resolve = done)));
  const { result, unmount } = renderHook(() => usePendingWorkspaceInvitations());

  unmount();
  await act(async () => resolve([invitation]));
  expect(result.current.items).toEqual([]);
});

test('returning to the tab sends one request, while Check again still asks', async () => {
  let now = 1_000_000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  let resolve!: (value: unknown[]) => void;

  mockList.mockResolvedValueOnce([]);
  const { result } = renderHook(() => usePendingWorkspaceInvitations());

  await waitFor(() => expect(result.current.status).toBe('ready'));
  mockList.mockReturnValueOnce(new Promise((done) => (resolve = done))).mockResolvedValue([invitation]);
  now += 31_000;
  // Both events fire on a tab return; the second arrives while the first one's request runs.
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(mockList).toHaveBeenCalledTimes(2);
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockList).toHaveBeenCalledTimes(3);
  expect(result.current.items).toEqual([invitation]);
  await act(async () => resolve([]));
  expect(result.current.items).toEqual([invitation]);
  clock.mockRestore();
});
