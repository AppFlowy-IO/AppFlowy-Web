import { CreateWorkspacePayload } from '@/application/types';

import { CreateWorkspaceOptions } from '../http/workspace-api';
import { WorkspaceCreationAttempt } from '../workspace-creation-attempt';

let mockUser = 'actor-a';
let mockServer = 'https://server-a';
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUser } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('../http/core', () => ({ getAxios: () => mockClient }));
jest.mock('i18next', () => ({ t: (key: string) => key }));

type Create = (payload: CreateWorkspacePayload, options: CreateWorkspaceOptions) => Promise<string>;

const storageKey = () => 'workspace-creation:v1:' + JSON.stringify([mockServer, mockUser]);

/** Simulates the HTTP helper: a new attempt reserves its request ID only right before sending. */
function server(...outcomes: Array<string | object | Error>) {
  return jest.fn<ReturnType<Create>, Parameters<Create>>(async (_payload, options) => {
    if (!options.replay) options.reserve?.();
    const outcome = outcomes.length > 1 ? outcomes.shift() : outcomes[0];

    if (typeof outcome === 'string') return outcome;
    throw outcome;
  });
}

beforeEach(() => {
  sessionStorage.clear();
  mockUser = 'actor-a';
  mockServer = 'https://server-a';
});

test('a lost reply survives remount with the same immutable request and original payload', async () => {
  const create = server({ code: -1, message: 'Network Error' }, 'original-workspace');
  const first = new WorkspaceCreationAttempt(create);

  await expect(first.run('Original name')).rejects.toThrow('workspaceCreation.notConfirmed');
  const recreated = new WorkspaceCreationAttempt(create);
  const requestId = recreated.snapshot()?.requestId;

  expect(recreated.snapshot()).toEqual({ requestId, name: 'Original name' });
  await expect(recreated.run('Changed name')).rejects.toThrow('workspaceCreation.immutableDraft');
  expect(create).toHaveBeenCalledTimes(1);
  expect(await recreated.run('Original name')).toBe('original-workspace');
  expect(create.mock.calls[1]).toEqual([{ workspace_name: 'Original name' }, { replay: requestId }]);
  // The confirmed ID is reused, so retrying navigation never sends another creation.
  expect(await new WorkspaceCreationAttempt(create).run('Original name')).toBe('original-workspace');
  expect(create).toHaveBeenCalledTimes(2);
  recreated.complete('different-workspace');
  expect(recreated.snapshot()).toBeDefined();
  recreated.complete('original-workspace');
  expect(recreated.snapshot()).toBeUndefined();
});

test.each(['server', 'account'])('pending %s switches cannot adopt or finish an old request', async (dimension) => {
  let resolve!: (id: string) => void;
  const create = jest.fn<ReturnType<Create>, Parameters<Create>>((_payload, options) => {
    options.reserve?.();
    return new Promise<string>((done) => {
      resolve = done;
    });
  });
  const first = new WorkspaceCreationAttempt(create);
  const response = first.run('Original name');

  await Promise.resolve();
  if (dimension === 'server') mockServer = 'https://server-b';
  else mockUser = 'actor-b';
  expect(new WorkspaceCreationAttempt(create).snapshot()).toBeUndefined();
  resolve('original-workspace');
  await expect(response).rejects.toThrow('workspaceCreation.contextChanged');
  mockServer = 'https://server-a';
  mockUser = 'actor-a';
  expect(new WorkspaceCreationAttempt(create).snapshot()).toMatchObject({ name: 'Original name' });
});

test('concurrent submits share one request', async () => {
  let reject!: (error: unknown) => void;
  const create = jest.fn<ReturnType<Create>, Parameters<Create>>((_payload, options) => {
    options.reserve?.();
    return new Promise<string>((_resolve, fail) => {
      reject = fail;
    });
  });
  const attempt = new WorkspaceCreationAttempt(create);
  const first = attempt.run('Original name');
  const second = attempt.run('Original name');

  expect(first).toBe(second);
  await Promise.resolve();
  expect(create).toHaveBeenCalledTimes(1);
  reject({ code: -1 });
  await expect(first).rejects.toThrow('workspaceCreation.notConfirmed');
  expect(create).toHaveBeenCalledTimes(1);
});

test('a failure before sending, such as a fresh denial, leaves nothing to resume', async () => {
  const create = jest
    .fn<ReturnType<Create>, Parameters<Create>>()
    .mockRejectedValueOnce(new Error('workspaceCreation.denied'))
    .mockRejectedValueOnce(new Error('workspaceCreation.unavailable'))
    .mockImplementation(async (_payload, options) => {
      options.reserve?.();
      return 'created';
    });
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('First name')).rejects.toThrow('workspaceCreation.denied');
  expect(attempt.snapshot()).toBeUndefined();
  await expect(attempt.run('Second name')).rejects.toThrow('workspaceCreation.unavailable');
  expect(attempt.snapshot()).toBeUndefined();
  // A different name is accepted: no stale request locks the form.
  expect(await attempt.run('Third name')).toBe('created');
  expect(create.mock.calls.map(([payload]) => payload.workspace_name)).toEqual([
    'First name',
    'Second name',
    'Third name',
  ]);
});

