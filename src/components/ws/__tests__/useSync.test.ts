import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { openCollabDB } from '@/application/db';
import * as httpApi from '@/application/services/js-services/http/http_api';
import { handleMessage } from '@/application/services/js-services/sync-protocol';
import { Types, User } from '@/application/types';
import { Log } from '@/utils/log';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { BroadcastChannelType } from '../useBroadcastChannel';
import { AppflowyWebSocketType } from '../useAppflowyWebSocket';
import { useSync } from '../useSync';

jest.mock('@/application/db', () => {
  return {
    ...jest.requireActual('@/application/db'),
    openCollabDB: jest.fn(),
  };
});

jest.mock('@/application/services/js-services/http/http_api', () => {
  const actual = jest.requireActual('@/application/services/js-services/http/http_api');

  return {
    ...actual,
    collabFullSyncBatch: jest.fn(),
    revertCollabVersion: jest.fn(),
  };
});

jest.mock('@/application/services/js-services/sync-protocol', () => {
  const actual = jest.requireActual('@/application/services/js-services/sync-protocol');

  return {
    ...actual,
    handleMessage: jest.fn(),
  };
});

jest.mock('@/components/main/app.hooks', () => {
  const actual = jest.requireActual('@/components/main/app.hooks');

  return {
    ...actual,
    useCurrentUserOptional: jest.fn(() => undefined),
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
const mockedCollabFullSyncBatch = httpApi.collabFullSyncBatch as jest.MockedFunction<typeof httpApi.collabFullSyncBatch>;
const mockedRevertCollabVersion = httpApi.revertCollabVersion as jest.MockedFunction<typeof httpApi.revertCollabVersion>;
const mockedUseCurrentUserOptional = useCurrentUserOptional as jest.MockedFunction<typeof useCurrentUserOptional>;

const createUser = (workspaceId = 'workspace-from-user'): User => ({
  uid: 'user-1',
  uuid: '00000000-0000-4000-8000-000000000001',
  email: null,
  name: 'User One',
  avatar: null,
  latestWorkspaceId: workspaceId,
});

const resetCommonMocks = () => {
  mockedUseCurrentUserOptional.mockReturnValue(undefined);
  mockedOpenCollabDB.mockReset();
  mockedHandleMessage.mockReset();
  mockedCollabFullSyncBatch.mockReset();
  mockedRevertCollabVersion.mockReset();
};

describe('useSync deferred cleanup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetCommonMocks();
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
    resetCommonMocks();
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

  it('resets when local version is known but incoming version is missing', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectId = '44444444-4444-4444-8444-444444444445';
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b110';
    const doc = createDoc(objectId) as Y.Doc & { version?: string };
    const nextDoc = createDoc(objectId) as Y.Doc & { version?: string };
    doc.version = version;
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);

    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const message = {
      objectId,
      collabType: Types.Document,
      update: {},
    };

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedOpenCollabDB).toHaveBeenCalledTimes(1);
    });
    expect(mockedOpenCollabDB).toHaveBeenCalledWith(objectId, {
      currentUser: undefined,
      forceReset: true,
    });
    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });
    expect((nextDoc as Y.Doc & { version?: string }).version).toBeUndefined();

    unmount();
    doc.destroy();
    nextDoc.destroy();
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

  it('processes versioned updates sequentially during reset handling', async () => {
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
      expect(mockedHandleMessage).toHaveBeenCalledTimes(2);
    });

    expect(mockedHandleMessage.mock.calls[0]?.[1]).toBe(supersededMessage);
    expect(mockedHandleMessage.mock.calls[1]?.[1]).toBe(latestMessage);

    unmount();
    doc.destroy();
    nextDocForSuperseded.destroy();
    nextDocForLatest.destroy();
  });

  it('does not block other object updates when one object reset is pending', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const objectIdA = '77777777-7777-4777-8777-777777777777';
    const objectIdB = '88888888-8888-4888-8888-888888888888';
    const oldVersionA = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b101';
    const nextVersionA = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b102';
    const versionB = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b103';
    const docA = createDoc(objectIdA) as Y.Doc & { version?: string };
    const docB = createDoc(objectIdB) as Y.Doc & { version?: string };
    const nextDocA = createDoc(objectIdA) as Y.Doc & { version?: string };
    const deferredOpen = createDeferred<Y.Doc>();
    docA.version = oldVersionA;
    docB.version = versionB;
    nextDocA.version = nextVersionA;

    mockedOpenCollabDB.mockImplementationOnce(() => deferredOpen.promise as Promise<Y.Doc>);

    const { result, rerender, unmount } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc: docA, collabType: Types.Document });
      result.current.registerSyncContext({ doc: docB, collabType: Types.Document });
    });

    const resetMessageForA = {
      objectId: objectIdA,
      collabType: Types.Document,
      update: {
        version: nextVersionA,
      },
    };
    const messageForB = {
      objectId: objectIdB,
      collabType: Types.Document,
      update: {
        version: versionB,
      },
    };

    act(() => {
      ws.lastMessage = { collabMessage: resetMessageForA } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });
    act(() => {
      ws.lastMessage = { collabMessage: messageForB } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });

    expect(mockedHandleMessage.mock.calls[0]?.[1]).toBe(messageForB);

    await act(async () => {
      deferredOpen.resolve(nextDocA);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(2);
    });

    expect(mockedHandleMessage.mock.calls[1]?.[1]).toBe(resetMessageForA);

    unmount();
    docA.destroy();
    docB.destroy();
    nextDocA.destroy();
  });
});

