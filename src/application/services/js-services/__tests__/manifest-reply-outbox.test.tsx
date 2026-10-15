import 'fake-indexeddb/auto';
import { TextEncoder } from 'node:util';

import { act, render, screen, waitFor } from '@testing-library/react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { db } from '@/application/db';
import {
  bindSyncContext,
  handleMessage,
  initSync,
  type SyncContext,
} from '@/application/services/js-services/sync-protocol';
import {
  blockPermissionSync,
  clearDrainConfig,
  configureDrain,
  setCurrentSession,
  startDrainAll,
  waitForDrain,
} from '@/application/sync-outbox';
import { Types } from '@/application/types';
import { PendingPermissionEdits } from '@/components/app/PendingPermissionEdits';
import { collab, messages } from '@/proto/messages';

// Real Yjs, the real sync protocol and outbox, IndexedDB (fake-indexeddb) and the
// real "waiting for edit access" notice. Only logging, translations and toasts
// are stubbed.
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

type Role = 'reader' | 'editor';

const SERVER_URL = 'https://server.test';
const WORKSPACE_ID = 'workspace-hr';
const USER_ID = 'alex';
const NOTICE = 'workspacePermissions.pendingEdits:1';
// Generous waits for IndexedDB work under a loaded full-suite run.
const WAIT = { timeout: 5_000 };

let nextRid = 1;

jest.setTimeout(20_000);

/**
 * jsdom has no structuredClone. A Node v8 round trip would return byte arrays
 * from Node's realm, which Dexie's `modify` (used when a denial marks rows as
 * waiting) does not recognise and flattens into plain objects; a browser keeps
 * them intact. Outbox rows hold only primitives, plain objects and bytes.
 */
function cloneInThisRealm(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return value.map(cloneInThisRealm);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneInThisRealm(entry)]));
}

beforeAll(() => Object.assign(globalThis, { TextEncoder, structuredClone: cloneInThisRealm }));

afterEach(async () => {
  clearDrainConfig();
  setCurrentSession(null);
  await db.sync_outbox.clear();
  await db.sync_permission_blocks.clear();
});

afterAll(() => db.close());

/** Server messages reach the protocol as bytes decoded from the wire. */
function fromWire(message: collab.ICollabMessage): collab.ICollabMessage {
  return messages.Message.decode(messages.Message.encode({ collabMessage: message }).finish()).collabMessage!;
}

/** A page whose history holds inserts and deletes by two earlier authors. */
function pageWithDeletionHistory(): Y.Doc {
  const server = new Y.Doc();
  const first = new Y.Doc();

  first.getText('body').insert(0, 'Onboarding checklist: laptop, badge, DRAFT');
  first.getText('body').delete(36, 6);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(first));
  const second = new Y.Doc();

  Y.applyUpdate(second, Y.encodeStateAsUpdate(server));
  second.getText('body').insert(0, 'TODO ');
  second.getText('body').delete(0, 5);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(second));
  first.destroy();
  second.destroy();
  return server;
}

function startSession(role: Role) {
  const sent: messages.IMessage[] = [];

  setCurrentSession({ userId: USER_ID, workspaceId: WORKSPACE_ID, serverUrl: SERVER_URL });
  configureDrain({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    serverUrl: SERVER_URL,
    send: (message) => {
      sent.push(message);
    },
    isReady: () => true,
    checkPermission: async () => (role === 'editor' ? 'allowed' : 'denied'),
  });
  startDrainAll();
  return sent;
}

interface OpenPage {
  ctx: SyncContext;
  objectId: string;
  persisted: Promise<boolean>[];
}

/**
 * Opens a page from the local cache of an earlier visit. `beforeBinding` runs
 * on that cached copy before sync starts, like a local change persisted on
 * this device but never handed to the outbox.
 */
