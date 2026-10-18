import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { emit, EventType } from '@/application/session/event';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import {
  clearWorkspaceCreationCapabilityCache,
  useWorkspaceCreationCapability,
} from '../useWorkspaceCreationCapability';

const mockRead = jest.fn();
let mockUserId = 'user';
let mockServerUrl = 'https://one.test';
let mockAuthenticated = true;
const emitter = new EventEmitter();

jest.mock('@/application/services/js-services/http/workspace-creation-api', () => ({
  getWorkspaceCreationCapability: () => mockRead(),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockUserId,
  useIsAuthenticatedOptional: () => mockAuthenticated,
}));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServerUrl }));

function capability(revision = '1', allowed = true) {
  return { supported: true, mode: 'selected_users', revision, can_create_workspace: allowed };
}

function deferred() {
  let resolve!: (value: ReturnType<typeof capability>) => void;
  const promise = new Promise<ReturnType<typeof capability>>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>;
}

function mount() {
  return renderHook(() => useWorkspaceCreationCapability(), { wrapper: Wrapper });
}

beforeEach(() => {
  clearWorkspaceCreationCapabilityCache();
  mockRead.mockReset();
  mockUserId = 'user';
  mockServerUrl = 'https://one.test';
  mockAuthenticated = true;
  emitter.removeAllListeners();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

test('stays unavailable while loading and honors an explicit hosted unsupported-policy grant', async () => {
  const pending = deferred();

  mockRead.mockReturnValue(pending.promise);
  const { result } = mount();

  expect(result.current.canCreate).toBe(false);
  await act(async () => pending.resolve({ ...capability(), supported: false, mode: 'unrestricted' }));
  expect(result.current.canCreate).toBe(true);
});

test.each(['user', 'server', 'logout'])('fences a late grant and callbacks after %s change', async (change) => {
  const pending = deferred();

  mockRead.mockReturnValueOnce(pending.promise).mockResolvedValue(capability('2', false));
  const { result, rerender } = mount();
  const oldIsCurrent = result.current.isCurrent;

  if (change === 'user') mockUserId = 'other';
  if (change === 'server') mockServerUrl = 'https://two.test';
  if (change === 'logout') mockAuthenticated = false;
  rerender();
  await act(async () => pending.resolve(capability()));
  expect(oldIsCurrent()).toBe(false);
  expect(result.current.canCreate).toBe(false);
});

test('fences callbacks after unmount', async () => {
  mockRead.mockResolvedValue(capability());
  const { result, unmount } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  const isCurrent = result.current.isCurrent;

  unmount();
  expect(isCurrent()).toBe(false);
});

test('a broad hint supersedes an older pending grant', async () => {
  const pending = deferred();

  mockRead.mockReturnValueOnce(pending.promise).mockResolvedValue(capability('9007199254740993', false));
  const { result } = mount();

  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  await act(async () => pending.resolve(capability('9007199254740992')));
  expect(result.current.canCreate).toBe(false);
  expect(result.current.capability?.revision).toBe('9007199254740993');
});

test('a background revalidation keeps the confirmed answer instead of flashing a loading state', async () => {
  mockRead.mockResolvedValueOnce(capability('1'));
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  const pending = deferred();

  mockRead.mockReturnValueOnce(pending.promise);
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe('ready');
  expect(result.current.canCreate).toBe(true);
  await act(async () => pending.resolve(capability('2', false)));
  expect(result.current.canCreate).toBe(false);
});

test('a failed background revalidation keeps the confirmed answer while online', async () => {
  mockRead.mockResolvedValueOnce(capability('1')).mockRejectedValueOnce({ code: -1, message: 'Network Error' });
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe('ready');
  expect(result.current.canCreate).toBe(true);
});

test('focus and visibility revalidation is throttled while the answer is fresh', async () => {
  let now = 1_000_000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);

  mockRead.mockResolvedValue(capability('1'));
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
  now += 31_000;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  clock.mockRestore();
});

test('only an open socket triggers a revalidation', async () => {
  mockRead.mockResolvedValue(capability('1'));
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  await act(async () => {
    emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 0);
    emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => {
    emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
});

test('an older revision from a background read is ignored, but Check again accepts it', async () => {
  mockRead.mockResolvedValueOnce(capability('5', true)).mockResolvedValue(capability('4', false));
  const { result } = mount();

  await waitFor(() => expect(result.current.capability?.revision).toBe('5'));
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  expect(result.current.status).toBe('ready');
  expect(result.current.capability?.revision).toBe('5');
  expect(result.current.canCreate).toBe(true);
  // A restored server can legitimately report a lower revision; an explicit check must not wedge.
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.capability?.revision).toBe('4');
  expect(result.current.canCreate).toBe(false);
  expect(result.current.status).toBe('ready');
});

test('Check again reports progress and replaces an error', async () => {
  mockRead.mockRejectedValueOnce({ code: -1, message: 'Network Error' });
  const { result } = mount();

  await waitFor(() => expect(result.current.status).toBe('error'));
  const pending = deferred();

  mockRead.mockReturnValueOnce(pending.promise);
  let check!: Promise<unknown>;

  act(() => {
    check = result.current.refresh();
  });
  expect(result.current.checking).toBe(true);
  await act(async () => {
    pending.resolve(capability('1'));
    await check;
  });
  expect(result.current.checking).toBe(false);
  expect(result.current.status).toBe('ready');
});

test('a server without the capability route stays usable through the legacy route', async () => {
  mockRead.mockResolvedValue({ ...capability('0'), supported: false, mode: 'unrestricted', legacy: true });
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  expect(result.current.status).toBe('ready');
});

test('offline suspends a prior grant; reconnect revalidates without changing sign-in state', async () => {
  mockRead.mockResolvedValue(capability());
  const { result } = mount();

  await waitFor(() => expect(result.current.canCreate).toBe(true));
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await act(async () => {
    window.dispatchEvent(new Event('offline'));
  });
  expect(result.current.canCreate).toBe(false);
  expect(result.current.status).toBe('error');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  expect(result.current.canCreate).toBe(true);
  expect(mockAuthenticated).toBe(true);
});

describe('one answer shared by every consumer of the account', () => {
  let now = 1_000_000;
  let clock: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = 1_000_000;
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => clock.mockRestore());

  test('consumers mounted together read once', async () => {
    mockRead.mockResolvedValue(capability('1'));
    const sidebar = mount();
    const settings = mount();

    await waitFor(() => expect(settings.result.current.canCreate).toBe(true));
    expect(sidebar.result.current.canCreate).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  test('a consumer opened later starts from the confirmed answer and does not ask while it is recent', async () => {
    mockRead.mockResolvedValue(capability('1'));
    const sidebar = mount();

    await waitFor(() => expect(sidebar.result.current.canCreate).toBe(true));
    // Manage data or the importer opens: no "Checking…" and Import is usable at once.
    const settings = mount();

    expect(settings.result.current.status).toBe('ready');
    expect(settings.result.current.canCreate).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  test('a consumer opened once the answer is old shows it and rechecks it in the background', async () => {
    mockRead.mockResolvedValueOnce(capability('1'));
    const sidebar = mount();

    await waitFor(() => expect(sidebar.result.current.canCreate).toBe(true));
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise);
    now += 31_000;
    const settings = mount();

    expect(settings.result.current.canCreate).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(capability('2', false)));
    expect(settings.result.current.canCreate).toBe(false);
    expect(sidebar.result.current.canCreate).toBe(false);
  });

  test('returning to the tab reads once even while that read is still running', async () => {
    mockRead.mockResolvedValueOnce(capability('1'));
    const { result } = mount();

    await waitFor(() => expect(result.current.canCreate).toBe(true));
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise);
    now += 31_000;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => pending.resolve(capability('1')));
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  test('a socket that opens while the first read runs joins it', async () => {
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise);
    const { result } = mount();

    await act(async () => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await act(async () => pending.resolve(capability('1')));
    expect(result.current.canCreate).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  test('a burst of permission hints heard by every consumer sends one read after the one in flight', async () => {
    mockRead.mockResolvedValueOnce(capability('1'));
    const sidebar = mount();
    const settings = mount();

    await waitFor(() => expect(settings.result.current.canCreate).toBe(true));
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise).mockResolvedValue(capability('3', false));
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(sidebar.result.current.canCreate).toBe(true);
    // The read in flight started before the later hints, so its answer is dropped for a new one.
    await act(async () => pending.resolve(capability('2')));
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(sidebar.result.current.capability?.revision).toBe('3');
    expect(settings.result.current.canCreate).toBe(false);
  });

  test('an unchanged answer does not re-render its consumers', async () => {
    let renders = 0;

    mockRead.mockResolvedValue(capability('1'));
    const { result } = renderHook(
      () => {
        renders += 1;
        return useWorkspaceCreationCapability();
      },
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.canCreate).toBe(true));
    const settledRenders = renders;

    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(renders).toBe(settledRenders);
  });

  test('Check again does not join a background read: it asks again and drops the older answer', async () => {
    const background = deferred();

    mockRead.mockReturnValueOnce(background.promise).mockResolvedValueOnce(capability('1', false));
    const { result } = mount();

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(result.current.canCreate).toBe(false);
    await act(async () => background.resolve(capability('1', true)));
    expect(result.current.canCreate).toBe(false);
  });

  test.each(['user', 'server'])('another %s never starts from this answer', async (change) => {
    mockRead.mockResolvedValueOnce(capability('1'));
    const first = mount();

    await waitFor(() => expect(first.result.current.canCreate).toBe(true));
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise);
    if (change === 'user') mockUserId = 'other';
    if (change === 'server') mockServerUrl = 'https://two.test';
    const second = mount();

    expect(second.result.current.status).toBe('loading');
    expect(second.result.current.capability).toBeUndefined();
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(capability('1', false)));
    expect(second.result.current.canCreate).toBe(false);
  });

  test('signing out forgets the answer', async () => {
    mockRead.mockResolvedValueOnce(capability('1'));
    const { result } = mount();

    await waitFor(() => expect(result.current.canCreate).toBe(true));
    const pending = deferred();

    mockRead.mockReturnValueOnce(pending.promise);
    act(() => emit(EventType.SESSION_INVALID));
    expect(result.current.status).toBe('loading');
    expect(result.current.canCreate).toBe(false);
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(capability('2', false)));
    expect(result.current.status).toBe('ready');
  });
});
