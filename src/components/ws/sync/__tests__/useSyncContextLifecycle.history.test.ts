import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { bindSyncContext, handleMessage, SyncContext } from '@/application/services/js-services/sync-protocol';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import { Types, YDoc, YjsEditorKey } from '@/application/types';

import { useSyncRefs } from '../syncRefs';
import { useSyncContextLifecycle } from '../useSyncContextLifecycle';

jest.mock('@/application/sync-outbox', () => ({
  waitForDrain: async () => true, deleteOutboxByObjectId: async () => undefined,
  enqueueOutboxUpdate: jest.fn(async () => true), shouldRouteUpdateThroughOutbox: () => false,
}));

const objectId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => { jest.clearAllMocks(); });

test('initial/reconnect manifests wait for verification and obsolete contexts cannot emit after it', async () => {
  let permit!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => { permit = resolve; });
  const beforeSend = jest.fn(() => pending);
  const send = jest.fn();
  const broadcast = jest.fn();
  const { result } = renderHook(() => {
    const refs = useSyncRefs();

    return useSyncContextLifecycle(refs, send, broadcast, undefined, undefined, beforeSend);
  });
  const oldDoc = new Y.Doc({ guid: objectId });
  const newDoc = new Y.Doc({ guid: objectId });

  act(() => { result.current.registerSyncContext({ doc: oldDoc, collabType: Types.Database }); });
  expect(send).not.toHaveBeenCalled();
  act(() => { result.current.registerSyncContext({ doc: newDoc, collabType: Types.Database }); });
  await act(async () => permit(true));
  expect(beforeSend).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
  expect(broadcast).toHaveBeenCalledTimes(1);
  oldDoc.destroy();
  newDoc.destroy();
});

test.each([Types.Database, Types.DatabaseRow])(
  'retired editor callbacks cannot send updates or enqueue edits after replacing collab type %s',
  async (collabType) => {
    let permit!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { permit = resolve; });
    const beforeSend = jest.fn(() => pending);
    const send = jest.fn();
    const broadcast = jest.fn();
    const { result, unmount } = renderHook(() => {
      const refs = useSyncRefs();

      return useSyncContextLifecycle(refs, send, broadcast, undefined, undefined, beforeSend);
    });
    const oldDoc: YDoc = new Y.Doc({ guid: objectId });
    const newDoc: YDoc = new Y.Doc({ guid: objectId });

    oldDoc.databaseRestoreId = 'old-generation';
    oldDoc.getMap(YjsEditorKey.data_section).set('title', 'retired content');
    newDoc.databaseRestoreId = 'restored-generation';
    newDoc.getMap(YjsEditorKey.data_section).set('title', 'restored content');
    let oldContext!: SyncContext;
    let newContext!: SyncContext;
    const request = { objectId, collabType, syncRequest: { stateVector: Uint8Array.of(0) } };

    act(() => {
      oldContext = result.current.registerSyncContext({ doc: oldDoc, collabType });
      handleMessage(oldContext, request);
      newContext = result.current.registerSyncContext({ doc: newDoc, collabType });
    });
    // Even an earlier authority read that resumes with true cannot send the retired reply.
    await act(async () => permit(true));
    expect(send.mock.calls.every(([message]) => !message.collabMessage.update)).toBe(true);
    expect(broadcast.mock.calls.every(([message]) => !message.collabMessage.update)).toBe(true);
    send.mockClear();
    broadcast.mockClear();

    await act(async () => {
      bindSyncContext(oldContext);
      handleMessage(oldContext, request);
      oldDoc.getMap(YjsEditorKey.data_section).set('title', 'late stale editor edit');
    });
    expect(send).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(enqueueOutboxUpdate).not.toHaveBeenCalled();

    await act(async () => {
      handleMessage(newContext, request);
      newDoc.getMap(YjsEditorKey.data_section).set('title', 'fresh edit');
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].collabMessage.update.databaseRestoreId).toBe('restored-generation');
    expect(broadcast).toHaveBeenCalledWith(send.mock.calls[0][0]);
    expect(enqueueOutboxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      objectId, collabType, databaseRestoreId: 'restored-generation',
    }));
    oldDoc.destroy();
    newDoc.destroy();
    unmount();
  }
);
