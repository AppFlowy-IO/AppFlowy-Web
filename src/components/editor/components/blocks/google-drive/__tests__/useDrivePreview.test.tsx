import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { notifyConnectionsChanged } from '@/application/integrations/connection-events';
import { DriveFile, getDriveFile } from '@/application/integrations/google-drive';
import { listConnections } from '@/application/services/domains/integration';
import { emit, EventType } from '@/application/session/event';

import { useDrivePreview } from '../useDrivePreview';

let mockUserId: string | undefined = 'user';

jest.mock('@/application/session/token', () => ({
  getTokenParsed: () => (mockUserId ? { user: { id: mockUserId } } : null),
}));
jest.mock('@/application/services/domains/integration', () => ({ listConnections: jest.fn() }));
jest.mock('@/application/integrations/google-drive', () => ({ getDriveFile: jest.fn() }));

const connection = {
  id: 'drive',
  provider: 'google-drive',
  status: 'active',
  connected_at: '',
  account_identifier: 'personal@example.com',
};
const file = (id: string, thumbnail = 'original'): DriveFile => ({
  id,
  name: id,
  mimeType: 'file',
  thumbnailLink: `https://x.googleusercontent.com/${thumbnail}`,
});
const api = jest.mocked({ listConnections, getDriveFile });
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

