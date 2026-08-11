import { act, renderHook } from '@testing-library/react';

import { WorkspaceService } from '@/application/services/domains';
import { FolderView } from '@/application/types';
import { saveDuplicateSelectedWorkspaceId } from '@/components/publish/header/duplicate/storage';
import { useLoadWorkspaces } from '@/components/publish/header/duplicate/useDuplicate';

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getAll: jest.fn(),
    getFolder: jest.fn(),
  },
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
  },
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ email: 'test@appflowy.io' }),
  useIsAuthenticatedOptional: () => true,
}));

const mockWorkspaceService = WorkspaceService as jest.Mocked<typeof WorkspaceService>;

function createFolder(workspaceId: string, spaceId: string, spaceName: string): FolderView {
  return {
    id: workspaceId,
    icon: null,
    extra: null,
    name: workspaceId,
    isSpace: false,
    isPrivate: false,
    children: [
      {
        id: spaceId,
        icon: null,
        extra: null,
        name: spaceName,
        isSpace: true,
        isPrivate: false,
        children: [],
      },
    ],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('useLoadWorkspaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders with no saved workspace when localStorage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });

    const { result } = renderHook(() => useLoadWorkspaces());

    expect(result.current.selectedWorkspaceId).toBe('');
  });

  it('keeps workspace selection usable when localStorage persistence fails', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });

    expect(() => saveDuplicateSelectedWorkspaceId('workspace-a')).not.toThrow();
  });

  it('exposes a retryable error when loading spaces fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockWorkspaceService.getFolder
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(createFolder('workspace-a', 'space-a', 'General'));

    const { result } = renderHook(() => useLoadWorkspaces());

    await act(async () => {
      await result.current.loadSpaces('workspace-a');
    });

    expect(result.current.spaceError).toBe(true);
    expect(result.current.spaceLoading).toBe(false);
    expect(result.current.spaceList).toEqual([]);

    await act(async () => {
      await result.current.loadSpaces('workspace-a');
    });

    expect(result.current.spaceError).toBe(false);
    expect(result.current.spaceList).toEqual([
      {
        id: 'space-a',
        name: 'General',
        isPrivate: false,
        extra: null,
      },
    ]);
    expect(mockWorkspaceService.getFolder).toHaveBeenCalledTimes(2);
    expect(mockWorkspaceService.getFolder).toHaveBeenNthCalledWith(1, 'workspace-a', 2);
    expect(mockWorkspaceService.getFolder).toHaveBeenNthCalledWith(2, 'workspace-a', 2);

    consoleError.mockRestore();
  });

  it('handles an account with no available workspaces', async () => {
    mockWorkspaceService.getAll.mockResolvedValue([]);

    const { result } = renderHook(() => useLoadWorkspaces());

    await act(async () => {
      await result.current.loadWorkspaces();
    });

    expect(result.current.workspaceList).toEqual([]);
    expect(result.current.selectedWorkspaceId).toBe('');
    expect(result.current.workspaceLoading).toBe(false);
  });

  it('ignores a stale response after switching workspaces', async () => {
    const workspaceA = createDeferred<FolderView>();
    const workspaceB = createDeferred<FolderView>();

    mockWorkspaceService.getFolder.mockImplementation((workspaceId) => {
      return workspaceId === 'workspace-a' ? workspaceA.promise : workspaceB.promise;
    });

    const { result } = renderHook(() => useLoadWorkspaces());
    let loadWorkspaceA!: Promise<void>;
    let loadWorkspaceB!: Promise<void>;

    act(() => {
      loadWorkspaceA = result.current.loadSpaces('workspace-a');
      loadWorkspaceB = result.current.loadSpaces('workspace-b');
    });

    await act(async () => {
      workspaceB.resolve(createFolder('workspace-b', 'space-b', 'Projects'));
      await loadWorkspaceB;
    });

    expect(result.current.spaceList[0]?.id).toBe('space-b');
    expect(result.current.spaceLoading).toBe(false);

    await act(async () => {
      workspaceA.resolve(createFolder('workspace-a', 'space-a', 'General'));
      await loadWorkspaceA;
    });

    expect(result.current.spaceList[0]?.id).toBe('space-b');
    expect(result.current.spaceError).toBe(false);
    expect(mockWorkspaceService.getFolder).toHaveBeenCalledWith('workspace-a', 2);
    expect(mockWorkspaceService.getFolder).toHaveBeenCalledWith('workspace-b', 2);
  });
});
