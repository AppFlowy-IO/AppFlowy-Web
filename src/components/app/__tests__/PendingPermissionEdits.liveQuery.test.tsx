/**
 * The notice is mounted for the whole session, while every local edit writes
 * to the outbox. These tests run the real live query on IndexedDB.
 */
import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BaseDexie from 'dexie';
import { Profiler } from 'react';

import { db } from '@/application/db';
import { retryPermissionBlockedSync } from '@/application/sync-outbox';
import {
  persistPermissionBlock,
  readPermissionBlock,
  releasePermissionBlock,
} from '@/application/sync-outbox/permission-quarantine';

import { PendingPermissionEdits } from '../PendingPermissionEdits';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/application/sync-outbox', () => ({
  retryPermissionBlockedSync: jest.fn(),
  discardPermissionBlockedEdits: jest.fn(),
  settleDiscardedEdits: jest.fn(),
  subscribeDiscardedEdits: jest.fn(() => () => undefined),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const session = { userId: 'user-1', workspaceId: 'workspace-1', serverUrl: 'https://server.test' };

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value) => deserialize(serialize(value));
});

afterEach(async () => {
  jest.restoreAllMocks();
  // Release the shared cache so it can be deleted; the next test reopens it.
  db.close({ disableAutoOpen: false });
  await BaseDexie.delete(db.name);
});

function addEdit(objectId: string, options: { permissionBlocked?: boolean; serverUrl?: string } = {}) {
  return db.sync_outbox.add({
    userId: session.userId,
    workspaceId: session.workspaceId,
    serverUrl: options.serverUrl ?? session.serverUrl,
    objectId,
    collabType: 0,
    payload: new Uint8Array([1]),
    createdAt: Date.now(),
    permissionBlocked: options.permissionBlocked,
  });
}

/** Lets IndexedDB and the live query finish what the last write started. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

function renderNotice(onRender: () => void = jest.fn()) {
  return render(
    <Profiler id='notice' onRender={onRender}>
      <PendingPermissionEdits {...session} beforeRetry={jest.fn()} reloadPage={jest.fn()} />
    </Profiler>
  );
}

function status() {
  return screen.queryByRole('status')?.textContent ?? null;
}

test('ordinary edits neither re-read the outbox nor re-render the notice', async () => {
  const outboxReads = jest.spyOn(db.sync_outbox, 'where');
  const denialReads = jest.spyOn(db.sync_permission_blocks, 'where');
  const commits = jest.fn();

  renderNotice(commits);
  await waitFor(() => expect(denialReads).toHaveBeenCalledTimes(1));
  await settle();
  // The first query reads every row once, for flags an earlier session left.
  expect(outboxReads).toHaveBeenCalledTimes(1);

  // The edit after it re-runs the query once more, which no longer reads rows.
  const first = await addEdit('page-a');

  await waitFor(() => expect(denialReads).toHaveBeenCalledTimes(2));
  await settle();
  for (let index = 0; index < 5; index += 1) {
    await db.sync_outbox.delete(await addEdit('page-a'));
  }

  await db.sync_outbox.delete(first);
  await settle();
  expect(denialReads).toHaveBeenCalledTimes(2);
  expect(outboxReads).toHaveBeenCalledTimes(1);
  expect(commits).toHaveBeenCalledTimes(1);
  expect(status()).toBeNull();
});

test('shows edits once their page is denied, whichever tab records the denial', async () => {
  await addEdit('page-a');
  await addEdit('page-b');
  renderNotice();
  await settle();
  await addEdit('page-c');
  await settle();

  await persistPermissionBlock(session, 'page-a');
  await waitFor(() => expect(status()).toContain('workspacePermissions.pendingEdits:1'));

  // Another tab's connection to the same database.
  const otherTab = new BaseDexie(db.name);

  await otherTab.open();
  await otherTab.transaction('rw', ['sync_outbox', 'sync_permission_blocks'], async () => {
    await otherTab.table('sync_permission_blocks').put({ ...session, objectId: 'page-b', revision: 'other-tab' });
    await otherTab
      .table('sync_outbox')
      .where('[userId+workspaceId+objectId]')
      .equals([session.userId, session.workspaceId, 'page-b'])
      .modify({ permissionBlocked: true });
  });
  otherTab.close();
  await waitFor(() => expect(status()).toContain('workspacePermissions.pendingEdits:2'));
});

test('keeps showing edits whose flag outlived the release of their denial until they are sent', async () => {
  const reviewed = await addEdit('page-a');

  await persistPermissionBlock(session, 'page-a');
  const block = await readPermissionBlock(session, 'page-a');
  // Written while Try again checked access, so the release leaves it waiting.
  const later = await addEdit('page-a', { permissionBlocked: true });

  renderNotice();
  await waitFor(() => expect(status()).toContain('workspacePermissions.pendingEdits:1'));

  expect(await releasePermissionBlock(session, 'page-a', block, reviewed, () => true)).toBe(true);
  await settle();
  // An ordinary edit elsewhere re-runs the query without reading every row.
  await addEdit('page-z');
  await settle();
  expect(await db.sync_permission_blocks.count()).toBe(0);
  expect(status()).toContain('workspacePermissions.pendingEdits:1');

  await db.sync_outbox.delete(later);
  await waitFor(() => expect(status()).toBeNull());
});

test('shows edits left waiting by an earlier session without a denial, for this server only', async () => {
  await addEdit('page-a', { permissionBlocked: true });
  await addEdit('page-b', { permissionBlocked: true, serverUrl: 'https://other-server.test' });
  await addEdit('page-c');
  renderNotice();

  await waitFor(() => expect(status()).toContain('workspacePermissions.pendingEdits:1'));
});

test('shows released edits as saving until they are uploaded', async () => {
  const edit = await addEdit('page-a');
  let retried: Promise<unknown> = Promise.resolve();

  await persistPermissionBlock(session, 'page-a');
  jest.mocked(retryPermissionBlockedSync).mockImplementation(() => {
    const retry = (async () => {
      await releasePermissionBlock(session, 'page-a', await readPermissionBlock(session, 'page-a'), edit, () => true);
      // The live query sees the release before Try again reports it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { released: ['page-a'], denied: [], unknown: [] };
    })();

    retried = retry;
    return retry;
  });
  renderNotice();
  const tryAgain = await screen.findByRole('button', { name: 'workspacePermissions.pendingEditsTryAgain' });

  await act(async () => {
    fireEvent.click(tryAgain);
    await retried;
  });
  await waitFor(() => expect(status()).toContain('workspacePermissions.pendingEditsSaving'));
  await db.sync_outbox.delete(edit);
  await waitFor(() => expect(status()).toBeNull());
  await settle();
  // Later ordinary edits of the page are not shown as saving.
  await addEdit('page-a');
  await settle();
  expect(status()).toBeNull();
});