describe('shared Drive previews', () => {
  beforeEach(() => {
    mockUserId = 'user';
    api.listConnections.mockReset().mockResolvedValue([connection]);
    api.getDriveFile.mockReset().mockImplementation(async (_workspaceId, _connectionId, fileId) => file(fileId));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('shares connections across files and metadata across concurrent and later readers', async () => {
    const first = renderHook(() => useDrivePreview('workspace', 'same-file'));
    const second = renderHook(() => useDrivePreview('workspace', 'same-file'));
    const third = renderHook(() => useDrivePreview('workspace', 'same-file'));
    const other = renderHook(() => useDrivePreview('workspace', 'other-file'));

    await waitFor(() => expect(other.result.current.thumbnail).toBe(file('other-file').thumbnailLink));
    const later = renderHook(() => useDrivePreview('workspace', 'same-file'));

    await waitFor(() => expect(later.result.current.thumbnail).toBe(file('same-file').thumbnailLink));
    for (const hook of [first, second, third])
      expect(hook.result.current.thumbnail).toBe(file('same-file').thumbnailLink);
    expect(api.listConnections).toHaveBeenCalledTimes(1);
    expect(api.getDriveFile).toHaveBeenCalledTimes(2);
  });

  it('keeps shared requests alive until their last reader unmounts', async () => {
    let resolveFile!: (value: DriveFile) => void;

    api.getDriveFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFile = resolve;
        })
    );
    const first = renderHook(() => useDrivePreview('workspace', 'file'));
    const second = renderHook(() => useDrivePreview('workspace', 'file'));

    await waitFor(() => expect(api.getDriveFile).toHaveBeenCalledTimes(1));
    const fileSignal = api.getDriveFile.mock.calls[0][3];
    const connectionSignal = api.listConnections.mock.calls[0][1];

    first.unmount();
    expect(fileSignal?.aborted).toBe(false);
    await act(async () => {
      resolveFile(file('file'));
      await flush();
    });
    expect(second.result.current.thumbnail).toBe(file('file').thumbnailLink);
    second.unmount();
    expect(fileSignal?.aborted).toBe(true);
    expect(connectionSignal?.aborted).toBe(true);
  });

  it('refreshes all readers of one file without refetching other files', async () => {
    const first = renderHook(() => useDrivePreview('workspace', 'file'));
    const second = renderHook(() => useDrivePreview('workspace', 'file'));
    const other = renderHook(() => useDrivePreview('workspace', 'other-file'));

    await waitFor(() => expect(other.result.current.thumbnail).toBeDefined());
    api.getDriveFile.mockResolvedValue(file('file', 'updated'));
    act(() => first.result.current.reload());
    expect(second.result.current.thumbnail).toBeUndefined();
    await waitFor(() => expect(first.result.current.thumbnail).toBe(file('file', 'updated').thumbnailLink));
    expect(second.result.current.thumbnail).toBe(first.result.current.thumbnail);
    expect(other.result.current.thumbnail).toBe(file('other-file').thumbnailLink);
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(api.getDriveFile).toHaveBeenCalledTimes(3);
  });

  it('invalidates connections once and ignores stale metadata after an account change', async () => {
    let resolveOldFile!: (value: DriveFile) => void;

    api.getDriveFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldFile = resolve;
        })
    );
    const first = renderHook(() => useDrivePreview('workspace', 'file'));
    const second = renderHook(() => useDrivePreview('workspace', 'file'));

    await waitFor(() => expect(api.getDriveFile).toHaveBeenCalledTimes(1));
    const oldSignal = api.getDriveFile.mock.calls[0][3];

    api.getDriveFile.mockResolvedValue(file('file', 'new-account'));
    act(() => notifyConnectionsChanged('workspace'));
    await waitFor(() => expect(first.result.current.thumbnail).toBe(file('file', 'new-account').thumbnailLink));
    await act(async () => {
      resolveOldFile(file('file', 'stale'));
      await flush();
    });
    expect(second.result.current.thumbnail).toBe(file('file', 'new-account').thumbnailLink);
    expect(oldSignal?.aborted).toBe(true);
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(api.getDriveFile).toHaveBeenCalledTimes(2);
  });

  it('keeps metadata scoped to the workspace and selected account', async () => {
    api.listConnections.mockResolvedValue([
      connection,
      { ...connection, id: 'work', account_identifier: 'work@example.com' },
    ]);
    api.getDriveFile.mockImplementation(async (workspaceId, connectionId) =>
      file('file', `${workspaceId}-${connectionId}`)
    );
    const personal = renderHook(() => useDrivePreview('workspace', 'file', 'personal@example.com'));
    const work = renderHook(() => useDrivePreview('workspace', 'file', 'work@example.com'));
    const other = renderHook(() => useDrivePreview('other-workspace', 'file', 'work@example.com'));

    await waitFor(() => expect(other.result.current.thumbnail).toBe(file('file', 'other-workspace-work').thumbnailLink));
    expect(personal.result.current.thumbnail).toBe(file('file', 'workspace-drive').thumbnailLink);
    expect(work.result.current.thumbnail).toBe(file('file', 'workspace-work').thumbnailLink);
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(api.getDriveFile).toHaveBeenCalledTimes(3);
  });

  it('drops authenticated previews on logout and refetches for the next user', async () => {
    const preview = renderHook(() => useDrivePreview('workspace', 'file'));

    await waitFor(() => expect(preview.result.current.thumbnail).toBeDefined());
    act(() => {
      mockUserId = undefined;
      emit(EventType.SESSION_INVALID);
    });
    expect(preview.result.current.thumbnail).toBeUndefined();
    expect(api.listConnections).toHaveBeenCalledTimes(1);
    mockUserId = 'next-user';
    api.getDriveFile.mockResolvedValue(file('file', 'next-user'));
    preview.rerender();
    await waitFor(() => expect(preview.result.current.thumbnail).toBe(file('file', 'next-user').thumbnailLink));
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(api.getDriveFile).toHaveBeenCalledTimes(2);
  });

  it('revalidates expired cached metadata for a later reader', async () => {
    const first = renderHook(() => useDrivePreview('workspace', 'file'));

    await waitFor(() => expect(first.result.current.thumbnail).toBeDefined());
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    api.getDriveFile.mockResolvedValue(file('file', 'renewed'));
    const later = renderHook(() => useDrivePreview('workspace', 'file'));

    await waitFor(() => expect(later.result.current.thumbnail).toBe(file('file', 'renewed').thumbnailLink));
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(api.getDriveFile).toHaveBeenCalledTimes(2);
  });
});
