import { AccessLevel, SpaceVisibility, ViewLayout } from '@/application/types';

import { SpaceCreationIntent, SpaceCreationIntentStore } from '../space-creation-intent';

let mockUser = 'actor-a';
let mockServer = 'https://server-a';
// The tab's server restore generation (null: the initial one). A restore reloads every tab.
let mockRestoreId: string | null = null;
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUser } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('../http/core', () => ({ getAxios: () => mockClient }));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('@/application/server-restore', () => ({
  get serverRestore() {
    const { ServerRestoreBoundary } = jest.requireActual('@/application/server-restore');

    return new ServerRestoreBoundary(mockServer, { getItem: () => mockRestoreId, setItem: jest.fn() }, jest.fn());
  },
}));

const draft = (): SpaceCreationIntent => ({
  payload: { name: 'Original', view_id: 'space-a', client_generated_view_id: true,
    permission: { visibility: SpaceVisibility.Custom } as SpaceCreationIntent['payload']['permission'] },
  initialPage: { layout: ViewLayout.Document, name: 'Original page', view_id: 'page-a' },
  selectedMembers: [], members: [{ uid: 'member-a', userUuid: 'member-uuid', accessLevel: AccessLevel.ReadOnly }],
  appliedMemberUids: [],
});

beforeEach(() => { sessionStorage.clear(); mockUser = 'actor-a'; mockServer = 'https://server-a'; mockRestoreId = null; });

test('submitted immutable payload and partial roster survive reload and only complete after full handoff', () => {
  const original = draft();
  const first = new SpaceCreationIntentStore('workspace-a');

  expect(first.snapshot()).toBeUndefined();
  first.begin(original);
  original.payload.name = 'changed local object';
  const reloaded = new SpaceCreationIntentStore('workspace-a');

  expect(reloaded.snapshot()?.payload.name).toBe('Original');
  expect(() => reloaded.begin(original)).toThrow('spaceCreation.pendingRecovery');
  const result = { spaceId: 'space-a', initialPageId: 'page-a' };

  reloaded.committed(result);
  expect(() => reloaded.complete(result)).toThrow('spaceCreation.pendingRecovery');
  reloaded.memberApplied('space-a', 'member-a');
  const final = new SpaceCreationIntentStore('workspace-a');

  expect(final.snapshot()?.appliedMemberUids).toEqual(['member-a']);
  final.complete(result);
  expect(first.snapshot()).toBeUndefined();
});

test.each(['account', 'server', 'workspace'])('isolation retains prior work after a %s switch', (dimension) => {
  const original = new SpaceCreationIntentStore('workspace-a');

  original.begin(draft());
  if (dimension === 'account') mockUser = 'actor-b';
  if (dimension === 'server') mockServer = 'https://server-b';
  expect(new SpaceCreationIntentStore(dimension === 'workspace' ? 'workspace-b' : 'workspace-a').snapshot()).toBeUndefined();
  mockUser = 'actor-a'; mockServer = 'https://server-a';
  expect(new SpaceCreationIntentStore('workspace-a').snapshot()?.payload.view_id).toBe('space-a');
});

test('old scope completion after unmount cannot clear retained work', () => {
  let current = true;
  const store = new SpaceCreationIntentStore('workspace-a', () => current);

  store.begin(draft());
  current = false;
  expect(() => store.memberApplied('space-a', 'member-a')).toThrow('workspaceCreation.contextChanged');
  expect(new SpaceCreationIntentStore('workspace-a').snapshot()?.appliedMemberUids).toEqual([]);
});

test('storage quota or corrupt saved data stops before replacing a request', () => {
  const store = new SpaceCreationIntentStore('workspace-a');
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Quota'); });

  expect(() => store.begin(draft())).toThrow('Quota');
  write.mockRestore();
  expect(store.snapshot()).toBeUndefined();
  const key = `space-creation:v1:${store.scopeKey}`;

  sessionStorage.setItem(key, '{invalid');
  expect(() => store.begin(draft())).toThrow();
  expect(sessionStorage.getItem(key)).toBe('{invalid');
});

test.each(['{invalid', 'null', '"text"', '42'])(
  'unreadable saved data %s reports the translated recovery error and can be discarded',
  (stored) => {
    const store = new SpaceCreationIntentStore('workspace-a');
    const key = `space-creation:v1:${store.scopeKey}`;

    sessionStorage.setItem(key, stored);
    expect(() => store.snapshot()).toThrow('spaceCreation.invalidRecovery');
    expect(() => store.begin(draft())).toThrow('spaceCreation.invalidRecovery');
    expect(sessionStorage.getItem(key)).toBe(stored);
    store.discard();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(store.snapshot()).toBeUndefined();
  }
);

test('discard is fenced to the scope that saved the request', () => {
  let current = true;
  const store = new SpaceCreationIntentStore('workspace-a', () => current);

  store.begin(draft());
  current = false;
  expect(() => store.discard()).toThrow('workspaceCreation.contextChanged');
  expect(new SpaceCreationIntentStore('workspace-a').snapshot()?.payload.view_id).toBe('space-a');
});

test('a first page that cannot be matched is remembered with the request across a reload', () => {
  const store = new SpaceCreationIntentStore('workspace-a');

  store.begin(draft());
  store.recordFirstPageProblem('unconfirmed');
  const reloaded = new SpaceCreationIntentStore('workspace-a');

  expect(reloaded.snapshot()?.firstPageProblem).toBe('unconfirmed');
  // The request itself is unchanged; only Discard ends it.
  expect(reloaded.snapshot()?.payload.view_id).toBe('space-a');
  reloaded.discard();
  expect(reloaded.snapshot()).toBeUndefined();
});

test('recording a first page problem needs the saved request', () => {
  const store = new SpaceCreationIntentStore('workspace-a');

  expect(() => store.recordFirstPageProblem('elsewhere')).toThrow('spaceCreation.invalidRecovery');
  expect(store.snapshot()).toBeUndefined();
});

test('an unknown first page problem is unreadable data, kept until it is discarded', () => {
  const store = new SpaceCreationIntentStore('workspace-a');
  const key = `space-creation:v1:${store.scopeKey}`;
  const stored = JSON.stringify({ ...draft(), firstPageProblem: 'moved' });

  sessionStorage.setItem(key, stored);
  expect(() => store.snapshot()).toThrow('spaceCreation.invalidRecovery');
  expect(sessionStorage.getItem(key)).toBe(stored);
});

test('a request saved before a server restore is never offered against the restored server', () => {
  new SpaceCreationIntentStore('workspace-a').begin(draft());
  // A committed restore reloads the tab onto fresh storage; session storage survives the reload,
  // and the atomic page commands the old request relied on stay in the old generation.
  mockRestoreId = '11111111-1111-4111-8111-111111111111';
  const restored = new SpaceCreationIntentStore('workspace-a');

  expect(restored.snapshot()).toBeUndefined();
  const next = draft();

  next.payload.view_id = 'space-b';
  next.initialPage!.view_id = 'page-b';
  restored.begin(next);
  expect(new SpaceCreationIntentStore('workspace-a').snapshot()?.payload.view_id).toBe('space-b');

  // The earlier generation's request is neither replaced nor removed by the restored one.
  mockRestoreId = null;
  expect(new SpaceCreationIntentStore('workspace-a').snapshot()?.payload.view_id).toBe('space-a');
});
