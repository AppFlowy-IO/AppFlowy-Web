import 'fake-indexeddb/auto';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { deserialize, serialize } from 'v8';

import { db } from '@/application/db';
import { userFriendlyErrorMessage } from '@/application/errors/error-message';
import { postAtomicCreation } from '@/application/services/js-services/http/atomic-creation-api';
import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { getTokenParsed, invalidToken, saveGoTrueAuth } from '@/application/session/token';
import { updateServerInfo } from '@/utils/server-info';

import {
  atomicRead,
  captureAtomicCreationOwner,
  findPendingAtomicCreation,
  listPendingAtomicCreations,
  parseAtomicCreationRequest,
  recoverAtomicCreation,
  runAtomicCreation,
  type AtomicCreationReceipt,
  type CreateDefaultDocumentPageRequest,
  type PublishRowDocumentRequest,
} from '..';

let mockWorkspace = 'workspace';
let mockSessionGeneration = 0;
jest.mock('@/application/sync-outbox', () => ({
  purgeAllOutbox: jest.fn(() => Promise.resolve()),
  getCurrentOutboxSession: (workspace: string) =>
    workspace === mockWorkspace ? { userId: 'user', workspaceId: workspace } : null,
  getCurrentOutboxSessionGeneration: () => mockSessionGeneration,
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const server = 'https://test.appflowy.cloud';
const command: CreateDefaultDocumentPageRequest = {
  schema_version: 'v1',
  request_id: '00000000-0000-4000-8000-000000000001',
  view_id: '00000000-0000-4000-8000-000000000002',
  parent_view_id: '00000000-0000-4000-8000-000000000003',
  name: 'Exact immutable title',
  position: { kind: 'end' },
};
const receipt: AtomicCreationReceipt<'document'> = {
  request_id: command.request_id,
  outcome: 'applied',
  result: { view_id: command.view_id, database_id: null },
};
const token = (user = 'user', expired = false) => ({
  user: { id: user },
  access_token: `access-${user}`,
  refresh_token: `refresh-${user}`,
  expires_at: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}
const reply = (config: InternalAxiosRequestConfig, data: unknown) => ({
  data: { code: 0, data },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});
let grant: AxiosInstance;
let send: jest.Mock;

beforeAll(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) });
  const create = axios.create.bind(axios);
  const clients: AxiosInstance[] = [];
  const spy = jest.spyOn(axios, 'create').mockImplementation((config) => {
    const client = create(config);

    clients.push(client);
    return client;
  });

  initAPIService({ baseURL: server, gotrueURL: `${server}/gotrue`, wsURL: 'wss://test.appflowy.cloud/ws' });
  grant = clients[1];
  spy.mockRestore();
});
beforeEach(async () => {
  localStorage.clear();
  mockWorkspace = 'workspace';
  mockSessionGeneration += 1;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  saveGoTrueAuth(JSON.stringify(token()));
  updateServerInfo(server, {
    status: 'available',
    info: { enable_page_history: true, enable_atomic_creation: true, enable_atomic_creation_defaults: true },
  });
  await db.open();
  await db.atomic_creation.clear();
  send = jest.fn(async (config: InternalAxiosRequestConfig) => reply(config, receipt));
  getAxios()!.defaults.adapter = send;
});
afterAll(() => db.close());

it('persists exact bytes before POST, hydrates only after ACK, and removes only after activation', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const hydrate = jest.fn(async () => {
    expect((await findPendingAtomicCreation(owner, 'document', command.view_id))?.state).toBe('committed');
    return 'current content';
  });

  send.mockImplementation(async (config: InternalAxiosRequestConfig) => {
    const stored = await findPendingAtomicCreation(owner, 'document', command.view_id);

    expect(stored?.requestJson).toBe(config.data);
    expect(hydrate).not.toHaveBeenCalled();
    return reply(config, receipt);
  });
  await expect(
    runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id, hydrate })
  ).resolves.toBe('current content');
  expect(await listPendingAtomicCreations(owner)).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
});

