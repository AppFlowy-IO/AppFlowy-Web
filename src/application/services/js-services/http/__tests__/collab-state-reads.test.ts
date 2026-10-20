import * as Y from 'yjs';

import { AtomicCreationOwner } from '@/application/atomic-creation/owner';
import { getAxios } from '@/application/services/js-services/http/core';
import { Types } from '@/application/types';

import { readCollabStates } from '../collab-api';

jest.mock('@/application/services/js-services/http/core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
}));
jest.mock('@/application/services/js-services/device-id', () => ({ getOrCreateDeviceId: () => 'device' }));

const owner: AtomicCreationOwner = {
  workspaceId: 'workspace', userId: 'user', serverUrl: 'server', assertCurrent: jest.fn(),
};

function fixture() {
  const doc = new Y.Doc();

  doc.getMap('data').set('title', 'current server state');
  const state = {
    object_id: 'object', version: 0, collab_version: 'current-version',
    state_vector: Array.from(Y.encodeStateVector(doc)), doc_state: Array.from(Y.encodeStateAsUpdate(doc)),
  };
  const get = jest.fn(async () => ({ data: { data: state } }));
  const post = jest.fn();

  jest.mocked(getAxios).mockReturnValue({ get, post, defaults: { adapter: jest.fn() } } as never);
  return { doc, state, get, post };
}

beforeEach(() => jest.resetAllMocks());

test.each([0, 1])('reads encoding %s through GET without a sync upload and preserves source evidence', async (version) => {
  const f = fixture();
  const controller = new AbortController();

  f.state.version = version;
  if (version === 1) f.state.doc_state = Array.from(Y.encodeStateAsUpdateV2(f.doc));
  const [result] = await readCollabStates('workspace', [{ objectId: 'object', collabType: Types.Database }], {
    atomicCreationOwner: owner, signal: controller.signal, timeoutMs: 1000,
  });

  expect(f.post).not.toHaveBeenCalled();
  expect(f.get).toHaveBeenCalledWith('/api/workspace/v1/workspace/collab/object', expect.objectContaining({
    params: { collab_type: Types.Database }, signal: expect.any(AbortSignal), skipResponseCache: true,
    atomicCreationOwner: owner, headers: { 'Cache-Control': 'no-cache' },
  }));
  const decoded = new Y.Doc();

  Y.applyUpdate(decoded, result.missingUpdate);
  expect(decoded.getMap('data').toJSON()).toEqual(f.doc.getMap('data').toJSON());
  expect(result.serverStateVector).toEqual(Y.encodeStateVector(f.doc));
  expect(result.collabVersion).toBe('current-version');
  expect(owner.assertCurrent).toHaveBeenCalledTimes(2);
  f.doc.destroy();
  decoded.destroy();
});

test.each(['identity', 'encoding', 'bytes'])('rejects invalid server %s', async (invalid) => {
  const f = fixture();

  if (invalid === 'identity') f.state.object_id = 'different';
  if (invalid === 'encoding') f.state.version = 2;
  if (invalid === 'bytes') f.state.state_vector = [256];
  await expect(readCollabStates('workspace', [{ objectId: 'object', collabType: Types.Database }])).rejects.toThrow();
  f.doc.destroy();
});

test('bounds concurrent reads and does not start the next chunk after cancellation', async () => {
  const f = fixture();
  const controller = new AbortController();

  f.get.mockImplementation(() => new Promise(() => undefined));
  const pending = readCollabStates('workspace', Array.from({ length: 9 }, (_, i) => ({
    objectId: String(i), collabType: Types.DatabaseRow,
  })), { atomicCreationOwner: owner, signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();

  expect(f.get).toHaveBeenCalledTimes(4);
  controller.abort();
  await rejected;
  expect(f.get).toHaveBeenCalledTimes(4);
  f.doc.destroy();
});

test('keeps every read slot busy while one object is slow and preserves request order', async () => {
  const f = fixture();
  let releaseSlow!: () => void;

  f.get.mockImplementation(async (url: string) => {
    const objectId = url.split('/').pop()!;

    if (objectId === '0') await new Promise<void>((resolve) => { releaseSlow = resolve; });
    return { data: { data: { ...f.state, object_id: objectId } } };
  });
  const pending = readCollabStates('workspace', Array.from({ length: 7 }, (_, i) => ({
    objectId: String(i), collabType: Types.DatabaseRow,
  })));

  for (let i = 0; i < 20 && f.get.mock.calls.length < 7; i++) await Promise.resolve();
  // Lockstep groups of four would wait for object 0 before starting objects 4-6.
  expect(f.get).toHaveBeenCalledTimes(7);
  releaseSlow();
  expect((await pending).map((result) => result.objectId)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  f.doc.destroy();
});

test('cancels sibling reads after one read fails', async () => {
  const f = fixture();
  const signals: AbortSignal[] = [];

  f.get.mockImplementation((url: string, config: { signal: AbortSignal }) => {
    signals.push(config.signal);
    if (url.endsWith('/1')) return Promise.reject(new Error('read failed'));
    return new Promise(() => undefined);
  });
  await expect(readCollabStates('workspace', Array.from({ length: 3 }, (_, i) => ({
    objectId: String(i), collabType: Types.DatabaseRow,
  })), { atomicCreationOwner: owner })).rejects.toThrow('read failed');
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  f.doc.destroy();
});

test('rejects a response after the creation owner retires', async () => {
  const f = fixture();

  jest.mocked(owner.assertCurrent).mockImplementationOnce(() => undefined).mockImplementation(() => {
    throw new Error('owner retired');
  });
  await expect(readCollabStates('workspace', [{ objectId: 'object', collabType: Types.Document }], {
    atomicCreationOwner: owner,
  })).rejects.toThrow('owner retired');
  expect(f.post).not.toHaveBeenCalled();
  f.doc.destroy();
});
