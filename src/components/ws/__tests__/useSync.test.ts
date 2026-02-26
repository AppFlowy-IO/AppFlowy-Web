import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { openCollabDB } from '@/application/db';
import { handleMessage } from '@/application/services/js-services/sync-protocol';
import { Types } from '@/application/types';

import { BroadcastChannelType } from '../useBroadcastChannel';
import { AppflowyWebSocketType } from '../useAppflowyWebSocket';
import { useSync } from '../useSync';

jest.mock('@/application/db', () => {
  const actual = jest.requireActual('@/application/db');

  return {
    ...actual,
    openCollabDB: jest.fn(actual.openCollabDB),
  };
});

jest.mock('@/application/services/js-services/sync-protocol', () => {
  const actual = jest.requireActual('@/application/services/js-services/sync-protocol');

  return {
    ...actual,
    handleMessage: jest.fn(),
  };
});

const createWs = (): AppflowyWebSocketType =>
  ({
    sendMessage: jest.fn(),
    lastMessage: null,
  } as unknown as AppflowyWebSocketType);

const createBroadcastChannel = (): BroadcastChannelType =>
  ({
    postMessage: jest.fn(),
    lastBroadcastMessage: null,
  } as unknown as BroadcastChannelType);

const createDoc = (guid: string): Y.Doc => {
  const doc = new Y.Doc();

  doc.guid = guid;
  return doc;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const mockedOpenCollabDB = openCollabDB as jest.MockedFunction<typeof openCollabDB>;
const mockedHandleMessage = handleMessage as jest.MockedFunction<typeof handleMessage>;

describe('useSync deferred cleanup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('keeps shared sync context alive when another owner is still mounted', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('11111111-1111-4111-8111-111111111111');
    const { result, unmount } = renderHook(() => useSync(ws, bc));

    let firstRegistration;
    let secondRegistration;
    let thirdRegistration;

    act(() => {
      firstRegistration = result.current.registerSyncContext({ doc, collabType: Types.Document });
      secondRegistration = result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    expect(secondRegistration).toBe(firstRegistration);

    // One owner unmounts; context should remain because another owner still uses it.
    act(() => {
      result.current.scheduleDeferredCleanup(doc.guid, 100);
      jest.advanceTimersByTime(120);
    });

    act(() => {
      thirdRegistration = result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    expect(thirdRegistration).toBe(firstRegistration);

    unmount();
    doc.destroy();
  });

  it('tears down sync context only after the last owner schedules cleanup', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('22222222-2222-4222-8222-222222222222');
    const { result, unmount } = renderHook(() => useSync(ws, bc));

    let firstRegistration;
    let afterCleanupRegistration;

    act(() => {
      firstRegistration = result.current.registerSyncContext({ doc, collabType: Types.Document });
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    // First release keeps context alive.
    act(() => {
      result.current.scheduleDeferredCleanup(doc.guid, 100);
      jest.advanceTimersByTime(120);
    });

    // Second release should schedule and remove context.
    act(() => {
      result.current.scheduleDeferredCleanup(doc.guid, 100);
      jest.advanceTimersByTime(120);
    });

    act(() => {
      afterCleanupRegistration = result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    expect(afterCleanupRegistration).not.toBe(firstRegistration);

    unmount();
    doc.destroy();
  });

  it('flushes pending local updates immediately when doc is destroyed', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('33333333-3333-4333-8333-333333333333');
    const { result, unmount } = renderHook(() => useSync(ws, bc));
    const sendMessage = ws.sendMessage as jest.Mock;

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.DatabaseRow });
    });

    // Ignore the initial sync request from initSync.
    sendMessage.mockClear();

    act(() => {
      doc.getMap('root').set('k', 'v');
      doc.destroy();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        collabMessage: expect.objectContaining({
          objectId: doc.guid,
          collabType: Types.DatabaseRow,
          update: expect.any(Object),
        }),
      }),
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe('useSync version-gated message handling', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('applies update when incoming version matches local version', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectId = '44444444-4444-4444-8444-444444444444';
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b010';
    const doc = createDoc(objectId) as Y.Doc & { version?: string };
    doc.version = version;

    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const message = {
      objectId,
      collabType: Types.Document,
      update: {
        version,
      },
    };

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });

    expect(mockedHandleMessage.mock.calls[0]?.[1]).toBe(message);
    expect(mockedOpenCollabDB).not.toHaveBeenCalled();

    unmount();
    doc.destroy();
  });

  it('resets unknown local version on sync request with known remote version', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectId = '55555555-5555-4555-8555-555555555555';
    const incomingVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b011';
    const doc = createDoc(objectId) as Y.Doc & { version?: string };
    const nextDoc = createDoc(objectId) as Y.Doc & { version?: string };
    nextDoc.version = incomingVersion;
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);
    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const message = {
      objectId,
      collabType: Types.Document,
      syncRequest: {
        version: incomingVersion,
      },
    };

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedOpenCollabDB).toHaveBeenCalledTimes(1);
    });

    expect(mockedOpenCollabDB).toHaveBeenCalledWith(objectId, {
      expectedVersion: incomingVersion,
      currentUser: undefined,
    });
    expect(doc.version).toBeUndefined();

    unmount();
    doc.destroy();
    nextDoc.destroy();
  });

  it('resets unknown local version on update with known remote version', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectId = '55555555-5555-4555-8555-555555555556';
    const incomingVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b012';
    const doc = createDoc(objectId) as Y.Doc & { version?: string };
    const nextDoc = createDoc(objectId) as Y.Doc & { version?: string };
    nextDoc.version = incomingVersion;
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);
    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const message = {
      objectId,
      collabType: Types.Document,
      update: {
        version: incomingVersion,
      },
    };

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedOpenCollabDB).toHaveBeenCalledTimes(1);
    });

    expect(mockedOpenCollabDB).toHaveBeenCalledWith(objectId, {
      expectedVersion: incomingVersion,
      currentUser: undefined,
    });
    expect(doc.version).toBeUndefined();

    unmount();
    doc.destroy();
    nextDoc.destroy();
  });

  it('applies only the latest version update during concurrent reset handling', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectId = '66666666-6666-4666-8666-666666666666';
    const oldVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b001';
    const supersededVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b002';
    const latestVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b003';
    const doc = createDoc(objectId) as Y.Doc & { version?: string };
    doc.version = oldVersion;
    const nextDocForSuperseded = createDoc(objectId) as Y.Doc & { version?: string };
    nextDocForSuperseded.version = supersededVersion;
    const nextDocForLatest = createDoc(objectId) as Y.Doc & { version?: string };
    nextDocForLatest.version = latestVersion;
    const firstResetOpen = createDeferred<Y.Doc>();
    const secondResetOpen = createDeferred<Y.Doc>();

    mockedOpenCollabDB
      .mockImplementationOnce(() => firstResetOpen.promise as Promise<Y.Doc>)
      .mockImplementationOnce(() => secondResetOpen.promise as Promise<Y.Doc>);

    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const supersededMessage = {
      objectId,
      collabType: Types.Document,
      update: {
        version: supersededVersion,
      },
    };
    const latestMessage = {
      objectId,
      collabType: Types.Document,
      update: {
        version: latestVersion,
      },
    };

    act(() => {
      ws.lastMessage = { collabMessage: supersededMessage } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });
    act(() => {
      ws.lastMessage = { collabMessage: latestMessage } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await act(async () => {
      firstResetOpen.resolve(nextDocForSuperseded);
      await Promise.resolve();
    });
    await act(async () => {
      secondResetOpen.resolve(nextDocForLatest);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });

    expect(mockedHandleMessage.mock.calls[0]?.[1]).toBe(latestMessage);
    expect(mockedHandleMessage.mock.calls.some(([, message]) => message === supersededMessage)).toBe(false);

    unmount();
    doc.destroy();
    nextDocForSuperseded.destroy();
    nextDocForLatest.destroy();
  });
});
