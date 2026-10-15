import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import * as atomic from '@/application/atomic-creation';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap, getMetaJSON } from '@/application/database-yjs/row_meta';
import {
  closeCollabDB,
  db,
  deleteCollabDB,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import { getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { YDoc } from '@/application/types';

import { prepareAtomicRowFirstBody } from '../atomic-first-body';
import { compileFirstBodyActions, createFirstBodyDraft } from '../first-body-actions';
import { FirstBodyStaging } from '../first-body-staging';

jest.mock('@/application/atomic-creation', () => ({
  captureAtomicCreationOwner: jest.fn(),
  assertAtomicCreationAvailable: jest.fn(),
  atomicRead: jest.fn(),
  findPendingAtomicCreation: jest.fn(),
  recoverAtomicCreation: jest.fn(),
  runAtomicCreation: jest.fn(),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

beforeAll(() =>
  Object.assign(globalThis, {
    TextEncoder,
    structuredClone: (value: unknown) => deserialize(serialize(value)),
  })
);
afterAll(() => db.close());

it.each([
  { version: undefined, empty: false },
  { version: '22222222-2222-4222-8222-222222222222', empty: false },
  { version: undefined, empty: true },
  { version: '22222222-2222-4222-8222-222222222222', empty: true },
])(
  'reopens a published document and current Row metadata from real IndexedDB (version=$version, empty=$empty)',
  async ({ version, empty }) => {
    const databaseId = uuidv4();
    const rowId = uuidv4();
    const viewId = uuidv4();
    const documentId = getMetaIdMap(rowId).get(RowMetaKey.DocumentId)!;
    const database = new Y.Doc({ guid: databaseId }) as YDoc;
    const row = new Y.Doc({ guid: rowId }) as YDoc;
    const document = createFirstBodyDraft(documentId);
    const rows = new Y.Array<unknown>();

    rows.push([{ id: rowId }]);
    database.getMap('data').set(
      'database',
      new Y.Map<unknown>([
        ['id', databaseId],
        ['views', new Y.Map([[viewId, new Y.Map([['row_orders', rows]])]])],
      ])
    );
    row.getMap('data').set(
      'data',
      new Y.Map([
        ['id', rowId],
        ['database_id', databaseId],
      ])
    );
    row.getMap('data').set('meta', new Y.Map([[getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty)!, empty]]));
    const texts = document.getMap('data').get('document').get('meta').get('text_map') as Y.Map<Y.Text>;

    if (!empty) Array.from(texts.values())[0].insert(0, 'durable first body');
    row.version = version;
    document.version = version;
    const liveRow = await openRowCollabDBWithProvider(rowId, { awaitSync: true });

    // This simulates an authoritative source already learned in memory. The
    // production publication must retain that version when the cache reopens.
    liveRow.doc.version = version;
    jest.mocked(atomic.captureAtomicCreationOwner).mockImplementation((workspaceId, assertCurrent) => ({
      workspaceId,
      serverUrl: 'test-owned',
      userId: 'test-owned',
      assertCurrent: () => assertCurrent?.(),
    }));
    jest.mocked(atomic.findPendingAtomicCreation).mockResolvedValue(undefined);
    jest.mocked(atomic.atomicRead).mockImplementation(async (_owner, path) => {
      if (path.endsWith('restore-state')) return { database_restore_id: null, version: null } as never;
      const current = path.endsWith(databaseId) ? database : path.endsWith(rowId) ? row : document;

      return {
        object_id: current.guid,
        doc_state: Array.from(Y.encodeStateAsUpdate(current)),
        version: 0,
        collab_version: current.version ?? null,
      } as never;
    });
    const receipt = {
      request_id: uuidv4(),
      outcome: 'applied',
      result: {
        database_id: databaseId,
        row_id: rowId,
        document_id: documentId,
        database_restore_id: '00000000-0000-0000-0000-000000000000',
        row_version: version ?? null,
        document_version: version ?? null,
        update_batch_id: uuidv4(),
      },
    };
    jest
      .mocked(atomic.runAtomicCreation)
      .mockImplementation(async ({ hydrate, owner }) => hydrate(receipt as never, owner));
    const session = await prepareAtomicRowFirstBody({
      workspaceId: 'test-owned-workspace',
      documentId,
      databaseDoc: database,
      rowDoc: liveRow.doc,
      source: { database_id: databaseId, database_view_id: viewId, row_id: rowId },
      name: '',
      assertWritable: () => undefined,
    });

    try {
      const canonical = await (empty ? session.createEmpty() : session.publish(compileFirstBodyActions(document)));

      expect(canonical.version).toBe(version);
      await closeCollabDB(documentId);
      await closeCollabDB(rowId);
      const reopened = await getOrCreateRowSubDoc(documentId);
      const reopenedRow = await openRowCollabDBWithProvider(rowId, { awaitSync: true });
      const documentEntry = await openCollabDBWithProvider(documentId, { awaitSync: true });

      expect(reopened).not.toBe(canonical);
      expect(reopened.version).toBe(version);
      expect(reopenedRow.doc.version).toBe(version);
      expect(reopened.getMap('data').toJSON()).toEqual(document.getMap('data').toJSON());
      expect(getMetaJSON(rowId, reopenedRow.doc.getMap('data').get('meta') as Y.Map<unknown>).isEmptyDocument).toBe(
        empty
      );
      expect(await documentEntry.provider.get(`${documentId}/version`)).toBe(version);
      if (empty) return;

      // Keep a separately durable staged edit beside the exact first recipe,
      // then recover it through the real Row publication after IDB reopens.
      const draft = new Y.Doc({ guid: documentId });

      Y.applyUpdate(draft, Y.encodeStateAsUpdate(document));
      const staging = new FirstBodyStaging(draft, () => undefined);
      const stagedText = draft.getMap('data').get('document').get('meta').get('text_map') as Y.Map<Y.Text>;

      Array.from(stagedText.values())[0].insert('durable first body'.length, ' typed while ACK was held');
      staging.stop();
      const record: atomic.AtomicCreationRecord<'row-document'> = {
        id: `test-row-${documentId}`,
        kind: 'row-document',
        serverUrl: 'test-owned',
        userId: 'test-owned',
        workspaceId: 'test-owned-workspace',
        logicalTarget: documentId,
        requestId: receipt.request_id,
        requestJson: JSON.stringify({ request_id: receipt.request_id, contribution: compileFirstBodyActions(document) }),
        receiptJson: JSON.stringify(receipt),
        state: 'committed',
        createdAt: Date.now(),
        rowDocumentStagingJson: staging.json,
      };

      await db.atomic_creation.put(record);
      db.close();
      await db.open();
      jest
        .mocked(atomic.findPendingAtomicCreation)
        .mockResolvedValue((await db.atomic_creation.get(record.id)) as never);
      jest.mocked(atomic.recoverAtomicCreation).mockImplementation(async ({ onPrepared, hydrate, owner, record }) => {
        await onPrepared?.(record);
        const hydrated = await hydrate(receipt as never, owner);

        // The application must finish the provider barrier before journal cleanup.
        const entry = await openCollabDBWithProvider(documentId, { awaitSync: true });

        expect(await entry.provider.get(`${documentId}/first-body-stage`)).toBe(staging.json);
        expect((await db.atomic_creation.get(record.id))?.requestJson).toBe(record.requestJson);
        await db.atomic_creation.delete(record.id);
        return hydrated;
      });
      const recovery = await prepareAtomicRowFirstBody({
        workspaceId: 'test-owned-workspace',
        documentId,
        databaseDoc: database,
        rowDoc: reopenedRow.doc,
        source: { database_id: databaseId, database_view_id: viewId, row_id: rowId },
        name: '',
        assertWritable: () => undefined,
      });

      // The create-on-open entry point must resume authored work from an older
      // client instead of replacing it with the new empty-schema recipe.
      await recovery.createEmpty();
      recovery.dispose();
      await closeCollabDB(documentId);
      const reopenedStaged = await getOrCreateRowSubDoc(documentId);

      expect(reopenedStaged.getMap('data').toJSON()).toEqual(draft.getMap('data').toJSON());
      expect(await db.atomic_creation.get(record.id)).toBeUndefined();
      draft.destroy();
    } finally {
      session.dispose();
      await Promise.all([deleteCollabDB(documentId), deleteCollabDB(rowId)]);
      [database, row, document].forEach((doc) => doc.destroy());
    }
  }
);