it('retains staged row edits beside an immutable recipe across a lost ACK and a held hydration', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const staging = JSON.stringify({ version: 1, changes: ['accepted after sealing'] });
  const onPrepared = jest.fn(async (record) => {
    await db.atomic_creation.update(record.id, { rowDocumentStagingJson: staging });
  });

  send.mockRejectedValueOnce(new Error('lost ACK'));
  await expect(runAtomicCreation({
    owner, kind: 'document', request: command, logicalTarget: command.view_id, onPrepared, hydrate: jest.fn(),
  })).rejects.toThrow();
  db.close();
  await db.open();
  const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

  expect(record.rowDocumentStagingJson).toBe(staging);
  expect(record.requestJson).toBe(JSON.stringify(command));
  const entered = deferred<void>();
  const release = deferred<void>();
  const recovery = recoverAtomicCreation({ owner, record, onPrepared, hydrate: async () => {
    entered.resolve();
    await release.promise;
    return 'persisted edits';
  } });

  await entered.promise;
  expect((await db.atomic_creation.get(record.id))?.rowDocumentStagingJson).toBe(staging);
  expect(send.mock.calls[1][0].data).toBe(record.requestJson);
  release.resolve();
  await expect(recovery).resolves.toBe('persisted edits');
  expect(await db.atomic_creation.get(record.id)).toBeUndefined();
});

it('keeps lost-ACK recovery guidance visible without exposing the transport diagnostic', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  send.mockRejectedValueOnce(new Error('private transport diagnostic'));
  const error = await runAtomicCreation({
    owner, kind: 'document', request: command, logicalTarget: command.view_id, hydrate: jest.fn(),
  }).catch((failure: unknown) => failure);

  expect(error).toMatchObject({ name: 'AtomicCreationPendingError', requestId: command.request_id });
  expect(userFriendlyErrorMessage(error, { fallback: 'Failed to create view' })).toBe(
    'Creation is pending. Retry the original request to finish.'
  );
  expect(userFriendlyErrorMessage(error)).not.toContain('private transport diagnostic');
  expect(await findPendingAtomicCreation(owner, 'document', command.view_id)).toBeDefined();
  expect(send).toHaveBeenCalledTimes(1);
});

it('reopens IndexedDB after lost ACK and resends identical bytes only on explicit recovery', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const hydrate = jest.fn(async () => 'active');

  send.mockRejectedValueOnce(new Error('connection closed after commit'));
  await expect(
    runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id, hydrate })
  ).rejects.toMatchObject({ requestId: command.request_id });
  db.close();
  await db.open();
  const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

  expect(parseAtomicCreationRequest(record)).toEqual(command);
  expect(send).toHaveBeenCalledTimes(1);
  expect(hydrate).not.toHaveBeenCalled();
  send.mockImplementation(async (config: InternalAxiosRequestConfig) =>
    reply(config, { ...receipt, outcome: 'already_applied' })
  );
  await expect(recoverAtomicCreation({ owner, record, hydrate })).resolves.toBe('active');
  expect(send.mock.calls[0][0].data).toBe(send.mock.calls[1][0].data);
});

