/** @jest-environment node */
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { collabFullSyncBatch, CollabFullSyncBatchResult } from '@/application/services/js-services/http/collab-api';
import { Types } from '@/application/types';

import { repairLegacyDatabaseViewIds } from '../creation/legacy-view-ids';

jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));

function fixture() {
  const databaseId = uuidv4();
  const inlineId = uuidv4();
  const calendarId = uuidv4();
  const remote = new Y.Doc();
  const database = new Y.Map<unknown>();
  const views = new Y.Map<Y.Map<unknown>>();
  const inline = new Y.Map<unknown>();

  remote.getMap('data').set('database', database);
  database.set('id', databaseId);
  database.set('metas', new Y.Map([['iid', inlineId]]));
  database.set('views', views);
  views.set(inlineId, inline);
  inline.set('id', inlineId);
  inline.set('is_inline', true);
  inline.set('row_orders', new Y.Array());
  const live = Y.encodeStateAsUpdate(remote);
  const calendar = new Y.Map<unknown>();

  // The historical Web writer added every field below but omitted the internal id.
  views.set(calendarId, calendar);
  calendar.set('database_id', databaseId);
  calendar.set('name', 'Calendar');
  calendar.set('layout', 2);
  calendar.set('is_inline', false);
  calendar.set('created_at', '1763726501');
  calendar.set('modified_at', '1763726501');
  calendar.set('row_orders', new Y.Array());
  (calendar.get('row_orders') as Y.Array<unknown>).push([
    { id: uuidv4(), height: 60 },
    { id: uuidv4(), is_deleted: true },
  ]);
  calendar.set('field_orders', new Y.Array());
  calendar.set('layout_settings', new Y.Map([['calendar', new Y.Map([['field_id', 'date']])]]));
  calendar.set('future_metadata', new Y.Map([['preserve', 'untouched']]));
  const snapshot = (): CollabFullSyncBatchResult => ({
    objectId: databaseId,
    collabType: Types.Database,
    collabVersion: 'version',
    missingUpdate: Y.encodeStateAsUpdate(remote),
    serverStateVector: Y.encodeStateVector(remote),
  });
  const controller = new AbortController();
  const owner: AtomicCreationOwner = {
    serverUrl: 'server',
    userId: 'user',
    workspaceId: 'workspace',
    assertCurrent: jest.fn(),
  };
  const read = jest.fn(async () => snapshot());
  const options = {
    owner,
    signal: controller.signal,
    deadline: Date.now() + 30_000,
    assertCurrent: jest.fn(),
    read,
  };
  const requirements = { databaseId, restoreId: uuidv4(), version: 'version', live, persisted: live };
  const ack = () => ({ ...snapshot(), missingUpdate: new Uint8Array([0, 0]) });

  jest.mocked(collabFullSyncBatch).mockImplementation(async (_workspace, [item]) => {
    Y.applyUpdate(remote, item.docState);
    return [ack()];
  });
  return {
    databaseId,
    inlineId,
    calendarId,
    remote,
    database,
    views,
    calendar,
    snapshot,
    controller,
    options,
    requirements,
    ack,
    cleanup: () => remote.destroy(),
  };
}

beforeEach(() => jest.resetAllMocks());

it('repairs a server-only Calendar without changing inline identity, rows, settings, or other fields', async () => {
  const f = fixture();
  const before = f.database.toJSON();
  const source = f.snapshot();

  try {
    const result = await repairLegacyDatabaseViewIds(f.requirements, source, f.options);

    expect(result).toEqual(f.snapshot());
    expect(f.database.toJSON()).toEqual({
      ...before,
      views: { ...before.views, [f.calendarId]: { ...before.views[f.calendarId], id: f.calendarId } },
    });
    expect(f.database.get('metas')).toBeInstanceOf(Y.Map);
    expect((f.database.get('metas') as Y.Map<string>).get('iid')).toBe(f.inlineId);
    expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
    const [workspace, items, options] = jest.mocked(collabFullSyncBatch).mock.calls[0];

    expect(workspace).toBe(f.options.owner.workspaceId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      objectId: f.databaseId,
      collabType: Types.Database,
      collabVersion: 'version',
      databaseRestoreId: f.requirements.restoreId,
      stateVector: Y.encodeStateVector(f.remote),
    });
    expect(options).toMatchObject({ atomicCreationOwner: f.options.owner, signal: f.controller.signal });
    expect(options!.timeoutMs).toBeGreaterThan(0);
    expect(options!.timeoutMs).toBeLessThanOrEqual(30_000);
    expect(f.options.read).toHaveBeenCalledTimes(1);
    const original = new Y.Doc();

    try {
      Y.applyUpdate(original, source.missingUpdate);
      const originalViews = (original.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<unknown>>>).get('views')!;

      expect(originalViews.get(f.calendarId)!.has('id')).toBe(false);
    } finally {
      original.destroy();
    }
  } finally {
    f.cleanup();
  }
});

