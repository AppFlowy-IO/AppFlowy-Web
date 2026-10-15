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
  discardPermissionBlockedEdits,
  enqueueOutboxUpdate,
  retryPermissionBlockedSync,
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

/**
 * A page whose earlier authors keep editing: each `edit` is accepted by the server and returned
 * as the bytes the server relays. The author already has history in the page, so its new
 * structs start well after clock 0.
 */
function pageWithActiveAuthor() {
  const server = pageWithDeletionHistory();
  const author = new Y.Doc();

  Y.applyUpdate(author, Y.encodeStateAsUpdate(server));
  author.getText('body').insert(0, 'Draft: ');
  Y.applyUpdate(server, Y.encodeStateAsUpdate(author));
  const edit = (change: (text: Y.Text) => void) => {
    Y.applyUpdate(author, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(author);

    change(author.getText('body'));
    const update = Y.encodeStateAsUpdate(author, before);
    const firstClock = Y.parseUpdateMeta(update).from.get(author.clientID);

    // A pure deletion holds no struct.
    if (firstClock !== undefined) expect(firstClock).toBeGreaterThan(0);
    Y.applyUpdate(server, update);
    return update;
  };

  return { server, edit };
}

const session = { userId: USER_ID, workspaceId: WORKSPACE_ID, serverUrl: SERVER_URL };

function startSession(initialRole: Role) {
  const sent: messages.IMessage[] = [];
  const access = { role: initialRole };

  setCurrentSession(session);
  configureDrain({
    ...session,
    send: (message) => {
      sent.push(message);
    },
    isReady: () => true,
    checkPermission: async () => (access.role === 'editor' ? 'allowed' : 'denied'),
  });
  startDrainAll();
  return Object.assign(sent, { access });
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
  serverUpdate(page, Y.encodeStateAsUpdate(server, lastAnnouncedStateVector(page.ctx)));
  stateVectorRequest(page, Y.encodeStateVector(server));
  await settle(page);
}

/** An Update from the server: it carries a stream message id, also when another tab relays it. */
function serverUpdate(page: OpenPage, payload: Uint8Array) {
  handleMessage(
    page.ctx,
    fromWire({
      objectId: page.objectId,
      collabType: Types.Document,
      update: { flags: 0, payload, messageId: { timestamp: nextRid++, counter: 0 } },
    })
  );
}

/** A state-vector request: the server's Manifest, or a sibling tab's request over BroadcastChannel. */
function stateVectorRequest(page: OpenPage, stateVector: Uint8Array) {
  handleMessage(
    page.ctx,
    fromWire({
      objectId: page.objectId,
      collabType: Types.Document,
      syncRequest: { stateVector, lastMessageId: { timestamp: 0, counter: 0 } },
    })
  );
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

/** Like `changesServer`, on a copy, so the server itself stays as it is. */
function wouldChangeServer(server: Y.Doc, updates: Uint8Array[]): boolean {
  const probe = new Y.Doc();

  Y.applyUpdate(probe, Y.encodeStateAsUpdate(server));
  const changed = changesServer(probe, updates);

  probe.destroy();
  return changed;
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

describe('replies that only repeat what the server holds, across tabs and re-syncs', () => {
  test('a reader answering a sibling tab that missed a relayed update gets no row and no notice', async () => {
    startSession('reader');
    const { server, edit } = pageWithActiveAuthor();
    const page = openCachedPage(server);

    renderNotice();
    await serverManifestExchange(page, server);
    const siblingVector = Y.encodeStateVector(server);

    // The server relays another author's edit to this tab; the sibling tab has not seen it yet.
    serverUpdate(page, edit((text) => text.insert(0, 'New: ')));
    stateVectorRequest(page, siblingVector);
    await settle(page);
    await letNoticeRead();

    expect(await outboxRows(page.objectId)).toEqual([]);
    expect(screen.queryByTestId('pending-permission-edits')).toBeNull();
  });

  test('an editor answering that sibling tab uploads nothing', async () => {
    const sent = startSession('editor');
    const { server, edit } = pageWithActiveAuthor();
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    const siblingVector = Y.encodeStateVector(server);

    serverUpdate(
      page,
      edit((text) => {
        text.insert(0, 'New: ');
        text.delete(12, 3);
      })
    );
    stateVectorRequest(page, siblingVector);
    await settle(page);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    expect(sentUpdates(sent, page.objectId)).toEqual([]);
  });

  test("a re-sync whose Manifest is older than a live update that overtook it gets no row", async () => {
    startSession('reader');
    const { server, edit } = pageWithActiveAuthor();
    const page = openCachedPage(server);

    renderNotice();
    await serverManifestExchange(page, server);
    // The tab re-syncs; the server builds its answer, then accepts and broadcasts a live edit,
    // which reaches this tab before the answer.
    bindSyncContext(page.ctx);
    const staleDiff = Y.encodeStateAsUpdate(server, lastAnnouncedStateVector(page.ctx));
    const staleVector = Y.encodeStateVector(server);

    serverUpdate(page, edit((text) => text.insert(0, 'Live: ')));
    serverUpdate(page, staleDiff);
    stateVectorRequest(page, staleVector);
    await settle(page);
    await letNoticeRead();

    expect(await outboxRows(page.objectId)).toEqual([]);
    expect(screen.queryByTestId('pending-permission-edits')).toBeNull();
  });

  test.each([
    ['holds the same copy', (page: OpenPage) => Y.encodeStateVector(page.ctx.doc)],
    ['opened an older copy', (_page: OpenPage, olderVector: Uint8Array) => olderVector],
  ])(
    "a sibling tab's request that arrives before the server answers this tab queues nothing (sibling %s)",
    async (_name, siblingVectorOf) => {
      startSession('reader');
      const { server, edit } = pageWithActiveAuthor();
      const olderVector = Y.encodeStateVector(server);

      edit((text) => text.insert(0, 'Newer: '));
      const page = openCachedPage(server);

      await blockPermissionSync(page.objectId, WORKSPACE_ID);
      renderNotice();
      // Both tabs bind at once; the sibling's request reaches this tab over BroadcastChannel first.
      stateVectorRequest(page, siblingVectorOf(page, olderVector));
      await settle(page);
      expect(await outboxRows(page.objectId)).toEqual([]);
      await serverManifestExchange(page, server);
      await letNoticeRead();

      expect(await outboxRows(page.objectId)).toEqual([]);
      expect(screen.queryByTestId('pending-permission-edits')).toBeNull();
    }
  );

  test("a reply queued for a lagging sibling tab is removed once the server's answer to that tab arrives", async () => {
    startSession('reader');
    const { server, edit } = pageWithActiveAuthor();
    const olderVector = Y.encodeStateVector(server);

    edit((text) => text.insert(0, 'Newer: '));
    // This tab opens a copy that already holds the newer edit, so the server never sends it here.
    const page = openCachedPage(server);

    renderNotice();
    await serverManifestExchange(page, server);
    stateVectorRequest(page, olderVector);
    await settle(page);
    // Nothing yet proves the server holds what the sibling lacks: the reply waits, briefly.
    expect(await outboxRows(page.objectId)).toHaveLength(1);
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();

    // The socket owner relays the server's answer to the sibling's request to every tab.
    serverUpdate(page, Y.encodeStateAsUpdate(server, olderVector));
    stateVectorRequest(page, Y.encodeStateVector(server));

    await waitFor(async () => expect(await outboxRows(page.objectId)).toEqual([]), WAIT);
    await waitFor(() => expect(screen.queryByTestId('pending-permission-edits')).toBeNull(), WAIT);
  });

  test('a waiting reply left by an earlier build that only repeats server deletions is removed', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const objectId = uuidv4();
    const cached = new Y.Doc();

    Y.applyUpdate(cached, Y.encodeStateAsUpdate(server));
    await blockPermissionSync(objectId, WORKSPACE_ID);
    // What the unfixed build queued: the server's deletions and nothing else.
    await enqueueOutboxUpdate(
      {
        objectId,
        collabType: Types.Document,
        version: null,
        payload: Y.encodeStateAsUpdate(cached, Y.encodeStateVector(server)),
        beforeStateVector: Y.encodeStateVector(server),
      },
      { broadcast: false, source: 'manifest' }
    );
    renderNotice();
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();

    const page = openCachedPage(server, undefined, objectId);

    await serverManifestExchange(page, server);
    await waitFor(async () => expect(await outboxRows(objectId)).toEqual([]), WAIT);
    await waitFor(() => expect(screen.queryByTestId('pending-permission-edits')).toBeNull(), WAIT);
  });

  test('a waiting reply with a change the server lacks is kept', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const objectId = uuidv4();
    const cached = new Y.Doc();

    Y.applyUpdate(cached, Y.encodeStateAsUpdate(server));
    cached.getText('body').delete(0, 2);
    await blockPermissionSync(objectId, WORKSPACE_ID);
    await enqueueOutboxUpdate(
      {
        objectId,
        collabType: Types.Document,
        version: null,
        payload: Y.encodeStateAsUpdate(cached, Y.encodeStateVector(server)),
        beforeStateVector: Y.encodeStateVector(server),
      },
      { broadcast: false, source: 'manifest' }
    );
    renderNotice();

    const page = openCachedPage(server, undefined, objectId);

    await serverManifestExchange(page, server);
    // Past the cleanup delay: the row stays, and so does the notice.
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const rows = await outboxRows(objectId);

    expect(rows).toHaveLength(1);
    expect(wouldChangeServer(server, [rows[0].payload])).toBe(true);
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();
  });

  test('after a reconnect, an editor sends again a deletion the server lost', async () => {
    const sent = startSession('editor');
    const base = new Y.Doc();

    base.getText('body').insert(0, 'Onboarding checklist: laptop, badge');
    // The server came back without one deletion it had sent before (same collab version).
    const lost = new Y.Doc();
    const server = new Y.Doc();

    Y.applyUpdate(lost, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(base));
    server.getText('body').delete(0, 11);
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);
    expect(sentUpdates(sent, page.objectId)).toEqual([]);

    bindSyncContext(page.ctx);
    await serverManifestExchange(page, lost);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    expect(changesServer(lost, sentUpdates(sent, page.objectId))).toBe(true);
    expect(lost.getText('body').toString()).toBe(page.ctx.doc.getText('body').toString());
  });

  test("a bare request for an empty server state is answered while this tab awaits the server's answer", async () => {
    const sent = startSession('editor');
    const local = new Y.Doc();

    local.getText('body').insert(0, 'Written before the server had this page');
    const page = openCachedPage(local);

    // The server has no state for the page: its answer is a request with an empty state vector, no Update.
    stateVectorRequest(page, Y.encodeStateVector(new Y.Doc()));
    await settle(page);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);
    const server = new Y.Doc();

    expect(changesServer(server, sentUpdates(sent, page.objectId))).toBe(true);
    expect(server.getText('body').toString()).toBe('Written before the server had this page');
  });

  test('replies queued for another collab version are left alone', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);
    const cached = new Y.Doc();

    Y.applyUpdate(cached, Y.encodeStateAsUpdate(server));
    await blockPermissionSync(page.objectId, WORKSPACE_ID);
    await enqueueOutboxUpdate(
      {
        objectId: page.objectId,
        collabType: Types.Document,
        version: 'older-version',
        payload: Y.encodeStateAsUpdate(cached, Y.encodeStateVector(server)),
        beforeStateVector: Y.encodeStateVector(server),
      },
      { broadcast: false, source: 'manifest' }
    );
    await serverManifestExchange(page, server);
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(await outboxRows(page.objectId)).toMatchObject([{ version: 'older-version', source: 'manifest' }]);
  });

  test('proof from one collab version does not cover replies once the doc moves to another', async () => {
    startSession('reader');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    page.ctx.doc.version = 'version-2';
    stateVectorRequest(page, Y.encodeStateVector(server));
    await settle(page);
    // The earlier proof belongs to the old version, so the reply is kept for now...
    expect(await outboxRows(page.objectId)).toHaveLength(1);

    // ...until the server proves its state for the new version.
    bindSyncContext(page.ctx);
    await serverManifestExchange(page, server);
    await waitFor(async () => expect(await outboxRows(page.objectId)).toEqual([]), WAIT);
  });
});

