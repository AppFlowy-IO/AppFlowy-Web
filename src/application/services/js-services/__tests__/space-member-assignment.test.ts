import { AccessLevel, SpaceMemberRole, SpaceVisibility } from '@/application/types';

import {
  getSpaceMembers,
  getSpacePermission,
  updateSpaceGroupPermission,
  updateSpaceMemberByUuid,
} from '../http/workspace-api';
import { setSpaceMemberAccessOverride } from '../space-member-assignment';

const mockClient = {};
let mockActor = 'actor';
let mockServer = 'server';
const userUuid = '12345678-1234-4123-8123-123456789abc';
const groupUuid = '87654321-4321-4123-8123-cba987654321';
const principal = { type: 'user' as const, uuid: userUuid };

jest.mock('../http/core', () => ({ getAxios: () => mockClient }));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockActor } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('../http/workspace-api', () => ({
  getSpacePermission: jest.fn(),
  getSpaceMembers: jest.fn(),
  updateSpaceMemberByUuid: jest.fn(),
  updateSpaceGroupPermission: jest.fn(),
}));

function permission(overrides = {}) {
  return {
    space_id: 'space',
    member_access_overrides_supported: true,
    can_manage_members: true,
    permission: { visibility: SpaceVisibility.Custom, member_default_access_level: AccessLevel.ReadAndWrite },
    ...overrides,
  };
}

function roster(overrides = {}) {
  return {
    members: [
      {
        uid: '9223372036854775806',
        user_uuid: userUuid,
        role: SpaceMemberRole.Member,
        source: 'manual',
        access_level_override: null,
        effective_access_level: 30,
        ...overrides,
      },
    ],
    groups: [
      { group_id: groupUuid, role: SpaceMemberRole.Member, access_level_override: 10, effective_access_level: 10 },
    ],
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockActor = 'actor';
  mockServer = 'server';
  jest.mocked(getSpacePermission).mockResolvedValue(permission() as never);
  jest.mocked(getSpaceMembers).mockResolvedValue(roster() as never);
});

test.each([null, 10, 20, 30] as const)(
  'writes only the exact user override %s, including explicit equal-to-default values',
  async (override) => {
    await setSpaceMemberAccessOverride('workspace', 'space', principal, override);
    expect(updateSpaceMemberByUuid).toHaveBeenCalledWith('workspace', 'space', userUuid, {
      access_level_override: override,
    });
    expect(updateSpaceGroupPermission).not.toHaveBeenCalled();
  }
);

test('group reset sends explicit null without changing role or membership', async () => {
  await setSpaceMemberAccessOverride('workspace', 'space', { type: 'group', uuid: groupUuid }, null);
  expect(updateSpaceGroupPermission).toHaveBeenCalledWith('workspace', 'space', groupUuid, {
    access_level_override: null,
  });
});

test.each([
  { member_access_overrides_supported: undefined },
  { member_access_overrides_supported: false },
  { can_manage_members: false },
  { space_id: 'other' },
  { permission: { visibility: SpaceVisibility.Private } },
  { permission: { visibility: SpaceVisibility.Public } },
])('fresh capability denies stale or unsupported controls: %p', async (patch) => {
  jest.mocked(getSpacePermission).mockResolvedValue(permission(patch) as never);
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow();
  expect(getSpaceMembers).not.toHaveBeenCalled();
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test.each([
  { user_uuid: undefined },
  { role: SpaceMemberRole.Owner },
  { access_level_override: undefined },
  { source: 'page_share' },
  { source: 'workspace_default' },
  { source: 'legacy_private_owner' },
])('fresh roster rejects a principal that cannot carry an override: %p', async (patch) => {
  jest.mocked(getSpaceMembers).mockResolvedValue(roster(patch) as never);
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow();
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test.each(['account', 'server', 'revision'])('fences a pending capability read after %s changes', async (change) => {
  let resolve!: (value: unknown) => void;
  let current = true;

  jest.mocked(getSpacePermission).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done as never;
      })
  );
  const pending = setSpaceMemberAccessOverride('workspace', 'space', principal, 10, () => current);

  if (change === 'account') mockActor = 'other';
  if (change === 'server') mockServer = 'other';
  if (change === 'revision') current = false;
  resolve(permission());
  await expect(pending).rejects.toThrow();
  expect(getSpaceMembers).not.toHaveBeenCalled();
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test('never sends FullAccess through an ordinary-member override', async () => {
  await expect(
    setSpaceMemberAccessOverride('workspace', 'space', principal, AccessLevel.FullAccess as never)
  ).rejects.toThrow();
  expect(getSpacePermission).not.toHaveBeenCalled();
});