it('retains Committed after a failed current read, then hydrates without capability or another POST', async () => {
  const owner = captureAtomicCreationOwner('workspace');

  await expect(
    runAtomicCreation({
      owner,
      kind: 'document',
      request: command,
      logicalTarget: command.view_id,
      hydrate: async () => {
        throw new Error('current permission denied');
      },
    })
  ).rejects.toMatchObject({ committed: true, user_error: { reason: 'ATOMIC_CREATION_COMMITTED' },
    cause: { message: 'current permission denied' } });
  updateServerInfo(server, { status: 'unsupported' });
  const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

  expect(record.state).toBe('committed');
  await expect(
    recoverAtomicCreation({ owner, record, hydrate: async () => 'current authorized content' })
  ).resolves.toBe('current authorized content');
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(['offline', 'unsupported'] as const)('refuses %s before journal or network', async (condition) => {
  if (condition === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  else
    updateServerInfo(server, { status: 'available', info: { enable_page_history: true, enable_atomic_creation: true } });
  const error = await runAtomicCreation({
    owner: captureAtomicCreationOwner('workspace'),
    kind: 'document',
    request: command,
    logicalTarget: command.view_id,
    hydrate: async () => undefined,
  }).catch((error: unknown) => error);

  expect(error).toBeInstanceOf(Error);
  expect(userFriendlyErrorMessage(error, { fallback: 'Failed to create page' })).toBe(
    condition === 'offline'
      ? 'Connect to the internet to create this item.'
      : 'Update the server to use this creation feature.'
  );
  expect(await db.atomic_creation.count()).toBe(0);
  expect(send).not.toHaveBeenCalled();
});

it('refuses wrong receipts before hydration and never substitutes a new request', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const hydrate = jest.fn();

  send.mockImplementation(async (config: InternalAxiosRequestConfig) =>
    reply(config, { ...receipt, request_id: 'wrong' })
  );
  await expect(
    runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id, hydrate })
  ).rejects.toMatchObject({ cause: { message: 'Atomic creation returned an invalid receipt' } });
  expect(hydrate).not.toHaveBeenCalled();
  expect((await findPendingAtomicCreation(owner, 'document', command.view_id))?.state).toBe('pending');
  await expect(
    runAtomicCreation({
      owner,
      kind: 'document',
      request: { ...command, request_id: 'replacement' },
      logicalTarget: command.view_id,
      hydrate,
    })
  ).rejects.toMatchObject({ cause: { message: 'Recover the original creation before preparing another request' } });
  expect(send).toHaveBeenCalledTimes(1);
});

it('retains the journal but sends nothing after owner cutover during source preparation', async () => {
  const owner = captureAtomicCreationOwner('workspace');

  await expect(
    runAtomicCreation({
      owner,
      kind: 'document',
      request: command,
      logicalTarget: command.view_id,
      beforeSubmit: async () => {
        mockSessionGeneration += 1;
      },
      hydrate: jest.fn(),
    })
  ).rejects.toMatchObject({ cause: { message: 'The account or workspace changed. Retry in the original workspace.' } });
  expect(await db.atomic_creation.count()).toBe(1);
  expect(send).not.toHaveBeenCalled();
});

it('guards the final adapter after an asynchronous request interceptor changes workspace', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const id = getAxios()!.interceptors.request.use(async (config) => {
    await Promise.resolve();
    mockWorkspace = 'another-workspace';
    mockSessionGeneration += 1;
    return config;
  });

  try {
    await expect(atomicRead(owner, '/current')).rejects.toMatchObject({
      diagnosticMessage: 'The account or workspace changed. Retry in the original workspace.',
    });
  } finally {
    getAxios()!.interceptors.request.eject(id);
  }
  expect(send).not.toHaveBeenCalled();
});

it('preserves the command owner across a valid access-token refresh', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  const owner = captureAtomicCreationOwner('workspace');

  grant.defaults.adapter = async (config) => ({
    ...reply(config, undefined),
    data: { ...token(), access_token: 'rotated' },
  });
  await expect(atomicRead(owner, '/current')).resolves.toEqual(receipt);
  expect(send.mock.calls[0][0].headers.Authorization).toBe('Bearer rotated');
  expect(() => owner.assertCurrent()).not.toThrow();
});

it('refuses late refresh publication and transport after a different account signs in', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  const owner = captureAtomicCreationOwner('workspace');
  const entered = deferred<void>();
  const release = deferred<void>();

  grant.defaults.adapter = async (config) => {
    entered.resolve();
    await release.promise;
    return { ...reply(config, undefined), data: { ...token(), access_token: 'late-old-token' } };
  };
  const read = atomicRead(owner, '/current');
  const refused = expect(read).rejects.toBeDefined();

  await entered.promise;
  saveGoTrueAuth(JSON.stringify(token('other')));
  release.resolve();
  await refused;
  expect(getTokenParsed()?.user.id).toBe('other');
  expect(send).not.toHaveBeenCalled();
});

