import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { Types } from '@/application/types';

import { useSyncRefs } from '../syncRefs';
import { useSyncContextLifecycle } from '../useSyncContextLifecycle';

jest.mock('@/application/sync-outbox', () => ({
  waitForDrain: async () => true, deleteOutboxByObjectId: async () => undefined,
  enqueueOutboxUpdate: async () => true, shouldRouteUpdateThroughOutbox: () => false,
}));

const objectId = '11111111-1111-4111-8111-111111111111';

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