test.each([
  ['an over-long name', { code: 1008, message: 'Workspace name is too long' }],
  ['a request ID reused with another payload', { code: -3, message: 'conflict' }],
  ['a seat limit', { code: 1120, message: 'limit' }],
  ['HTTP 400', { code: 400, httpStatus: 400, message: 'Bad Request' }],
  ['HTTP 409', { code: 409, httpStatus: 409, message: 'Conflict' }],
  ['HTTP 422', { code: 422, httpStatus: 422, message: 'Unprocessable' }],
  // A first request has no earlier commit to hide, so a sign-in rejection also created nothing.
  ['an expired sign-in (HTTP 401)', { code: 401, httpStatus: 401, message: 'Unauthorized' }],
  ['a signed-out session (1011)', { code: 1011, message: 'Not logged in' }],
  ['an invalid session (1024)', { code: 1024, message: 'Invalid user session' }],
])('a definitive rejection (%s) releases the request', async (_label, error) => {
  const attempt = new WorkspaceCreationAttempt(server(error, 'created'));

  await expect(attempt.run('A'.repeat(120))).rejects.toMatchObject({ message: error.message });
  expect(attempt.snapshot()).toBeUndefined();
  expect(await attempt.run('Shorter name')).toBe('created');
});

test.each([{ code: 1012, message: 'Forbidden' }, { code: 403, httpStatus: 403, message: 'Forbidden' }])(
  'a denial after sending releases the request and explains it in plain words',
  async (error) => {
    const attempt = new WorkspaceCreationAttempt(server(error));

    await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.denied');
    expect(attempt.snapshot()).toBeUndefined();
  }
);

test('a first request that reaches a node without the keyed route created nothing', async () => {
  const create = server({ code: 404, httpStatus: 404, message: 'Not Found' });
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.tryAgainLater');
  expect(attempt.snapshot()).toBeUndefined();
  expect(create).toHaveBeenCalledTimes(1);
});

test.each([
  ['network loss', { code: -1, message: 'Network Error' }],
  ['a timeout', new Error('timeout of 30000ms exceeded')],
  ['HTTP 502', { code: 502, httpStatus: 502, message: 'Bad Gateway' }],
  ['a concurrent attempt still running', { code: -5, message: 'retry later' }],
  ['an internal error', { code: 1017, message: 'Internal' }],
])('an ambiguous outcome (%s) keeps the request for Check again', async (_label, error) => {
  const create = server(error, 'original-workspace');
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  const draft = attempt.snapshot();

  expect(draft).toMatchObject({ name: 'Name' });
  expect(await attempt.run('Name')).toBe('original-workspace');
  expect(create.mock.calls[1][1]).toEqual({ replay: draft?.requestId });
});

test('a replay keeps the request after an old-node 404 and releases it after a definitive denial', async () => {
  const create = server({ code: -1 }, { code: 404, httpStatus: 404 }, { code: 1012, message: 'denied' });
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  // An earlier request may have committed elsewhere; a later 404 proves nothing.
  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  expect(attempt.snapshot()).toMatchObject({ name: 'Name' });
  // The server resolves a completed receipt before admission, so a denial means nothing was created.
  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.denied');
  expect(attempt.snapshot()).toBeUndefined();
});

test.each([
  ['an expired sign-in (HTTP 401)', { code: 401, httpStatus: 401, message: 'Request failed with status code 401' }],
  ['a proxy denial without a server code (HTTP 403)', { code: 403, httpStatus: 403, message: 'Forbidden' }],
  ['a proxy rejection without a server code (HTTP 400)', { code: 400, httpStatus: 400, message: 'Bad Request' }],
  ['a signed-out session (1011)', { code: 1011, message: 'Not logged in' }],
  ['an invalid session (1024)', { code: 1024, message: 'Invalid user session' }],
])('a replay rejected before the saved request is looked up (%s) keeps it for Check again', async (_label, error) => {
  const create = server({ code: -1, message: 'Network Error' }, error, 'original-workspace');
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  const draft = attempt.snapshot();

  // Sign-in and proxies answer before the server reads the saved request, so the first request may
  // still have committed. Releasing here would let a new request create a second workspace.
  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  expect(attempt.snapshot()).toEqual(draft);
  expect(await attempt.run('Name')).toBe('original-workspace');
  expect(create.mock.calls.slice(1).map(([, options]) => options)).toEqual([
    { replay: draft?.requestId },
    { replay: draft?.requestId },
  ]);
});

