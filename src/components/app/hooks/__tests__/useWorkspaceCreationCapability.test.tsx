import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import { useWorkspaceCreationCapability } from '../useWorkspaceCreationCapability';

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

function mount() {
  return renderHook(() => useWorkspaceCreationCapability(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
    ),
  });
}

beforeEach(() => {
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
  expect(result.current.legacy).toBe(true);
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
