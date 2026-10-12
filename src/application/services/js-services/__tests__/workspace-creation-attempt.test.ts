import { WorkspaceCreationAttempt } from '../workspace-creation-attempt';

let mockUser = 'actor-a';
let mockServer = 'https://server-a';
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUser } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('../http/core', () => ({ getAxios: () => mockClient }));
jest.mock('i18next', () => ({ t: (key: string) => key }));

beforeEach(() => { sessionStorage.clear(); mockUser = 'actor-a'; mockServer = 'https://server-a'; });

test('lost replies survive remount with the same immutable request and original payload', async () => {
  const create = jest.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue('original-workspace');
  const first = new WorkspaceCreationAttempt(create);

  await expect(first.run('Original name')).rejects.toThrow('Lost response');
  const recreated = new WorkspaceCreationAttempt(create);

  await expect(recreated.run('Changed name')).rejects.toThrow('workspaceCreation.immutableDraft');
  expect(create).toHaveBeenCalledTimes(1);
  expect(await recreated.run('Original name')).toBe('original-workspace');
  expect(create.mock.calls[0][0]).toEqual({ workspace_name: 'Original name' });
  expect(create.mock.calls[1]).toEqual([create.mock.calls[0][0], {
    requestId: create.mock.calls[0][1].requestId, replay: true,
  }]);
  expect(create.mock.calls[0][1].replay).toBe(false);
  expect(await new WorkspaceCreationAttempt(create).run('Original name')).toBe('original-workspace');
  expect(create).toHaveBeenCalledTimes(2);
  recreated.complete('different-workspace');
  expect(recreated.snapshot()).toBeDefined();
  recreated.complete('original-workspace');
  expect(recreated.snapshot()).toBeUndefined();
});

test.each(['server', 'account'])('pending %s switches cannot adopt or finish an old request', async (dimension) => {
  let resolve!: (id: string) => void;
  const create = jest.fn(() => new Promise<string>((done) => { resolve = done; }));
  const first = new WorkspaceCreationAttempt(create);
  const response = first.run('Original name');

  if (dimension === 'server') mockServer = 'https://server-b';
  else mockUser = 'actor-b';
  expect(new WorkspaceCreationAttempt(create).snapshot()).toBeUndefined();
  resolve('original-workspace');
  await expect(response).rejects.toThrow('workspaceCreation.contextChanged');
  mockServer = 'https://server-a';
  mockUser = 'actor-a';
  expect(new WorkspaceCreationAttempt(create).snapshot()).toMatchObject({ name: 'Original name' });
});

test('concurrent submits share the same request and unsupported old nodes never trigger a second route', async () => {
  let reject!: (error: unknown) => void;
  const create = jest.fn(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
  const attempt = new WorkspaceCreationAttempt(create);
  const first = attempt.run('Original name');
  const second = attempt.run('Original name');

  expect(first).toBe(second);
  expect(create).toHaveBeenCalledTimes(1);
  reject({ code: 404 });
  await expect(first).rejects.toThrow('workspaceCreation.receiptUnsupported');
  expect(create).toHaveBeenCalledTimes(1);
  expect(attempt.snapshot()).toMatchObject({ name: 'Original name' });
});

test('storage failure prevents mutation and retains an unreadable earlier request', async () => {
  const create = jest.fn();
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Quota'); });

  await expect(new WorkspaceCreationAttempt(create).run('Original name')).rejects.toThrow('Quota');
  expect(create).not.toHaveBeenCalled();
  write.mockRestore();
  const key = 'workspace-creation:v1:' + JSON.stringify([mockServer, mockUser]);

  sessionStorage.setItem(key, '{malformed');
  await expect(new WorkspaceCreationAttempt(create).run('Original name')).rejects.toThrow();
  expect(sessionStorage.getItem(key)).toBe('{malformed');
  expect(create).not.toHaveBeenCalled();
});

test('a commit held beyond timeout and later 404/denial keeps the original receipt across reloads', async () => {
  let release!: () => void;
  const commitBarrier = new Promise<void>((resolve) => { release = resolve; });
  const receipts = new Map<string, string>();
  let serverWrite!: Promise<void>;
  const create = jest.fn()
    .mockImplementationOnce(async (_payload, receipt) => {
      serverWrite = commitBarrier.then(() => { receipts.set(receipt.requestId, 'original-workspace'); });
      throw new Error('timeout before commit');
    })
    .mockRejectedValueOnce({ code: 404 })
    .mockRejectedValueOnce({ code: 1012, message: 'now denied' })
    .mockImplementation(async (_payload, receipt) => receipts.get(receipt.requestId));

  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toThrow('timeout before commit');
  const original = new WorkspaceCreationAttempt(create).snapshot();

  expect(receipts.size).toBe(0);
  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toThrow('receiptUnsupported');
  await expect(new WorkspaceCreationAttempt(create).run('Original')).rejects.toMatchObject({ code: 1012 });
  expect(new WorkspaceCreationAttempt(create).snapshot()).toEqual(original);
  release();
  await serverWrite;
  await expect(new WorkspaceCreationAttempt(create).run('Original')).resolves.toBe('original-workspace');
  expect(receipts.size).toBe(1);
  expect(new Set(create.mock.calls.map(([, receipt]) => receipt.requestId)).size).toBe(1);
  expect(create.mock.calls.every(([payload]) => payload.workspace_name === 'Original')).toBe(true);
});