test.each([
  ['a denial', { code: 1012, message: 'denied' }, 'workspaceCreation.denied'],
  ['a denial sent with HTTP 403', { code: 1012, httpStatus: 403, message: 'denied' }, 'workspaceCreation.denied'],
  ['an over-long name', { code: 1008, message: 'Workspace name is too long' }, 'Workspace name is too long'],
  ['a request ID reused with another payload', { code: -3, message: 'conflict' }, 'conflict'],
  ['a result that is no longer accessible', { code: -2, message: 'no longer accessible' }, 'no longer accessible'],
  ['a workspace limit', { code: 1026, message: 'workspace limit' }, 'workspace limit'],
  ['a member limit', { code: 1027, message: 'member limit' }, 'member limit'],
  ['a seat limit', { code: 1120, message: 'seat limit' }, 'seat limit'],
])('a replay answered after the saved request is looked up (%s) releases it', async (_label, error, message) => {
  const attempt = new WorkspaceCreationAttempt(server({ code: -1, message: 'Network Error' }, error));

  await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.notConfirmed');
  await expect(attempt.run('Name')).rejects.toMatchObject({ message });
  expect(attempt.snapshot()).toBeUndefined();
});

test('a commit held beyond the client timeout is recovered with the original request', async () => {
  let release!: () => void;
  const commitBarrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const receipts = new Map<string, string>();
  let serverWrite!: Promise<void>;
  const create = jest
    .fn<ReturnType<Create>, Parameters<Create>>()
    .mockImplementationOnce(async (_payload, options) => {
      const requestId = options.reserve!();

      serverWrite = commitBarrier.then(() => {
        receipts.set(requestId, 'original-workspace');
      });
      throw new Error('timeout before commit');
    })
    .mockRejectedValueOnce({ code: 404, httpStatus: 404 })
    .mockRejectedValueOnce({ code: -5, message: 'still in progress' })
    .mockImplementation(async (_payload, options) => receipts.get(options.replay ?? '') ?? 'unexpected');

  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toThrow('notConfirmed');
  const original = new WorkspaceCreationAttempt(create).snapshot();

  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toThrow('notConfirmed');
  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toThrow('notConfirmed');
  expect(new WorkspaceCreationAttempt(create).snapshot()).toEqual(original);
  release();
  await serverWrite;
  await expect(new WorkspaceCreationAttempt(create).run('Original')).resolves.toBe('original-workspace');
  expect(receipts.size).toBe(1);
  expect(create.mock.calls.slice(1).every(([, options]) => options.replay === original?.requestId)).toBe(true);
  expect(create.mock.calls.every(([payload]) => payload.workspace_name === 'Original')).toBe(true);
});

test('a legacy server creates without a request ID and the result still prevents a duplicate', async () => {
  const create = jest.fn<ReturnType<Create>, Parameters<Create>>().mockResolvedValue('legacy-workspace');
  const attempt = new WorkspaceCreationAttempt(create);

  expect(await attempt.run('Legacy')).toBe('legacy-workspace');
  expect(attempt.snapshot()).toMatchObject({ name: 'Legacy', workspaceId: 'legacy-workspace' });
  expect(await new WorkspaceCreationAttempt(create).run('Legacy')).toBe('legacy-workspace');
  expect(create).toHaveBeenCalledTimes(1);
  attempt.complete('legacy-workspace');
  expect(attempt.snapshot()).toBeUndefined();
});

test('a legacy failure has no request to resume', async () => {
  const create = jest.fn<ReturnType<Create>, Parameters<Create>>().mockRejectedValue({ code: -1, message: 'Network Error' });
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('Legacy')).rejects.toMatchObject({ message: 'Network Error' });
  expect(attempt.snapshot()).toBeUndefined();
});

test('a storage failure stops before sending', async () => {
  const create = server('created');
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('Quota');
  });

  await expect(new WorkspaceCreationAttempt(create).run('Original name')).rejects.toThrow('Quota');
  write.mockRestore();
  expect(sessionStorage.getItem(storageKey())).toBeNull();
});

test.each(['{malformed', 'null', '[]', '"text"', '{"requestId":1,"name":"x"}', '{"requestId":"r","name":"x","workspaceId":3}'])(
  'an unreadable saved request (%s) is reported in plain words and only removed by Discard',
  async (stored) => {
    const create = server('created');

    sessionStorage.setItem(storageKey(), stored);
    const attempt = new WorkspaceCreationAttempt(create);

    expect(() => attempt.snapshot()).toThrow('workspaceCreation.invalidDraft');
    await expect(attempt.run('Name')).rejects.toThrow('workspaceCreation.invalidDraft');
    expect(create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey())).toBe(stored);
    attempt.discard();
    expect(attempt.snapshot()).toBeUndefined();
    expect(await attempt.run('Name')).toBe('created');
  }
);

test('Discard forgets an unconfirmed request so a new name can be used', async () => {
  const create = server({ code: -1 }, 'second');
  const attempt = new WorkspaceCreationAttempt(create);

  await expect(attempt.run('First')).rejects.toThrow('notConfirmed');
  attempt.discard();
  expect(attempt.snapshot()).toBeUndefined();
  expect(await attempt.run('Second')).toBe('second');
  expect(create.mock.calls[1][0]).toEqual({ workspace_name: 'Second' });
  expect(create.mock.calls[1][1].replay).toBeUndefined();
});