function openCachedPage(server: Y.Doc, beforeBinding?: (doc: Y.Doc) => void, objectId = uuidv4()): OpenPage {
  const doc = new Y.Doc({ guid: objectId });
  const persisted: Promise<boolean>[] = [];

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
  beforeBinding?.(doc);
  const ctx: SyncContext = {
    doc,
    collabType: Types.Document,
    emit: jest.fn(),
    onManifestSync: (_objectId, durable) => {
      if (durable) persisted.push(durable);
    },
  };

  initSync(ctx);
  return { ctx, objectId, persisted };
}

function lastAnnouncedStateVector(ctx: SyncContext): Uint8Array {
  const requests = jest
    .mocked(ctx.emit)
    .mock.calls.map(([message]) => message.collabMessage?.syncRequest?.stateVector)
    .filter((vector): vector is Uint8Array => Boolean(vector));

  return requests[requests.length - 1];
}

/**
 * The server's answer to a client sync request (collab-realtime-server
 * `reply_with_manifest_state`): an Update with the diff from the client's
 * state vector, which yrs writes with the complete delete set, then the
 * server's own state vector.
 */
async function serverManifestExchange(page: OpenPage, server: Y.Doc) {
  const { ctx, objectId } = page;

  handleMessage(
    ctx,
    fromWire({
      objectId,
      collabType: Types.Document,
      update: {
        flags: 0,
        payload: Y.encodeStateAsUpdate(server, lastAnnouncedStateVector(ctx)),
        messageId: { timestamp: nextRid++, counter: 0 },
      },
    })
  );
  handleMessage(
    ctx,
    fromWire({
      objectId,
      collabType: Types.Document,
      syncRequest: { stateVector: Y.encodeStateVector(server), lastMessageId: { timestamp: 0, counter: 0 } },
    })
  );
  await settle(page);
}