it('preserves a replacement account when ordinary and atomic requests share an older held refresh', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  const owner = captureAtomicCreationOwner('workspace');
  const entered = deferred<void>();
  const release = deferred<void>();
  const refresh = jest.fn(async (config: InternalAxiosRequestConfig) => {
    entered.resolve();
    await release.promise;
    return { ...reply(config, undefined), data: { ...token(), access_token: 'old-refreshed-token' } };
  });

  grant.defaults.adapter = refresh;
  const ordinary = getAxios()!.get('/ordinary-sibling');
  const atomic = atomicRead(owner, '/atomic-sibling');
  const results = Promise.allSettled([ordinary, atomic]);

  await entered.promise;
  // Both request interceptors join the same refresh before changing accounts.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  saveGoTrueAuth(JSON.stringify(token('other')));
  release.resolve();
  expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(getTokenParsed()?.user.id).toBe('other');
  expect(send).not.toHaveBeenCalled();
});

it('keeps ordinary same-account token refresh and anonymous requests working', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  grant.defaults.adapter = async (config) => ({
    ...reply(config, undefined),
    data: { ...token(), access_token: 'ordinary-refreshed-token' },
  });

  await getAxios()!.get('/ordinary-refreshed');
  expect(send.mock.calls[0][0].headers.Authorization).toBe('Bearer ordinary-refreshed-token');
  expect(getTokenParsed()?.user.id).toBe('user');
  invalidToken();
  await getAxios()!.get('/anonymous');
  expect(send.mock.calls[1][0].headers.Authorization).toBeUndefined();
});

it('does not invalidate a replacement account after an ordinary request returns a late 401', async () => {
  const refresh = jest.fn();

  grant.defaults.adapter = refresh;
  send.mockImplementation(async (config: InternalAxiosRequestConfig) => {
    saveGoTrueAuth(JSON.stringify(token('other')));
    throw new axios.AxiosError('old request authorization failed', 'ERR_BAD_REQUEST', config, undefined, {
      ...reply(config, undefined),
      status: 401,
    });
  });
  await expect(getAxios()!.get('/ordinary-old-account')).rejects.toBeDefined();
  expect(getTokenParsed()?.user.id).toBe('other');
  expect(refresh).not.toHaveBeenCalled();
});

it('still clears the current login when its ordinary request cannot refresh', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  grant.defaults.adapter = async () => { throw new Error('refresh denied'); };

  await expect(getAxios()!.get('/ordinary-expired')).rejects.toThrow('refresh denied');
  expect(getTokenParsed()).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('stores a late valid receipt under the original owner without activating after logout', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const hydrate = jest.fn();

  send.mockImplementation(async (config: InternalAxiosRequestConfig) => {
    invalidToken();
    return reply(config, receipt);
  });
  await expect(
    runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id, hydrate })
  ).rejects.toMatchObject({ cause: { message: 'The account or workspace changed. Retry in the original workspace.' } });
  expect(hydrate).not.toHaveBeenCalled();
  expect((await db.atomic_creation.toArray())[0]).toMatchObject({ userId: 'user', state: 'committed' });
});

it('fails the first authoritative HTTP read without the ordinary GET retry policy', async () => {
  const owner = captureAtomicCreationOwner('workspace');

  send.mockImplementation(async (config: InternalAxiosRequestConfig) => {
    throw new axios.AxiosError('unavailable', 'ERR_BAD_RESPONSE', config, undefined, {
      ...reply(config, undefined),
      status: 503,
      data: { code: -1, message: 'unavailable' },
    });
  });
  await expect(atomicRead(owner, '/current')).rejects.toMatchObject({ diagnosticMessage: 'unavailable', httpStatus: 503 });
  expect(send).toHaveBeenCalledTimes(1);
});

it('does not activate a late read or invalidate a replacement account on old 401', async () => {
  const owner = captureAtomicCreationOwner('workspace');

  send.mockImplementation(async (config: InternalAxiosRequestConfig) => {
    saveGoTrueAuth(JSON.stringify(token('other')));
    throw new axios.AxiosError('old authorization failed', 'ERR_BAD_REQUEST', config, undefined, {
      ...reply(config, undefined),
      status: 401,
    });
  });
  await expect(atomicRead(owner, '/current')).rejects.toBeDefined();
  expect(getTokenParsed()?.user.id).toBe('other');
  expect(send).toHaveBeenCalledTimes(1);
});