describe('a pure deletion refused before the user became a reader', () => {
  /** An editor's deletion is sent, the server refuses it, and the editor is demoted. */
  async function refusedDeletion() {
    const sent = startSession('editor');
    const server = pageWithDeletionHistory();
    const page = openCachedPage(server);

    await serverManifestExchange(page, server);
    page.ctx.doc.getText('body').delete(0, 3);
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);
    expect(sentUpdates(sent, page.objectId)).toHaveLength(1);
    sent.access.role = 'reader';
    await blockPermissionSync(page.objectId, WORKSPACE_ID);
    renderNotice();
    // On reconnect the server, which never applied the deletion, asks again.
    bindSyncContext(page.ctx);
    await serverManifestExchange(page, server);

    const rows = await outboxRows(page.objectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manifest', permissionBlocked: true });
    expect(wouldChangeServer(server, [rows[0].payload])).toBe(true);
    expect(await screen.findByText(NOTICE, undefined, WAIT)).toBeTruthy();
    return { sent, server, page };
  }

  test('Try again keeps it while access is missing and sends it once access is back', async () => {
    const { sent, server, page } = await refusedDeletion();
    const before = sentUpdates(sent, page.objectId).length;

    await expect(retryPermissionBlockedSync(session)).resolves.toMatchObject({ denied: [page.objectId] });
    expect(await outboxRows(page.objectId)).toHaveLength(1);

    sent.access.role = 'editor';
    await expect(retryPermissionBlockedSync(session)).resolves.toMatchObject({ released: [page.objectId] });
    await expect(waitForDrain([page.objectId], { timeoutMs: WAIT.timeout })).resolves.toBe(true);

    expect(changesServer(server, sentUpdates(sent, page.objectId).slice(before))).toBe(true);
    expect(server.getText('body').toString()).toBe(page.ctx.doc.getText('body').toString());
    await waitFor(() => expect(screen.queryByTestId('pending-permission-edits')).toBeNull(), WAIT);
  });

  test('Discard changes removes it and the notice', async () => {
    const { page } = await refusedDeletion();

    await expect(discardPermissionBlockedEdits(session)).resolves.toEqual([page.objectId]);
    expect(await outboxRows(page.objectId)).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId('pending-permission-edits')).toBeNull(), WAIT);
  });
});
