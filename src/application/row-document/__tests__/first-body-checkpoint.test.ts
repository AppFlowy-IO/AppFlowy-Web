/** @jest-environment node */
import 'fake-indexeddb/auto';
import { IndexeddbPersistence } from 'y-indexeddb';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { persistStagedBodyCheckpoint } from '../first-body-checkpoint';

async function fixture() {
  const id = uuidv4();
  const doc = new Y.Doc({ guid: id });
  const provider = new IndexeddbPersistence(id, doc);

  await provider.whenSynced;
  // The checkpoint must persist the complete body even if the ordinary
  // fire-and-forget provider write did not succeed.
  doc.off('update', provider._storeUpdate);
  doc.getText('body').insert(0, 'typed after the first recipe was sealed');
  return { id, doc, provider, marker: JSON.stringify({ version: 1, documentId: id, changes: [] }) };
}

async function reopen(id: string) {
  const doc = new Y.Doc({ guid: id });
  const provider = new IndexeddbPersistence(id, doc);

  await provider.whenSynced;
  return { doc, provider };
}

/** Inject a failure after a request succeeds but before its transaction commits. */
function afterMarkerWrite(callback: (transaction: IDBTransaction) => void) {
  const original = IDBObjectStore.prototype.put;

  return jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    const request = original.call(this, value, key);

    if (this.name === 'custom' && typeof key === 'string' && key.endsWith('/first-body-stage')) {
      request.addEventListener('success', () => callback(this.transaction));
    }

    return request;
  });
}

afterEach(() => jest.restoreAllMocks());

it('commits the complete canonical body and exact staging marker together before reopening', async () => {
  const { id, doc, provider, marker } = await fixture();
  const controller = new AbortController();
  let reopened: Awaited<ReturnType<typeof reopen>> | undefined;

  try {
    await persistStagedBodyCheckpoint(doc, provider, marker, {
      assertCurrent: () => undefined,
      signal: controller.signal,
    });
    await provider.destroy();
    reopened = await reopen(id);
    expect(reopened.doc.getText('body').toString()).toBe(doc.getText('body').toString());
    expect(await reopened.provider.get(`${id}/first-body-stage`)).toBe(marker);
  } finally {
    await (reopened?.provider ?? provider).clearData();
    reopened?.doc.destroy();
    doc.destroy();
  }
});

it.each(['transaction abort', 'owner replacement', 'request cancellation'] as const)(
  'retains neither checkpoint bytes nor a matching marker after %s before commit',
  async (failure) => {
    const { id, doc, provider, marker } = await fixture();
    const controller = new AbortController();
    let current = true;
    let reopened: Awaited<ReturnType<typeof reopen>> | undefined;
    const injected = jest.fn((transaction: IDBTransaction) => {
      if (failure === 'transaction abort') transaction.abort();
      else if (failure === 'owner replacement') current = false;
      else controller.abort(new Error('The owning request was cancelled.'));
    });

    afterMarkerWrite(injected);
    try {
      await expect(
        persistStagedBodyCheckpoint(doc, provider, marker, {
          assertCurrent: () => {
            if (!current) throw new Error('The owning account changed.');
          },
          signal: controller.signal,
        })
      ).rejects.toThrow();
      expect(injected).toHaveBeenCalledTimes(1);
      await provider.destroy();
      reopened = await reopen(id);
      expect(reopened.doc.getText('body').toString()).toBe('');
      expect(await reopened.provider.get(`${id}/first-body-stage`)).toBeUndefined();
    } finally {
      await (reopened?.provider ?? provider).clearData();
      reopened?.doc.destroy();
      doc.destroy();
    }
  }
);

it('refuses an already cancelled request before opening a checkpoint transaction', async () => {
  const { doc, provider, marker } = await fixture();
  const controller = new AbortController();

  controller.abort(new Error('The request expired.'));
  const transaction = jest.spyOn(provider.db!, 'transaction');

  try {
    await expect(
      persistStagedBodyCheckpoint(doc, provider, marker, {
        assertCurrent: () => undefined,
        signal: controller.signal,
      })
    ).rejects.toThrow('The request expired.');
    expect(transaction).not.toHaveBeenCalled();
  } finally {
    transaction.mockRestore();
    await provider.clearData();
    doc.destroy();
  }
});