it('discards only page creations from an earlier page load on reload', async () => {
  const { discardPageCreationsFromEarlierLoads } = await import('..');
  const saved = (kind: string, logicalTarget: string, createdAt: number, workspaceId = 'workspace') => ({
    id: JSON.stringify([server, 'user', workspaceId, kind, logicalTarget]),
    serverUrl: server,
    userId: 'user',
    workspaceId,
    kind,
    logicalTarget,
    requestId: `request-${kind}-${logicalTarget}-${workspaceId}`,
    requestJson: '{}',
    state: 'pending' as const,
    createdAt,
  });

  await db.atomic_creation.bulkAdd([
    saved('document', 'old-page', 0),
    saved('database', 'old-database', 0),
    saved('row-document', 'old-row-page', 0),
    saved('database-view', 'old-view', 0),
    saved('document', 'other-workspace-page', 0, 'other-workspace'),
    saved('document', 'current-page', Date.now()),
  ] as never);

  await discardPageCreationsFromEarlierLoads('workspace');

  expect((await db.atomic_creation.toArray()).map((record) => record.logicalTarget).sort()).toEqual([
    'current-page',
    'old-row-page',
    'old-view',
    'other-workspace-page',
  ]);
});

it('prevents a concurrent explicit recovery from sending', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const entered = deferred<void>();
  const release = deferred<void>();
  const create = runAtomicCreation({
    owner,
    kind: 'document',
    request: command,
    logicalTarget: command.view_id,
    beforeSubmit: async () => {
      entered.resolve();
      await release.promise;
      throw new Error('source unavailable');
    },
    hydrate: jest.fn(),
  });
  const failed = expect(create).rejects.toBeDefined();

  await entered.promise;
  const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

  await expect(recoverAtomicCreation({ owner, record, hydrate: jest.fn() })).rejects.toHaveProperty(
    'cause.message',
    'Creation is already in progress'
  );
  release.resolve();
  await failed;
  expect(send).not.toHaveBeenCalled();
});

it('applies the same actual-send owner fence to a protobuf full-sync source read', async () => {
  const { collabFullSyncBatch } = await import('@/application/services/js-services/http/collab-api');
  const { Types } = await import('@/application/types');
  const owner = captureAtomicCreationOwner('workspace');
  const id = getAxios()!.interceptors.request.use(async (config) => {
    mockSessionGeneration += 1;
    return config;
  });

  try {
    await expect(collabFullSyncBatch('workspace', [{ objectId: command.view_id, collabType: Types.Database,
      stateVector: new Uint8Array(), docState: new Uint8Array() }], { atomicCreationOwner: owner })).rejects.toThrow();
  } finally { getAxios()!.interceptors.request.eject(id); }
  expect(send).not.toHaveBeenCalled();
});


it('cancels the actual POST at the shared workflow deadline and retains exact retry bytes', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const controller = new AbortController();
  const entered = deferred<void>();
  const hydrate = jest.fn();

  send.mockImplementation((config: InternalAxiosRequestConfig) => new Promise((_resolve, reject) => {
    expect(config.signal?.aborted).toBe(false);
    config.signal!.addEventListener!('abort', () => reject(new axios.CanceledError('workflow deadline')), { once: true });
    entered.resolve();
  }));
  const create = runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id,
    signal: controller.signal, hydrate });
  const failed = expect(create).rejects.toMatchObject({ cause: { message: 'Atomic creation cancelled' } });

  await entered.promise;
  controller.abort(new Error('workflow deadline'));
  await failed;
  const record = await findPendingAtomicCreation(owner, 'document', command.view_id);

  expect(record).toMatchObject({ state: 'pending', requestJson: JSON.stringify(command) });
  expect(hydrate).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
  // An explicit retry has a fresh budget and reuses the immutable command.
  send.mockImplementation(async (config: InternalAxiosRequestConfig) => reply(config, receipt));
  await expect(recoverAtomicCreation({ owner, record: record!, hydrate: async () => 'ready',
    signal: new AbortController().signal })).resolves.toBe('ready');
  expect(send.mock.calls[1][0].data).toBe(JSON.stringify(command));
});