async function settle(page: OpenPage) {
  await act(async () => {
    await Promise.all(page.persisted);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function outboxRows(objectId: string) {
  return db.sync_outbox.where('[userId+workspaceId+objectId]').equals([USER_ID, WORKSPACE_ID, objectId]).toArray();
}

function renderNotice() {
  return render(
    <PendingPermissionEdits
      userId={USER_ID}
      workspaceId={WORKSPACE_ID}
      serverUrl={SERVER_URL}
      beforeRetry={jest.fn()}
      reloadPage={jest.fn()}
    />
  );
}

/** Lets the notice's live query read IndexedDB before asserting it stays hidden. */
async function letNoticeRead() {
  await act(async () => {
    await db.sync_outbox.count();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function sentUpdates(sent: messages.IMessage[], objectId: string): Uint8Array[] {
  return sent
    .filter((message) => message.collabMessage?.objectId === objectId && message.collabMessage.update?.payload)
    .map((message) => message.collabMessage!.update!.payload!);
}

/** True when applying the bytes to the server changes its state. */
function changesServer(server: Y.Doc, updates: Uint8Array[]): boolean {
  const before = Y.snapshot(server);

  updates.forEach((update) => Y.applyUpdate(server, update));
  return !Y.equalSnapshots(before, Y.snapshot(server));
}

describe('manifest reply for a page whose history contains deletions', () => {
  test('(a) a reader with no local change gets no outbox item and no notice', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    // The server's earlier denial (Edit to View) is already durable, as in the recording.
    await blockPermissionSync(page.objectId, WORKSPACE_ID);
    renderNotice();
    await serverManifestExchange(page, server);
    await letNoticeRead();

    expect(await outboxRows(page.objectId)).toEqual([]);
    expect(screen.queryByTestId('pending-permission-edits')).toBeNull();

    // Positive control: the same notice appears as soon as there is a real change.
    page.ctx.doc.getText('body').insert(0, '!');
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();
  });

  test('(a) reopening and reconnecting never accumulates items for a reader', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const objectId = uuidv4();

    for (let visit = 0; visit < 3; visit += 1) {
      const page = openCachedPage(server, undefined, objectId);

      await serverManifestExchange(page, server);
      // A reconnect binds the context again and repeats the exchange.
      bindSyncContext(page.ctx);
      await serverManifestExchange(page, server);
      expect(await outboxRows(objectId)).toEqual([]);
      page.ctx.doc.destroy();
    }

    expect(await db.sync_outbox.count()).toBe(0);
  });

  test('(a) an editor with no local change does not re-send the delete set on open', async () => {
    const sent = startSession('editor');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    expect(sentUpdates(sent, page.objectId)).toEqual([]);
    expect(await outboxRows(page.objectId)).toEqual([]);
  });

  test("a sibling tab's state-vector request after the server exchange is not answered with a no-op", async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    // Sibling tabs receive each other's sync requests over BroadcastChannel.
    handleMessage(
      page.ctx,
      fromWire({
        objectId: page.objectId,
        collabType: Types.Document,
        syncRequest: { stateVector: Y.encodeStateVector(server), lastMessageId: { timestamp: 0, counter: 0 } },
      })
    );
    await settle(page);

    expect(await outboxRows(page.objectId)).toEqual([]);
  });

  test('a deletion learned only from a sibling tab is not treated as acknowledged by the server', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);
    const sibling = new Y.Doc();

    await serverManifestExchange(page, server);
    Y.applyUpdate(sibling, Y.encodeStateAsUpdate(page.ctx.doc));
    sibling.getText('body').delete(0, 3);
    // Sibling fan-out carries no server message id.
    handleMessage(
      page.ctx,
      fromWire({
        objectId: page.objectId,
        collabType: Types.Document,
        update: { flags: 0, payload: Y.encodeStateAsUpdate(sibling, Y.encodeStateVector(page.ctx.doc)) },
      })
    );
    handleMessage(
      page.ctx,
      fromWire({
        objectId: page.objectId,
        collabType: Types.Document,
        syncRequest: { stateVector: Y.encodeStateVector(server), lastMessageId: { timestamp: 0, counter: 0 } },
      })
    );
    await settle(page);

    const rows = await outboxRows(page.objectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manifest', permissionBlocked: true });
    expect(changesServer(server, [rows[0].payload])).toBe(true);
    sibling.destroy();
  });
});

describe.each([
  ['(b) a local pure deletion', (doc: Y.Doc) => doc.getText('body').delete(0, 10)],
  ['(c) a local insertion', (doc: Y.Doc) => doc.getText('body').insert(0, 'Bring ID. ')],
] as const)('%s is kept', (_name, localChange) => {
  test('(d) reader: unsent change reachable only through the manifest is kept and blocked', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server, localChange);

    renderNotice();
    await serverManifestExchange(page, server);

    const rows = await outboxRows(page.objectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manifest', permissionBlocked: true });
    expect(changesServer(server, [rows[0].payload])).toBe(true);
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();
  });

  test('(d) editor: unsent change reachable only through the manifest is sent', async () => {
    const sent = startSession('editor');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server, localChange);

    await serverManifestExchange(page, server);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    const updates = sentUpdates(sent, page.objectId);

    expect(updates).toHaveLength(1);
    expect(changesServer(server, updates)).toBe(true);
    expect(server.getText('body').toString()).toBe(page.ctx.doc.getText('body').toString());
    expect(await outboxRows(page.objectId)).toEqual([]);
  });

  test('(d) reader: a change made after binding is blocked on both the edit and manifest paths', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    renderNotice();
    localChange(page.ctx.doc);
    await serverManifestExchange(page, server);

    // The edit's own enqueue is not awaited by the exchange.
    await waitFor(async () => {
      const rows = await outboxRows(page.objectId);

      expect(rows.map((row) => [row.source ?? 'edit', row.permissionBlocked]).sort()).toEqual([
        ['edit', true],
        ['manifest', true],
      ]);
    }, WAIT);
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();
  });

  test('(d) editor: a change made after binding reaches the server', async () => {
    const sent = startSession('editor');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    localChange(page.ctx.doc);
    await serverManifestExchange(page, server);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    expect(changesServer(server, sentUpdates(sent, page.objectId))).toBe(true);
    expect(server.getText('body').toString()).toBe(page.ctx.doc.getText('body').toString());
    expect(await outboxRows(page.objectId)).toEqual([]);
  });
});
