import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { WorkspaceSpaceCreationCapabilities } from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { useSpaceCreationCapability } from '../useSpaceCreationCapability';

const mockRead = jest.fn();
let mockUserId = 'user-a';
let mockWorkspaceId = 'workspace-a';
let mockServerUrl = 'https://one.test';
const emitter = new EventEmitter();

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => mockUserId }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServerUrl }));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthInternalContext.Provider
      value={{
        isAuthenticated: true,
        currentWorkspaceId: mockWorkspaceId,
        onChangeWorkspace: jest.fn(),
      }}
    >
      <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
    </AuthInternalContext.Provider>
  );
}

function capability(counter = '1', canCreate = true): WorkspaceSpaceCreationCapabilities {
  return {
    workspace_id: mockWorkspaceId,
    policy: 'owners_and_selected_members',
    revision: { epoch: '9007199254740993', counter },
    selected_creators_supported: true,
    group_selection_supported: true,
    can_create_space: canCreate,
    can_manage_space_creators: false,
    can_grant_creator_groups: false,
  };
}

function deferred() {
  let resolve!: (value: WorkspaceSpaceCreationCapabilities) => void;
  const promise = new Promise<WorkspaceSpaceCreationCapabilities>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function mount() {
  return renderHook(({ enabled }) => useSpaceCreationCapability(mockWorkspaceId, enabled), {
    initialProps: { enabled: true },
    wrapper: Wrapper,
  });
}

describe('space creation capability lifecycle', () => {
  beforeEach(() => {
    mockUserId = 'user-a';
    mockWorkspaceId = 'workspace-a';
    mockServerUrl = 'https://one.test';
    mockRead.mockReset();
    emitter.removeAllListeners();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('is unavailable while loading, then uses effective permission instead of role', async () => {
    const pending = deferred();

    mockRead.mockReturnValue(pending.promise);
    const { result } = mount();

    expect(result.current.canCreateSpace).toBe(false);
    expect(result.current.status).toBe('loading');
    await act(async () => pending.resolve(capability()));
    expect(result.current.canCreateSpace).toBe(true);
    expect(WorkspaceService.getWorkspaceSpaceCreationCapabilities).toBeDefined();
  });

  it('discards a late positive response after a newer revocation hint', async () => {
    const old = deferred();

    mockRead.mockReturnValueOnce(old.promise).mockResolvedValue(capability('2', false));
    const { result } = mount();

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    await act(async () => {
      emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, {
        workspaceId: mockWorkspaceId,
        revision: capability('2').revision,
      });
    });
    expect(result.current.status).toBe('loading');
    await act(async () => old.resolve(capability('1', true)));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.canCreateSpace).toBe(false);
    expect(result.current.capability?.revision.counter).toBe('2');
  });

  it('rejects a response older than the observed hint, including adjacent large counters', async () => {
    mockRead.mockResolvedValue(capability('9007199254740992'));
    const { result } = mount();

    await waitFor(() => expect(result.current.canCreateSpace).toBe(true));
    await act(async () => {
      emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, {
        workspaceId: mockWorkspaceId,
        revision: capability('9007199254740993').revision,
      });
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.canCreateSpace).toBe(false);
  });

  it.each(['user', 'server', 'workspace'])('fences a late response across a %s switch', async (changed) => {
    const old = deferred();

    mockRead.mockReturnValueOnce(old.promise).mockImplementation(async () => capability('1', false));
    const { result, rerender } = mount();
    const stale = capability('99', true);

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    if (changed === 'user') mockUserId = 'user-b';
    if (changed === 'server') mockServerUrl = 'https://two.test';
    if (changed === 'workspace') mockWorkspaceId = 'workspace-b';
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => old.resolve(stale));
    expect(result.current.canCreateSpace).toBe(false);
    expect(result.current.capability?.revision.counter).toBe('1');
  });

  it('ignores unrelated/reordered hints and refreshes after focus when a notification was lost', async () => {
    mockRead.mockResolvedValue(capability('2', false));
    const { result } = mount();

    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, {
        workspaceId: 'another',
        revision: capability('9').revision,
      });
      emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, {
        workspaceId: mockWorkspaceId,
        revision: capability('1').revision,
      });
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
    mockRead.mockResolvedValue(capability('3'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(result.current.canCreateSpace).toBe(true));
  });

  it('does not retain a positive capability offline or after closing the consumer', async () => {
    mockRead.mockResolvedValue(capability());
    const { result, rerender } = mount();

    await waitFor(() => expect(result.current.canCreateSpace).toBe(true));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.canCreateSpace).toBe(false);
    expect(result.current.status).toBe('error');
    rerender({ enabled: false });
    expect(result.current.capability).toBeUndefined();
  });

  it('shows unsupported separately from a loaded denial', async () => {
    mockRead.mockRejectedValue({ httpStatus: 404 });
    const { result } = mount();

    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.canCreateSpace).toBe(false);
    mockRead.mockResolvedValue(capability('1', false));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.canCreateSpace).toBe(false);
  });

  it('coalesces a burst while immediately invalidating the old positive capability', async () => {
    mockRead.mockResolvedValue(capability());
    const { result } = mount();

    await waitFor(() => expect(result.current.canCreateSpace).toBe(true));
    const old = deferred();

    mockRead.mockReturnValueOnce(old.promise);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    for (let index = 2; index <= 21; index += 1) {
      await act(async () => {
        emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, {
          workspaceId: mockWorkspaceId,
          revision: capability(String(index)).revision,
        });
      });
    }

    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(result.current.canCreateSpace).toBe(false);
    mockRead.mockResolvedValue(capability('21', false));
    await act(async () => {
      old.resolve(capability('1'));
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(result.current.canCreateSpace).toBe(false);
    expect(result.current.capability?.revision.counter).toBe('21');
  });

  it('does not dispatch a queued capability read after closing the consumer', async () => {
    const old = deferred();

    mockRead.mockReturnValue(old.promise);
    const { unmount } = mount();

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    unmount();
    await act(async () => {
      old.resolve(capability());
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('shares the queued promise instead of retaining an async wrapper for every hint', async () => {
    const old = deferred();

    mockRead.mockReturnValueOnce(old.promise).mockResolvedValue(capability('2', false));
    const { result } = mount();

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    const requests: Array<Promise<WorkspaceSpaceCreationCapabilities | undefined>> = [];

    act(() => {
      requests.push(result.current.refresh(), result.current.refresh());
    });
    expect(requests[0]).toBe(requests[1]);
    await act(async () => {
      old.resolve(capability());
    });
    await expect(requests[0]).resolves.toEqual(capability('2', false));
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});
