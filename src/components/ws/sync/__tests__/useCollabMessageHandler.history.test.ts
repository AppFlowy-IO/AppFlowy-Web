import EventEmitter from 'events';

import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { deleteCollabDB } from '@/application/db';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';

import { useSyncRefs } from '../syncRefs';
import { useCollabMessageHandler } from '../useCollabMessageHandler';

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn(async () => true) }));
jest.mock('@/application/database-blob', () => ({ invalidateDatabaseRowDocSeed: jest.fn() }));
jest.mock('@/application/services/js-services/cache', () => ({ cacheCanonicalRowDoc: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({}));

const objectId = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

test.each([Types.Database, Types.DatabaseRow])(
  'revokes access to collab type %s even when restore verification is denied and a version is known',
  async (collabType) => {
    const doc = new Y.Doc({ guid: objectId }) as YDoc;

    doc.version = version;
    const destroyed = jest.fn();

    doc.on('destroy', destroyed);
    const discardPendingUpdates = jest.fn(async () => undefined);
    const flush = jest.fn(async () => true);
    const context: SyncContext = { doc, collabType, emit: jest.fn(), discardPendingUpdates, flush };
    const beforeApply = jest.fn(async () => false);
    const { result } = renderHook(() => {
      const refs = useSyncRefs();

      refs.registeredContexts.current.set(objectId, context);
      return useCollabMessageHandler(refs, undefined, undefined, new EventEmitter(), jest.fn(), jest.fn(), beforeApply);
    });

    await act(async () => {
      await expect(result.current.enqueueIncomingCollabMessage({
        objectId, collabType, accessChanged: { canRead: false, canWrite: false },
      }, { requireActiveContext: true })).resolves.toBe(true);
    });

    expect(beforeApply).not.toHaveBeenCalled();
    expect(discardPendingUpdates).toHaveBeenCalledTimes(1);
    expect(deleteCollabDB).toHaveBeenCalledWith(objectId, { destroyDoc: false });
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(context.flush).toBeUndefined();
    expect(flush).not.toHaveBeenCalled();
  }
);

test('still rejects database branch updates when restore verification is denied', async () => {
  const doc = new Y.Doc({ guid: objectId }) as YDoc;
  const source = new Y.Doc();

  source.getMap('data').set('value', 'obsolete');
  const beforeApply = jest.fn(async () => false);
  const { result } = renderHook(() => {
    const refs = useSyncRefs();

    refs.registeredContexts.current.set(objectId, { doc, collabType: Types.Database, emit: jest.fn() });
    return useCollabMessageHandler(refs, undefined, undefined, new EventEmitter(), jest.fn(), jest.fn(), beforeApply);
  });

  await act(async () => {
    await expect(result.current.enqueueIncomingCollabMessage({
      objectId, collabType: Types.Database,
      update: { payload: Y.encodeStateAsUpdate(source), databaseRestoreId: version },
    })).resolves.toBe(false);
  });

  expect(beforeApply).toHaveBeenCalledWith(objectId, Types.Database, version);
  expect(doc.getMap('data').has('value')).toBe(false);
  doc.destroy();
  source.destroy();
});