it('keeps healthy databases on the read-only path', async () => {
  const f = fixture();

  try {
    f.calendar.set('id', f.calendarId);
    const before = Y.encodeStateAsUpdate(f.remote);

    await expect(repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options)).resolves.toBeUndefined();
    expect(Y.encodeStateAsUpdate(f.remote)).toEqual(before);
    expect(collabFullSyncBatch).not.toHaveBeenCalled();
    expect(f.options.read).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

it('preserves a Desktop bigint layout while repairing the id', async () => {
  const f = fixture();

  try {
    // Desktop i64 values decode as bigint; Yjs cannot insert them through Map.set.
    (f.calendar._map.get('layout')!.content as unknown as { arr: unknown[] }).arr[0] = BigInt(2);
    await repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options);
    expect(f.calendar.get('layout')).toBe(BigInt(2));
    expect(f.calendar.get('id')).toBe(f.calendarId);
  } finally {
    f.cleanup();
  }
});

it('never overwrites an existing conflicting internal identity', async () => {
  const f = fixture();
  const existing = uuidv4();

  try {
    f.calendar.set('id', existing);
    await expect(repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options)).resolves.toBeUndefined();
    expect(f.calendar.get('id')).toBe(existing);
    expect(collabFullSyncBatch).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

it.each(['database_id', 'name', 'layout', 'row_orders', 'field_orders', 'key'])(
  'does not guess an id when the legacy view has an invalid %s',
  async (field) => {
    const f = fixture();

    try {
      if (field === 'key') f.views.set('not-a-uuid', new Y.Map());
      else f.calendar.set(field, field === 'layout' ? '2' : null);
      await expect(repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options)).rejects.toThrow();
      expect(f.calendar.has('id')).toBe(false);
      expect(collabFullSyncBatch).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
    }
  }
);

it.each(['empty', 'duplicate', 'object', 'type', 'version', 'error'])(
  'requires an unambiguous acknowledgment (%s)',
  async (kind) => {
    const f = fixture();

    try {
      const ack = f.ack();

      if (kind === 'object') ack.objectId = uuidv4();
      if (kind === 'type') ack.collabType = Types.DatabaseRow;
      if (kind === 'version') ack.collabVersion = 'other';
      if (kind === 'error') ack.error = 'Permission denied';
      jest
        .mocked(collabFullSyncBatch)
        .mockResolvedValue(kind === 'empty' ? [] : kind === 'duplicate' ? [ack, ack] : [ack]);
      await expect(repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options)).rejects.toThrow();
      expect(f.options.read).not.toHaveBeenCalled();
      expect(f.calendar.has('id')).toBe(false);
    } finally {
      f.cleanup();
    }
  }
);

it.each(['owner', 'abort', 'deadline'])('stops when %s changes during synchronization', async (kind) => {
  const f = fixture();
  let finish!: (results: CollabFullSyncBatchResult[]) => void;

  try {
    jest.mocked(collabFullSyncBatch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options);

    expect(collabFullSyncBatch).toHaveBeenCalledTimes(1);
    if (kind === 'owner')
      f.options.assertCurrent.mockImplementation(() => {
        throw new Error('Owner changed');
      });
    if (kind === 'abort') f.controller.abort(new Error('Cancelled'));
    if (kind === 'deadline') f.options.deadline = Date.now() - 1;
    finish([f.ack()]);
    await expect(pending).rejects.toThrow();
    expect(f.options.read).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

it('does not treat the full-sync acknowledgment as proof that the source contains the repair', async () => {
  const f = fixture();
  let finish!: (result: CollabFullSyncBatchResult) => void;
  let completed = false;

  try {
    f.options.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options).then((result) => {
      completed = true;
      return result;
    });

    await Promise.resolve();
    expect(f.options.read).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    finish(f.snapshot());
    await expect(pending).resolves.toEqual(f.snapshot());
  } finally {
    f.cleanup();
  }
});

it('rejects a conflicting id written after the repair even when the server covers its history', async () => {
  const f = fixture();

  try {
    jest.mocked(collabFullSyncBatch).mockImplementation(async (_workspace, [item]) => {
      Y.applyUpdate(f.remote, item.docState);
      f.calendar.set('id', uuidv4());
      return [f.ack()];
    });
    await expect(repairLegacyDatabaseViewIds(f.requirements, f.snapshot(), f.options)).rejects.toThrow(
      'Database views changed during repair'
    );
    expect(f.options.read).toHaveBeenCalledTimes(1);
  } finally {
    f.cleanup();
  }
});