describe('useSync notifications', () => {
  beforeEach(() => {
    jest.useRealTimers();
    resetCommonMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('forwards websocket workspace notifications to app events', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const eventEmitter = new EventEmitter();
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const notification = {
      profileChange: { uid: '1' },
      permissionChanged: { objectId: 'obj-1' },
      sectionChanged: { changed: true },
      shareViewsChanged: { viewId: 'view-1' },
      mentionablePersonListChanged: { count: 1 },
      serverLimit: { limit: 'x' },
      workspaceMemberProfileChanged: { uid: '2' },
      folderChanged: { id: 'folder' },
      folderViewChanged: { id: 'view' },
    };
    const { rerender } = renderHook(() => useSync(ws, bc, eventEmitter));

    act(() => {
      ws.lastMessage = { notification } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.USER_PROFILE_CHANGED, notification.profileChange);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.PERMISSION_CHANGED, notification.permissionChanged);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.SECTION_CHANGED, notification.sectionChanged);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.SHARE_VIEWS_CHANGED, notification.shareViewsChanged);
    expect(emitSpy).toHaveBeenCalledWith(
      APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED,
      notification.mentionablePersonListChanged
    );
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.SERVER_LIMIT_CHANGED, notification.serverLimit);
    expect(emitSpy).toHaveBeenCalledWith(
      APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED,
      notification.workspaceMemberProfileChanged
    );
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.FOLDER_OUTLINE_CHANGED, notification.folderChanged);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.FOLDER_VIEW_CHANGED, notification.folderViewChanged);
  });

  it('forwards broadcast workspace notifications to app events', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const eventEmitter = new EventEmitter();
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const notification = {
      profileChange: { uid: '1' },
      folderChanged: { id: 'folder' },
      folderViewChanged: { id: 'view' },
    };
    const { rerender } = renderHook(() => useSync(ws, bc, eventEmitter));

    act(() => {
      bc.lastBroadcastMessage = { notification } as BroadcastChannelType['lastBroadcastMessage'];
      rerender();
    });

    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.USER_PROFILE_CHANGED, notification.profileChange);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.FOLDER_OUTLINE_CHANGED, notification.folderChanged);
    expect(emitSpy).toHaveBeenCalledWith(APP_EVENTS.FOLDER_VIEW_CHANGED, notification.folderViewChanged);
  });
});

