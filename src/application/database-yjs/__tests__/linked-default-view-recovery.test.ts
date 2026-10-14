import 'fake-indexeddb/auto';
import { createEditor, Element } from 'slate';
import { deserialize, serialize } from 'v8';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  captureAtomicCreationOwner,
  findPendingAtomicCreation,
  parseAtomicCreationRequest,
  recoverAtomicCreation,
  runAtomicCreation,
  type CreateDefaultDatabaseViewRequest,
} from '@/application/atomic-creation';
import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { createLinkedDefaultDatabaseView } from '@/application/database-yjs/creation/create-linked-default-view';
import { db } from '@/application/db';
import { postAtomicCreation } from '@/application/services/js-services/http/atomic-creation-api';
import { saveGoTrueAuth } from '@/application/session/token';
import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, DatabaseViewLayout, YDoc, YjsEditorKey } from '@/application/types';
import {
  captureBlockCreationTarget,
  captureExistingDatabaseBlock,
} from '@/components/editor/utils/block-creation-target';
import { updateServerInfo } from '@/utils/server-info';

jest.mock('@/application/sync-outbox', () => ({
  purgeAllOutbox: jest.fn(async () => undefined),
  getCurrentOutboxSession: () => ({ userId: 'user', workspaceId: 'workspace' }),
  getCurrentOutboxSessionGeneration: () => 1,
}));
jest.mock('slate-react', () => {
  const actual = jest.requireActual('slate-react');

  return { ...actual, ReactEditor: { ...actual.ReactEditor, focus: jest.fn() } };
});
jest.mock('@/application/services/js-services/http/atomic-creation-api', () => ({ postAtomicCreation: jest.fn() }));
jest.mock('@/application/database-yjs/creation/create-default-view', () => ({ createDefaultDatabaseView: jest.fn() }));

const logicalTarget = 'same-linked-insert';
const command = (): CreateDefaultDatabaseViewRequest => ({
  schema_version: 'v1',
  request_id: uuidv4(),
  database_restore_id: '00000000-0000-0000-0000-000000000000',
  view: {
    database_id: 'database',
    view_id: uuidv4(),
    parent_view_id: 'document',
    source_view_id: 'source',
    layout: DatabaseViewLayout.Grid,
    name: 'Linked',
    embedded: true,
    responses_view_id: null,
    timezone_id: null,
  },
});

beforeAll(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) });
});
beforeEach(async () => {
  jest.clearAllMocks();
  await db.atomic_creation.clear();
  saveGoTrueAuth(
    JSON.stringify({
      user: { id: 'user' },
      access_token: 'owned-test-token',
      refresh_token: 'owned-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  updateServerInfo('https://test.appflowy.cloud', {
    status: 'available',
    info: {
      enable_page_history: true,
      enable_atomic_creation: true,
      enable_atomic_creation_defaults: true,
    },
  });
  jest.mocked(postAtomicCreation).mockImplementation(async (_owner, _kind, json) => {
    const request = JSON.parse(json) as CreateDefaultDatabaseViewRequest;

    return {
      request_id: request.request_id,
      outcome: 'applied',
      result: {
        view_id: request.view.view_id,
        database_id: 'database',
        view_ids: [request.view.view_id],
        database_restore_id: request.database_restore_id,
        database_version: null,
        update_batch_id: uuidv4(),
        database_update_v1: 'AAA=',
      },
    } as never;
  });
  // Keep the real durable journal/recovery state machine. Other component
  // suites prove canonical Database reads; this boundary models their result.
  jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
    const owner = captureAtomicCreationOwner(intent.workspaceId, intent.assertCurrent);
    const pending = await findPendingAtomicCreation(owner, 'database-view', logicalTarget);
    const request = pending ? parseAtomicCreationRequest(pending) : command();
    const hydrate = async () => {
      owner.assertCurrent();
      await intent.activate?.(request.view.view_id);
      owner.assertCurrent();
      return request.view.view_id;
    };

    return pending
      ? recoverAtomicCreation({ owner, record: pending, hydrate })
      : runAtomicCreation({ owner, kind: 'database-view', request, logicalTarget, hydrate });
  });
});
afterAll(() => db.close());

it.each(['attached', 'pending', 'committed'] as const)(
  'recovers an old %s receipt without crossing block intents',
  async (state) => {
    const attached = state === 'attached';
    const source = new Y.Doc({ guid: 'database' }) as YDoc;
    const document = withTestingYDoc('document');

    slateContentInsertToYData(
      'document',
      0,
      [
        {
          type: BlockType.Paragraph,
          data: {},
          children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
        } as Element,
      ],
      document
    );
    const editor = withYjs(createEditor(), document, { readOnly: false, localOrigin: CollabOrigin.Local });

    editor.connect();
    const original = command();
    const owner = captureAtomicCreationOwner('workspace');

    if (state === 'pending') jest.mocked(postAtomicCreation).mockRejectedValueOnce(new Error('reply lost'));
    await expect(
      runAtomicCreation({
        owner,
        kind: 'database-view',
        request: original,
        logicalTarget,
        hydrate: async () => {
          throw new Error('old paragraph owner retired');
        },
      })
    ).rejects.toThrow();
    const [record] = await db.atomic_creation.toArray();

    expect(record.state).toBe(state === 'pending' ? 'pending' : 'committed');
    let targetId = editor.children[0].blockId!;

    if (attached) {
      const existingId = CustomEditor.turnToBlock(editor, targetId, BlockType.GridBlock, {
        parent_id: 'document',
        database_id: 'database',
        view_ids: [original.view.view_id],
      })!;

      targetId = CustomEditor.addBelowBlock(editor, existingId, BlockType.Paragraph, {})!;
    }
    const target = captureBlockCreationTarget(editor, targetId);
    const activate = jest.fn(async (id: string) =>
      target.replace((blockId) =>
        CustomEditor.turnToBlock(editor, blockId, BlockType.GridBlock, {
          parent_id: 'document',
          database_id: 'database',
          view_ids: [id],
        })
      )
    );

    try {
      const result = await createLinkedDefaultDatabaseView({
        workspaceId: 'workspace',
        requestViewId: 'document',
        sourceViewId: 'source',
        layout: DatabaseViewLayout.Grid,
        payload: { parent_view_id: 'document', database_id: 'database', name: 'Linked', embedded: true },
        loadView: async () => source,
        bindViewSync: () => ({} as never),
        scheduleDeferredCleanup: jest.fn(),
        assertCurrent: target.assertCurrent,
        activate,
        findExistingActivation: (id) => captureExistingDatabaseBlock(editor, 'document', 'database', id),
      });

      expect(activate).toHaveBeenCalledTimes(1);
      expect(await db.atomic_creation.count()).toBe(0);
      expect(postAtomicCreation).toHaveBeenCalledTimes(state === 'committed' ? 1 : 2);
      const sent = jest.mocked(postAtomicCreation).mock.calls.map((call) => call[2]);

      if (attached) {
        expect(result.view_id).not.toBe(original.view.view_id);
        expect(sent[1]).not.toBe(sent[0]);
        expect(editor.children.map((node) => node.data)).toEqual([
          expect.objectContaining({ view_ids: [original.view.view_id] }),
          expect.objectContaining({ view_ids: [result.view_id] }),
        ]);
      } else {
        expect(result.view_id).toBe(original.view.view_id);
        if (state === 'pending') expect(sent[1]).toBe(sent[0]);
        expect(editor.children).toHaveLength(1);
      }
    } finally {
      editor.disconnect();
      document.destroy();
      source.destroy();
    }
  }
);