describe('explicit server RetryLater during atomic creation', () => {
  afterEach(() => jest.useRealTimers());

  const retryLater = (config: InternalAxiosRequestConfig) => ({
    ...reply(config, undefined),
    data: { code: -5, message: 'creation dependency has no durable source' },
  });

  it.each([200, 503])('retries only the identical serialized request after an explicit RetryLater response (HTTP %i)', async (status) => {
    jest.useFakeTimers();
    send.mockImplementationOnce(async (config) => {
      const response = { ...retryLater(config), status };

      if (status === 503) throw new axios.AxiosError('retry later', 'ERR_BAD_RESPONSE', config, undefined, response);
      return response;
    });
    const requestJson = JSON.stringify(command);
    const post = postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', requestJson);

    await jest.advanceTimersByTimeAsync(100);
    await expect(post).resolves.toEqual(receipt);
    expect(send.mock.calls.map(([config]) => config.data)).toEqual([requestJson, requestJson]);
    expect(send.mock.calls[1][0].timeout).toBeLessThan(send.mock.calls[0][0].timeout);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries row-page creation with the same request while its durable Row source settles', async () => {
    const request: PublishRowDocumentRequest = {
      request_id: command.request_id,
      database_id: '00000000-0000-4000-8000-000000000004',
      database_restore_id: '00000000-0000-0000-0000-000000000000',
      row_id: '00000000-0000-4000-8000-000000000005',
      source_view_id: command.parent_view_id,
      name: 'Row page',
      contribution: { kind: 'default_schema', schema_version: 'v1' },
    };
    const rowReceipt: AtomicCreationReceipt<'row-document'> = {
      request_id: request.request_id,
      outcome: 'applied',
      result: {
        document_id: command.view_id,
        row_id: request.row_id,
        database_id: request.database_id,
        database_restore_id: request.database_restore_id,
        row_version: null,
        document_version: null,
        update_batch_id: '00000000-0000-4000-8000-000000000006',
      },
    };

    send.mockImplementationOnce(async (config) => retryLater(config));
    send.mockImplementation(async (config) => reply(config, rowReceipt));
    jest.useFakeTimers();
    const requestJson = JSON.stringify(request);
    const post = postAtomicCreation(captureAtomicCreationOwner('workspace'), 'row-document', requestJson);

    await jest.advanceTimersByTimeAsync(100);
    await expect(post).resolves.toEqual(rowReceipt);
    expect(send.mock.calls.map(([config]) => [config.url, config.data])).toEqual([
      ['/api/workspace/workspace/v2/page-view/row-document', requestJson],
      ['/api/workspace/workspace/v2/page-view/row-document', requestJson],
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains the exact pending journal after the finite RetryLater attempt limit is exhausted', async () => {
    const owner = captureAtomicCreationOwner('workspace');

    send.mockRejectedValueOnce(new Error('initial unknown outcome'));
    await expect(runAtomicCreation({ owner, kind: 'document', request: command,
      logicalTarget: command.view_id, hydrate: jest.fn() })).rejects.toBeDefined();
    const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

    send.mockClear();
    send.mockImplementation(async (config) => retryLater(config));
    jest.useFakeTimers();
    const recovery = recoverAtomicCreation({ owner, record, hydrate: jest.fn() });
    const failed = expect(recovery).rejects.toMatchObject({ cause: { code: -5 } });

    await jest.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(send).toHaveBeenCalledTimes(16);
    expect(send.mock.calls.every(([config]) => config.data === record.requestJson)).toBe(true);
    jest.useRealTimers();
    expect(await db.atomic_creation.get(record.id)).toMatchObject({
      state: 'pending', requestJson: record.requestJson, requestId: record.requestId,
    });
  });

  it.each(['owner', 'offline', 'capability', 'cancel'] as const)(
    'does not resend after %s changes during the retry wait', async (change) => {
      jest.useFakeTimers();
      const controller = new AbortController();

      send.mockImplementation(async (config) => retryLater(config));
      const post = postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document',
        JSON.stringify(command), controller.signal);
      const failed = expect(post).rejects.toBeDefined();

      await jest.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(1);
      if (change === 'owner') mockSessionGeneration += 1;
      else if (change === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      else if (change === 'capability') updateServerInfo(server, { status: 'unsupported' });
      else controller.abort();
      await jest.advanceTimersByTimeAsync(100);
      await failed;
      expect(send).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('uses one overall deadline even without a caller signal or when a later attempt stalls', async () => {
    jest.useFakeTimers();
    send.mockImplementationOnce(async (config) => retryLater(config));
    send.mockImplementation((config: InternalAxiosRequestConfig) => new Promise((_resolve, reject) => {
      config.signal!.addEventListener!('abort', () => reject(new axios.CanceledError('cancelled')), { once: true });
    }));
    const post = postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', JSON.stringify(command));
    const failed = expect(post).rejects.toMatchObject({ message: 'Atomic creation cancelled' });

    await jest.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].timeout).toBe(29_900);
    await jest.advanceTimersByTimeAsync(29_900);
    await failed;
    expect(send.mock.calls[1][0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rechecks creation admission after asynchronous request interceptors before sending', async () => {
    const interceptor = getAxios()!.interceptors.request.use(async (config) => {
      await Promise.resolve();
      updateServerInfo(server, { status: 'unsupported' });
      return config;
    });

    try {
      await expect(postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', JSON.stringify(command)))
        .rejects.toBeDefined();
      expect(send).not.toHaveBeenCalled();
    } finally {
      getAxios()!.interceptors.request.eject(interceptor);
    }
  });

  it('does not resend when wall time passes the deadline before the timeout callback can run', async () => {
    jest.useFakeTimers();
    send.mockImplementation(async (config) => retryLater(config));
    const post = postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', JSON.stringify(command));
    const failed = expect(post).rejects.toMatchObject({ message: 'Atomic creation cancelled' });

    await jest.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Simulate a suspended/background tab: advancing wall time leaves its
    // scheduled timers pending, then the shorter backoff resumes first.
    jest.setSystemTime(Date.now() + 30_000);
    await jest.advanceTimersByTimeAsync(100);
    await failed;
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('checks the wall-clock deadline again after an asynchronous interceptor before dispatch', async () => {
    jest.useFakeTimers();
    const interceptor = getAxios()!.interceptors.request.use(async (config) => {
      await Promise.resolve();
      jest.setSystemTime(Date.now() + 30_001);
      return config;
    });

    try {
      await expect(postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', JSON.stringify(command)))
        .rejects.toBeDefined();
      expect(send).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      getAxios()!.interceptors.request.eject(interceptor);
    }
  });

  it.each(['transport', 'permission', 'string-code', 'string-code-http'] as const)('does not retry an ambiguous or unrelated %s error', async (failure) => {
    jest.useFakeTimers();
    if (failure === 'transport') send.mockRejectedValue(new Error('connection closed after possible commit'));
    else send.mockImplementation(async (config) => {
      const response = { ...reply(config, undefined),
        status: failure === 'string-code-http' ? 503 : 200,
        data: { code: failure === 'permission' ? 403 : '-5', message: 'request failed' } };

      if (response.status === 503) throw new axios.AxiosError('request failed', 'ERR_BAD_RESPONSE', config, undefined, response);
      return response;
    });

    await expect(postAtomicCreation(captureAtomicCreationOwner('workspace'), 'document', JSON.stringify(command)))
      .rejects.toBeDefined();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

it('does not submit when source preparation consumes the remaining workflow budget', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const controller = new AbortController();

  await expect(runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id,
    signal: controller.signal, beforeSubmit: async () => controller.abort(), hydrate: jest.fn(),
  })).rejects.toMatchObject({ cause: { message: 'Atomic creation cancelled' } });
  expect(send).not.toHaveBeenCalled();
  expect((await findPendingAtomicCreation(owner, 'document', command.view_id))?.state).toBe('pending');
});


it('expires while refresh is held, preserves the shared refresh, and never sends the cancelled command', async () => {
  saveGoTrueAuth(JSON.stringify(token('user', true)));
  const owner = captureAtomicCreationOwner('workspace');
  const controller = new AbortController();
  const entered = deferred<void>();
  const release = deferred<void>();
  const hydrate = jest.fn();

  grant.defaults.adapter = async (config) => {
    entered.resolve();
    await release.promise;
    return { ...reply(config, undefined), data: { ...token(), access_token: 'refreshed-after-cancel' } };
  };
  const create = runAtomicCreation({ owner, kind: 'document', request: command, logicalTarget: command.view_id,
    signal: controller.signal, hydrate });
  const expired = expect(create).rejects.toMatchObject({ cause: { message: 'Atomic creation cancelled' } });

  await entered.promise;
  controller.abort();
  await expired; // The refresh remains held: this await proves caller deadline cancellation.
  expect(getTokenParsed()?.user.id).toBe('user');
  expect(send).not.toHaveBeenCalled();
  expect(hydrate).not.toHaveBeenCalled();
  expect((await findPendingAtomicCreation(owner, 'document', command.view_id))?.state).toBe('pending');

  // A sibling request can still use the shared refresh. Releasing it must not send the old POST.
  const sibling = atomicRead(owner, '/sibling');

  release.resolve();
  await expect(sibling).resolves.toEqual(receipt);
  expect(getTokenParsed()?.access_token).toBe('refreshed-after-cancel');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].url).toBe('/sibling');
  expect(() => owner.assertCurrent()).not.toThrow();
});

it('retains the committed recipe when the workspace owner changes while hydration is held', async () => {
  const owner = captureAtomicCreationOwner('workspace');
  const entered = deferred<void>();
  const release = deferred<void>();
  const create = runAtomicCreation({
    owner,
    kind: 'document',
    request: command,
    logicalTarget: command.view_id,
    hydrate: async () => {
      entered.resolve();
      await release.promise;
      return 'old owner content';
    },
  });
  const failed = expect(create).rejects.toMatchObject({
    cause: { message: 'The account or workspace changed. Retry in the original workspace.' },
  });

  await entered.promise;
  const record = (await findPendingAtomicCreation(owner, 'document', command.view_id))!;

  expect(record.state).toBe('committed');
  mockSessionGeneration += 1;
  release.resolve();
  await failed;
  expect(await db.atomic_creation.get(record.id)).toMatchObject({
    state: 'committed',
    requestJson: JSON.stringify(command),
    userId: 'user',
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps the exact recipe and staged edits when the real document checkpoint transaction aborts', async () => {
  const Y = await import('yjs');
  const { IndexeddbPersistence } = await import('y-indexeddb');
  const { persistStagedBodyCheckpoint } = await import('@/application/row-document/first-body-checkpoint');
  const owner = captureAtomicCreationOwner('workspace');
  const doc = new Y.Doc({ guid: command.view_id });
  const provider = new IndexeddbPersistence(`journal-checkpoint-${command.view_id}`, doc);

  await provider.whenSynced;
  doc.off('update', provider._storeUpdate);
  doc.getText('body').insert(0, 'accepted after sealing');
  const staging = JSON.stringify({ version: 1, documentId: doc.guid, changes: [] });
  const originalPut = IDBObjectStore.prototype.put;
  const put = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    const request = originalPut.call(this, value, key);

    if (this.name === 'custom' && key === `${doc.guid}/first-body-stage`) {
      request.addEventListener('success', () => this.transaction.abort());
    }

    return request;
  });

  try {
    await expect(runAtomicCreation({
      owner,
      kind: 'document',
      request: command,
      logicalTarget: command.view_id,
      onPrepared: async (record) => {
        await db.atomic_creation.update(record.id, { rowDocumentStagingJson: staging });
      },
      hydrate: async () => {
        await persistStagedBodyCheckpoint(doc, provider, staging, {
          assertCurrent: owner.assertCurrent,
          signal: new AbortController().signal,
        });
        return doc;
      },
    })).rejects.toMatchObject({ cause: { message: 'The row-page checkpoint was not persisted.' } });
    expect(await findPendingAtomicCreation(owner, 'document', command.view_id)).toMatchObject({
      state: 'committed',
      requestJson: JSON.stringify(command),
      rowDocumentStagingJson: staging,
    });
    expect(await provider.get(`${doc.guid}/first-body-stage`)).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    put.mockRestore();
    await provider.clearData();
    doc.destroy();
  }
});
