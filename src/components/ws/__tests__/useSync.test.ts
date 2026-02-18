import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { Types } from '@/application/types';

import { BroadcastChannelType } from '../useBroadcastChannel';
import { AppflowyWebSocketType } from '../useAppflowyWebSocket';
import { useSync } from '../useSync';

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
});