describe('useSync public API', () => {
  beforeEach(() => {
    jest.useRealTimers();
    resetCommonMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws when registering a doc with invalid guid', () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('not-a-uuid');
    const { result } = renderHook(() => useSync(ws, bc));

    expect(() => {
      act(() => {
        result.current.registerSyncContext({ doc, collabType: Types.Document });
      });
    }).toThrow('Invalid Y.Doc guid');
  });

  it('replaces stale sync context when same guid is re-registered with different doc instance', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const guid = '99999999-9999-4999-8999-999999999999';
    const docA = createDoc(guid) as Y.Doc & { version?: string };
    const docB = createDoc(guid) as Y.Doc & { version?: string };
    docA.version = undefined;
    docB.version = undefined;
    const { result, rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc: docA, collabType: Types.Document });
      result.current.registerSyncContext({ doc: docB, collabType: Types.Document });
    });

    const message = {
      objectId: guid,
      collabType: Types.Document,
      update: {},
    };

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });

    expect(mockedHandleMessage.mock.calls[0]?.[0]?.doc).toBe(docB);
  });

  it('flushAllSync flushes pending updates for all registered contexts', () => {
    jest.useFakeTimers();

    const ws = createWs();
    const bc = createBroadcastChannel();
    const docA = createDoc('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const docB = createDoc('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const sendMessage = ws.sendMessage as jest.Mock;
    const { result } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc: docA, collabType: Types.Document });
      result.current.registerSyncContext({ doc: docB, collabType: Types.Document });
    });
    sendMessage.mockClear();

    act(() => {
      docA.getMap('root').set('a', 1);
      docB.getMap('root').set('b', 2);
    });

    act(() => {
      result.current.flushAllSync();
    });

    const updateCalls = sendMessage.mock.calls.filter((call) => call[0]?.collabMessage?.update);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls.map((call) => call[0].collabMessage.objectId).sort()).toEqual([docA.guid, docB.guid].sort());

    jest.useRealTimers();
  });

  it('syncAllToServer sends one batch for all registered contexts', async () => {
    mockedCollabFullSyncBatch.mockResolvedValueOnce(undefined);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const docA = createDoc('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const docB = createDoc('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const { result } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc: docA, collabType: Types.Document });
      result.current.registerSyncContext({ doc: docB, collabType: Types.DatabaseRow });
    });

    await act(async () => {
      await result.current.syncAllToServer('workspace-sync');
    });

    expect(mockedCollabFullSyncBatch).toHaveBeenCalledTimes(1);
    const [workspaceId, items] = mockedCollabFullSyncBatch.mock.calls[0]!;

    expect(workspaceId).toBe('workspace-sync');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.objectId).sort()).toEqual([docA.guid, docB.guid].sort());
    expect(items.every((item) => item.stateVector instanceof Uint8Array)).toBe(true);
    expect(items.every((item) => item.docState instanceof Uint8Array)).toBe(true);
  });

  it('syncAllToServer tolerates batch API errors', async () => {
    mockedCollabFullSyncBatch.mockRejectedValueOnce(new Error('network failure'));
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    const { result } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    await expect(result.current.syncAllToServer('workspace-sync')).resolves.toBeUndefined();
    expect(mockedCollabFullSyncBatch).toHaveBeenCalledTimes(1);
  });
});

