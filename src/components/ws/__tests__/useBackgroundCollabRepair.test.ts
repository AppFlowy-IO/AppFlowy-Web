import { act, renderHook, waitFor } from '@testing-library/react';

import { readPersistedRepairUpdate } from '@/application/collab-repair/indexeddb';
import type { RepairUpdate } from '@/application/collab-repair/types';
import { enqueueOutboxUpdate, getCurrentOutboxSession } from '@/application/sync-outbox';
import type { collab } from '@/proto/messages';

import type { AppflowyWebSocketType } from '../useAppflowyWebSocket';
import { useBackgroundCollabRepair } from '../useBackgroundCollabRepair';

jest.mock('@/application/collab-repair/indexeddb', () => ({ readPersistedRepairUpdate: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({ enqueueOutboxUpdate: jest.fn(), getCurrentOutboxSession: jest.fn() }));

const objectId = '11111111-1111-1111-1111-111111111111';
const version = '22222222-2222-2222-2222-222222222222';
const notice: collab.ICollabMessage = {
  objectId,
  collabType: 0,
  repairRequest: {
    requestId: '33333333-3333-3333-3333-333333333333',
    stateVector: new Uint8Array([0]),
    maxUpdateBytes: 4096,
    version,
  },
};
const update: RepairUpdate = {
  objectId,
  collabType: 0,
  payload: new Uint8Array([1, 2, 3]),
  version,
  databaseRestoreId: undefined,
  beforeStateVector: new Uint8Array([0]),
};
const mockRead = jest.mocked(readPersistedRepairUpdate);
const mockEnqueue = jest.mocked(enqueueOutboxUpdate);
const mockSession = jest.mocked(getCurrentOutboxSession);
const mockSend = jest.fn();
let listeners: Set<(message: collab.ICollabMessage) => void>;
let socket: AppflowyWebSocketType;

beforeEach(() => {
  jest.clearAllMocks();
  listeners = new Set();
  socket = {
    options: { workspaceId: 'workspace' },
    reconnectAttempt: 0,
    readyState: 1,
    lastMessage: null,
    sendMessage: jest.fn(),
    reconnect: jest.fn(),
    subscribeRepairRequests: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    captureRepairSender: () => mockSend,
  };
  mockRead.mockResolvedValue(update);
  mockEnqueue.mockResolvedValue(true);
  mockSend.mockReturnValue(true);
  mockSession.mockReturnValue({ userId: 'user', workspaceId: 'workspace' });
});

function emit() {
  listeners.forEach((listener) => listener(notice));
}

test('the connected leader donates once through the captured repair transport without enqueueing', async () => {
  renderHook(() => useBackgroundCollabRepair(socket, true, 'user', 'workspace'));
  act(() => {
    emit();
    emit();
  });
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ requestId: notice.repairRequest!.requestId }), update);
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockSession).toHaveBeenCalledWith('workspace');
});

test.each([
  { leader: false, readyState: 1, user: 'user' },
  { leader: true, readyState: 0, user: 'user' },
  { leader: true, readyState: 1, user: null },
])('does not subscribe for an ineligible connection %j', async ({ leader, readyState, user }) => {
  renderHook(() => useBackgroundCollabRepair({ ...socket, readyState }, leader, user, 'workspace'));
  act(emit);
  expect(listeners.size).toBe(0);
  expect(mockRead).not.toHaveBeenCalled();
});

test.each(['workspace', 'leadership', 'logout', 'unmount'])('cancels a pending donor on %s change', async (change) => {
  let complete!: (value: RepairUpdate) => void;

  mockRead.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const { rerender, unmount } = renderHook(
    ({ leader, user, workspace }) => useBackgroundCollabRepair(socket, leader, user, workspace),
    { initialProps: { leader: true, user: 'user' as string | null, workspace: 'workspace' } }
  );

  act(emit);
  const signal = mockRead.mock.calls[0][1];

  if (change === 'unmount') unmount();
  else
    rerender({
      leader: change !== 'leadership',
      user: change === 'logout' ? null : 'user',
      workspace: change === 'workspace' ? 'next-workspace' : 'workspace',
    });
  await act(async () => {
    complete(update);
  });
  expect(signal.aborted).toBe(true);
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('a session replaced outside React cannot enqueue a donor from the previous account', async () => {
  let complete!: (value: RepairUpdate) => void;

  mockRead.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  renderHook(() => useBackgroundCollabRepair(socket, true, 'user', 'workspace'));
  act(emit);
  mockSession.mockReturnValue({ userId: 'replacement', workspaceId: 'workspace' });
  await act(async () => {
    complete(update);
  });
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('a missing native connection declines before reading storage', () => {
  socket.captureRepairSender = () => undefined;
  renderHook(() => useBackgroundCollabRepair(socket, true, 'user', 'workspace'));
  act(emit);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockEnqueue).not.toHaveBeenCalled();
});
