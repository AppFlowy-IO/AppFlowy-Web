import { AccessLevel, SpaceVisibility, ViewLayout } from '@/application/types';

import { SpaceCreationIntent, SpaceCreationIntentStore } from '../space-creation-intent';

let mockUser = 'actor-a';
let mockServer = 'https://server-a';
const mockClient = {};

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUser } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('../http/core', () => ({ getAxios: () => mockClient }));
jest.mock('i18next', () => ({ t: (key: string) => key }));

const draft = (): SpaceCreationIntent => ({
  payload: { name: 'Original', view_id: 'space-a', client_generated_view_id: true,
    permission: { visibility: SpaceVisibility.Custom } as SpaceCreationIntent['payload']['permission'] },
  initialPage: { layout: ViewLayout.Document, name: 'Original page', view_id: 'page-a' },
  selectedMembers: [], members: [{ uid: 'member-a', userUuid: 'member-uuid', accessLevel: AccessLevel.ReadOnly }],
  appliedMemberUids: [],
});

beforeEach(() => { sessionStorage.clear(); mockUser = 'actor-a'; mockServer = 'https://server-a'; });

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