describe('useSync queue guards and dedupe', () => {
  beforeEach(() => {
    jest.useRealTimers();
    resetCommonMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deduplicates websocket message processing by reference', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f1111111-1111-4111-8111-111111111111') as Y.Doc & { version?: string };
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b301';
    doc.version = version;
    const message = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: { version },
    };
    const { result, rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });
    await waitFor(() => expect(mockedHandleMessage).toHaveBeenCalledTimes(1));

    act(() => {
      ws.lastMessage = { collabMessage: message } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => expect(mockedHandleMessage).toHaveBeenCalledTimes(1));
  });

  it('deduplicates broadcast message processing by reference', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f2222222-2222-4222-8222-222222222222') as Y.Doc & { version?: string };
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b302';
    doc.version = version;
    const message = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: { version },
    };
    const { result, rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
      bc.lastBroadcastMessage = { collabMessage: message } as BroadcastChannelType['lastBroadcastMessage'];
      rerender();
    });
    await waitFor(() => expect(mockedHandleMessage).toHaveBeenCalledTimes(1));

    act(() => {
      bc.lastBroadcastMessage = { collabMessage: message } as BroadcastChannelType['lastBroadcastMessage'];
      rerender();
    });

    await waitFor(() => expect(mockedHandleMessage).toHaveBeenCalledTimes(1));
  });

  it('skips queueing messages that do not have objectId', async () => {
    const warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const { rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      ws.lastMessage = {
        collabMessage: {
          collabType: Types.Document,
          update: {},
        },
      } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        'Received collab message without objectId; skipped queueing',
        expect.objectContaining({ collabType: Types.Document })
      );
    });
    expect(mockedHandleMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('continues processing queued messages after one apply throws', async () => {
    const errorSpy = jest.spyOn(Log, 'error').mockImplementation(() => undefined);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f3333333-3333-4333-8333-333333333333') as Y.Doc & { version?: string };
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b303';
    doc.version = version;
    mockedHandleMessage
      .mockImplementationOnce(() => {
        throw new Error('first apply failed');
      })
      .mockImplementation(() => undefined);
    const { result, rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    const message1 = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: { version },
    };
    const message2 = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: { version, messageId: { timestamp: Date.now(), counter: 1 } },
    };

    act(() => {
      ws.lastMessage = { collabMessage: message1 } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });
    act(() => {
      ws.lastMessage = { collabMessage: message2 } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(2);
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('updates lastUpdatedCollab with server timestamp', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f4444444-4444-4444-8444-444444444444') as Y.Doc & { version?: string };
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b304';
    const timestamp = Date.now();
    doc.version = version;
    const { result, rerender } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    act(() => {
      ws.lastMessage = {
        collabMessage: {
          objectId: doc.guid,
          collabType: Types.Document,
          update: {
            version,
            messageId: { timestamp, counter: 0 },
          },
        },
      } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(result.current.lastUpdatedCollab).not.toBeNull();
    });
    expect(result.current.lastUpdatedCollab).toEqual(
      expect.objectContaining({
        objectId: doc.guid,
        collabType: Types.Document,
      })
    );
    expect(result.current.lastUpdatedCollab?.publishedAt?.getTime()).toBe(timestamp);
  });
});

describe('useSync revertCollabVersion', () => {
  beforeEach(() => {
    jest.useRealTimers();
    resetCommonMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws when sync context or active workspace is unavailable', async () => {
    const ws = createWs();
    const bc = createBroadcastChannel();
    const { result } = renderHook(() => useSync(ws, bc));

    await expect(result.current.revertCollabVersion('missing', '018f2f9e-3f04-7c8d-8a2e-8df6dff4b401')).rejects.toThrow(
      'Unable to restore version: sync context is unavailable'
    );
  });

  it('reverts successfully with explicit workspace id and emits reset event', async () => {
    const user = createUser('workspace-from-user');
    mockedUseCurrentUserOptional.mockReturnValue(user);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const eventEmitter = new EventEmitter();
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const doc = createDoc('f5555555-5555-4555-8555-555555555555') as Y.Doc & {
      version?: string;
      object_id?: string;
      view_id?: string;
      _collabType?: Types;
      _syncBound?: boolean;
    };
    const nextDoc = createDoc(doc.guid) as typeof doc;
    const targetVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b402';
    const serverVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b403';
    const snapshotDoc = createDoc('f5555555-5555-4555-8555-555555555556');

    doc.version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b400';
    doc.object_id = doc.guid;
    doc.view_id = doc.guid;
    doc._collabType = Types.Document;
    doc._syncBound = true;
    snapshotDoc.getMap('root').set('k', 'v');

    mockedRevertCollabVersion.mockResolvedValueOnce({
      stateVector: new Uint8Array(),
      docState: Y.encodeStateAsUpdate(snapshotDoc),
      version: serverVersion,
    });
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);

    const { result } = renderHook(() => useSync(ws, bc, eventEmitter, 'workspace-from-prop'));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    await act(async () => {
      await result.current.revertCollabVersion(doc.guid, targetVersion);
    });

    expect(mockedRevertCollabVersion).toHaveBeenCalledWith(
      'workspace-from-prop',
      doc.guid,
      Types.Document,
      targetVersion
    );
    expect(mockedOpenCollabDB).toHaveBeenCalledWith(doc.guid, {
      expectedVersion: serverVersion,
      currentUser: user.uid,
    });
    expect(nextDoc.object_id).toBe(doc.object_id);
    expect(nextDoc.view_id).toBe(doc.view_id);
    expect(nextDoc._collabType).toBe(doc._collabType);
    expect(nextDoc._syncBound).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      APP_EVENTS.COLLAB_DOC_RESET,
      expect.objectContaining({
        objectId: doc.guid,
        viewId: doc.view_id,
        doc: nextDoc,
      })
    );
  });

  it('uses currentUser.latestWorkspaceId and requested version when server version is missing', async () => {
    const user = createUser('workspace-from-user');
    mockedUseCurrentUserOptional.mockReturnValue(user);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f6666666-6666-4666-8666-666666666666') as Y.Doc & { version?: string };
    const nextDoc = createDoc(doc.guid) as Y.Doc & { version?: string };
    const targetVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b404';

    doc.version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b405';
    mockedRevertCollabVersion.mockResolvedValueOnce({
      stateVector: new Uint8Array(),
      docState: Y.encodeStateAsUpdate(createDoc('f6666666-6666-4666-8666-666666666667')),
      version: null,
    });
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);
    const { result } = renderHook(() => useSync(ws, bc));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    await act(async () => {
      await result.current.revertCollabVersion(doc.guid, targetVersion);
    });

    expect(mockedRevertCollabVersion).toHaveBeenCalledWith(
      user.latestWorkspaceId,
      doc.guid,
      Types.Document,
      targetVersion
    );
    expect(mockedOpenCollabDB).toHaveBeenCalledWith(doc.guid, {
      expectedVersion: targetVersion,
      currentUser: user.uid,
    });
  });

  it('restores previous sync context when openCollabDB fails during revert', async () => {
    const user = createUser('workspace-from-user');
    mockedUseCurrentUserOptional.mockReturnValue(user);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f7777777-7777-4777-8777-777777777777') as Y.Doc & { version?: string };
    const version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b406';
    const targetVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b407';
    const openError = new Error('open failed');
    const { result, rerender } = renderHook(() => useSync(ws, bc, undefined, 'workspace-from-prop'));

    doc.version = version;
    mockedRevertCollabVersion.mockResolvedValueOnce({
      stateVector: new Uint8Array(),
      docState: Y.encodeStateAsUpdate(createDoc('f7777777-7777-4777-8777-777777777778')),
      version: targetVersion,
    });
    mockedOpenCollabDB.mockRejectedValueOnce(openError);

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    await expect(result.current.revertCollabVersion(doc.guid, targetVersion)).rejects.toBe(openError);

    const postFailureMessage = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: { version },
    };

    act(() => {
      ws.lastMessage = { collabMessage: postFailureMessage } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalledTimes(1);
    });
    expect(mockedHandleMessage.mock.calls[0]?.[0]?.doc).toBe(doc);
  });

  it('replays incoming messages queued during revert after replacement context is ready', async () => {
    const user = createUser('workspace-from-user');
    mockedUseCurrentUserOptional.mockReturnValue(user);
    const ws = createWs();
    const bc = createBroadcastChannel();
    const doc = createDoc('f8888888-8888-4888-8888-888888888888') as Y.Doc & { version?: string };
    const nextDoc = createDoc(doc.guid) as Y.Doc & { version?: string };
    const targetVersion = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b408';
    const revertDeferred = createDeferred<Awaited<ReturnType<typeof httpApi.revertCollabVersion>>>();
    const queuedMessage = {
      objectId: doc.guid,
      collabType: Types.Document,
      update: {
        version: targetVersion,
      },
    };
    let revertPromise!: Promise<void>;

    doc.version = '018f2f9e-3f04-7c8d-8a2e-8df6dff4b409';
    nextDoc.version = targetVersion;
    mockedRevertCollabVersion.mockImplementationOnce(() => revertDeferred.promise);
    mockedOpenCollabDB.mockResolvedValueOnce(nextDoc as Y.Doc);

    const { result, rerender } = renderHook(() => useSync(ws, bc, undefined, 'workspace-from-prop'));

    act(() => {
      result.current.registerSyncContext({ doc, collabType: Types.Document });
    });

    act(() => {
      revertPromise = result.current.revertCollabVersion(doc.guid, targetVersion);
    });

    act(() => {
      ws.lastMessage = { collabMessage: queuedMessage } as AppflowyWebSocketType['lastMessage'];
      rerender();
    });

    await act(async () => {
      revertDeferred.resolve({
        stateVector: new Uint8Array(),
        docState: Y.encodeStateAsUpdate(createDoc('f8888888-8888-4888-8888-888888888889')),
        version: targetVersion,
      });
      await revertPromise;
    });

    await waitFor(() => {
      expect(mockedHandleMessage).toHaveBeenCalled();
    });
    expect(mockedHandleMessage.mock.calls.some(([, message]) => message === queuedMessage)).toBe(true);
  });
});
