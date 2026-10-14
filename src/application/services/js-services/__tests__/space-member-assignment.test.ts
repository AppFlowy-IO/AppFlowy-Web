import {
  AccessLevel,
  SpaceAccessDetails,
  SpaceMemberRole,
  SpaceVisibility,
  WorkspaceGroup,
  WorkspaceGroupSpacePermission,
} from '@/application/types';

import {
  getSpaceAccessDetails,
  getSpaceMembers,
  getSpacePermission,
  updateSpaceGroupPermission,
  updateSpaceMemberByUuid,
} from '../http/workspace-api';
import {
  extraSpaceAccess,
  fetchOwnSpaceAccessDetails,
  setSpaceMemberAccessOverride,
  spaceMemberAddPayload,
} from '../space-member-assignment';

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
  getSpaceAccessDetails: jest.fn(),
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
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow(
    'space.memberOverride.unavailable'
  );
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
  expect(updateSpaceGroupPermission).not.toHaveBeenCalled();
});

test('reads the capability and the roster together before writing', async () => {
  let resolvePermission!: (value: unknown) => void;

  jest.mocked(getSpacePermission).mockImplementation(
    () =>
      new Promise((done) => {
        resolvePermission = done as never;
      })
  );
  const pending = setSpaceMemberAccessOverride('workspace', 'space', principal, 10);

  // The roster read does not wait for the capability round trip.
  expect(getSpacePermission).toHaveBeenCalledTimes(1);
  expect(getSpaceMembers).toHaveBeenCalledTimes(1);
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
  resolvePermission(permission());
  await pending;
  expect(updateSpaceMemberByUuid).toHaveBeenCalledTimes(1);
});

test('reports a lost capability rather than the roster error it causes', async () => {
  jest.mocked(getSpacePermission).mockResolvedValue(permission({ can_manage_members: false }) as never);
  jest.mocked(getSpaceMembers).mockRejectedValue(new Error('403 forbidden'));
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow(
    'space.memberOverride.unavailable'
  );
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test('surfaces a capability read failure and never writes', async () => {
  jest.mocked(getSpacePermission).mockRejectedValue(new Error('network down'));
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow('network down');
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test('surfaces a roster read failure when the capability allows the change', async () => {
  jest.mocked(getSpaceMembers).mockRejectedValue(new Error('roster unavailable'));
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).rejects.toThrow('roster unavailable');
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
});

test('returns the server-confirmed assignment', async () => {
  const confirmed = { user_uuid: userUuid, access_level_override: 20, effective_access_level: 20 };

  jest.mocked(updateSpaceMemberByUuid).mockResolvedValue(confirmed as never);
  await expect(setSpaceMemberAccessOverride('workspace', 'space', principal, 20)).resolves.toBe(confirmed);
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
  expect(updateSpaceMemberByUuid).not.toHaveBeenCalled();
  expect(updateSpaceGroupPermission).not.toHaveBeenCalled();
});

test('never sends FullAccess through an ordinary-member override', async () => {
  await expect(
    setSpaceMemberAccessOverride('workspace', 'space', principal, AccessLevel.FullAccess as never)
  ).rejects.toThrow();
  expect(getSpacePermission).not.toHaveBeenCalled();
});

describe('spaceMemberAddPayload', () => {
  // The server stores the level sent with an add for Public and Private members; a missing one
  // becomes its own default (Can edit), so the space's member level must always be sent.
  test.each([
    [SpaceVisibility.Public, AccessLevel.ReadOnly],
    [SpaceVisibility.Public, AccessLevel.ReadAndWrite],
    [SpaceVisibility.Private, AccessLevel.ReadOnly],
    [SpaceVisibility.Private, AccessLevel.ReadAndComment],
  ])('a %s space adds an ordinary member at the space member level %s', (visibility, level) => {
    expect(
      spaceMemberAddPayload(SpaceMemberRole.Member, { visibility, member_default_access_level: level })
    ).toStrictEqual({ role: SpaceMemberRole.Member, access_level: level });
  });

  test('a missing member level reads as Can view, like the server', () => {
    expect(
      spaceMemberAddPayload(SpaceMemberRole.Member, {
        visibility: SpaceVisibility.Private,
        member_default_access_level: null,
      })
    ).toStrictEqual({ role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly });
  });

  test.each([AccessLevel.ReadAndWrite, null])(
    'a Custom space member keeps the space default (%s): no level and no chosen access',
    (level) => {
      const payload = spaceMemberAddPayload(SpaceMemberRole.Member, {
        visibility: SpaceVisibility.Custom,
        member_default_access_level: level,
      });

      expect(payload).toStrictEqual({ role: SpaceMemberRole.Member });
      expect(JSON.stringify(payload)).toBe('{"role":"member"}');
    }
  );

  test('a space type this client does not know still gets an explicit member level', () => {
    expect(
      spaceMemberAddPayload(SpaceMemberRole.Member, {
        visibility: 'restricted' as SpaceVisibility,
        member_default_access_level: AccessLevel.ReadOnly,
      })
    ).toStrictEqual({ role: SpaceMemberRole.Member, access_level: AccessLevel.ReadOnly });
  });

  test.each([SpaceVisibility.Public, SpaceVisibility.Private, SpaceVisibility.Custom])(
    'an owner added to a %s space gets the owner access, so no level is sent',
    (visibility) => {
      expect(
        spaceMemberAddPayload(SpaceMemberRole.Owner, { visibility, member_default_access_level: AccessLevel.ReadOnly })
      ).toStrictEqual({ role: SpaceMemberRole.Owner });
    }
  );
});

describe('extraSpaceAccess', () => {
  function details(overrides: Partial<SpaceAccessDetails> = {}): SpaceAccessDetails {
    return {
      space_id: 'space',
      uid: '9223372036854775806',
      access_level: AccessLevel.ReadAndWrite,
      source: 'workspace_group',
      member_default_access_level: AccessLevel.ReadAndWrite,
      direct_member_access_level: AccessLevel.ReadOnly,
      group_member_access_level: null,
      group_space_coverage_access_level: null,
      explicit_page_access_level: null,
      ...overrides,
    };
  }

  function spaceGroup(name: string, level: AccessLevel | null): WorkspaceGroupSpacePermission {
    return {
      group_id: name,
      name,
      role: SpaceMemberRole.Member,
      access_level: AccessLevel.ReadOnly,
      access_level_override: null,
      effective_access_level: level,
      member_count: 3,
      source: 'manual',
    };
  }

  function workspaceGroup(name: string, coverage: AccessLevel.ReadOnly | AccessLevel.ReadAndWrite | null): WorkspaceGroup {
    return { group_id: name, name, member_count: 3, space_coverage_supported: true, space_coverage_access_level: coverage };
  }

  const noGroups = { spaceGroups: [], workspaceGroups: [] };

  test('names the only group of the space that gives more than the chosen level', () => {
    expect(
      extraSpaceAccess(details({ group_member_access_level: AccessLevel.ReadAndWrite }), AccessLevel.ReadOnly, {
        spaceGroups: [spaceGroup('Marketing', AccessLevel.ReadAndWrite), spaceGroup('Readers', AccessLevel.ReadOnly)],
        workspaceGroups: [],
      })
    ).toEqual({ level: AccessLevel.ReadAndWrite, source: { kind: 'group', groupName: 'Marketing' } });
  });

  test('does not guess a group name when two groups of the space give that level', () => {
    expect(
      extraSpaceAccess(details({ group_member_access_level: AccessLevel.ReadAndWrite }), AccessLevel.ReadOnly, {
        spaceGroups: [spaceGroup('Marketing', AccessLevel.ReadAndWrite), spaceGroup('Sales', AccessLevel.ReadAndWrite)],
        workspaceGroups: [],
      })
    ).toEqual({ level: AccessLevel.ReadAndWrite, source: { kind: 'group', groupName: undefined } });
  });

  test('explains Access to all spaces and names the only group that grants that level', () => {
    expect(
      extraSpaceAccess(details({ group_space_coverage_access_level: AccessLevel.ReadAndWrite }), AccessLevel.ReadOnly, {
        spaceGroups: [],
        workspaceGroups: [workspaceGroup('Users', AccessLevel.ReadAndWrite), workspaceGroup('Guests', AccessLevel.ReadOnly)],
      })
    ).toEqual({ level: AccessLevel.ReadAndWrite, source: { kind: 'allSpaces', groupName: 'Users' } });
  });

  test('explains a share of the space page', () => {
    expect(
      extraSpaceAccess(details({ explicit_page_access_level: AccessLevel.ReadAndWrite }), AccessLevel.ReadOnly, noGroups)
    ).toEqual({ level: AccessLevel.ReadAndWrite, source: { kind: 'pageShare' } });
  });

  test('explains view access for a row with No access', () => {
    expect(
      extraSpaceAccess(
        details({ access_level: AccessLevel.ReadOnly, group_space_coverage_access_level: AccessLevel.ReadOnly }),
        null,
        noGroups
      )
    ).toEqual({ level: AccessLevel.ReadOnly, source: { kind: 'allSpaces', groupName: undefined } });
  });

  test('picks the strongest source and keeps the group first on a tie', () => {
    const access = details({
      access_level: AccessLevel.FullAccess,
      group_member_access_level: AccessLevel.ReadAndWrite,
      group_space_coverage_access_level: AccessLevel.ReadAndWrite,
      explicit_page_access_level: AccessLevel.FullAccess,
    });

    expect(extraSpaceAccess(access, AccessLevel.ReadOnly, noGroups)?.source).toEqual({ kind: 'pageShare' });
    expect(
      extraSpaceAccess({ ...access, explicit_page_access_level: null }, AccessLevel.ReadOnly, noGroups)?.source.kind
    ).toBe('group');
  });

  // For anyone but a space owner the server lets a share of the space page replace what the
  // space, its groups and Access to all spaces give, even when the share is lower.
  test('names the page share, not the group, when a lower share of the space page replaces the group', () => {
    const access = details({
      access_level: AccessLevel.ReadAndComment,
      source: 'explicit_page_share',
      direct_member_access_level: AccessLevel.ReadOnly,
      group_member_access_level: AccessLevel.ReadAndWrite,
      explicit_page_access_level: AccessLevel.ReadAndComment,
    });

    expect(
      extraSpaceAccess(access, AccessLevel.ReadOnly, {
        spaceGroups: [spaceGroup('Marketing', AccessLevel.ReadAndWrite)],
        workspaceGroups: [],
      })
    ).toEqual({ level: AccessLevel.ReadAndComment, source: { kind: 'pageShare' } });
  });

  test('names the page share, not Access to all spaces, when a lower share replaces it', () => {
    const access = details({
      access_level: AccessLevel.ReadAndComment,
      source: 'explicit_page_share',
      group_space_coverage_access_level: AccessLevel.ReadAndWrite,
      explicit_page_access_level: AccessLevel.ReadAndComment,
    });

    expect(
      extraSpaceAccess(access, AccessLevel.ReadOnly, {
        spaceGroups: [],
        workspaceGroups: [workspaceGroup('Users', AccessLevel.ReadAndWrite)],
      })
    ).toEqual({ level: AccessLevel.ReadAndComment, source: { kind: 'pageShare' } });
  });

  test('a share of the space page with one of your groups is still the page share', () => {
    // The server reports a share addressed to a group as `workspace_group`. The share decided the
    // access even though a group of the space gives the same level.
    expect(
      extraSpaceAccess(
        details({
          access_level: AccessLevel.ReadAndComment,
          source: 'workspace_group',
          group_member_access_level: AccessLevel.ReadAndComment,
          explicit_page_access_level: AccessLevel.ReadAndComment,
        }),
        AccessLevel.ReadOnly,
        { spaceGroups: [spaceGroup('Marketing', AccessLevel.ReadAndComment)], workspaceGroups: [] }
      )
    ).toEqual({ level: AccessLevel.ReadAndComment, source: { kind: 'pageShare' } });
  });

  test('a share below the final decision is not the reason', () => {
    expect(
      extraSpaceAccess(
        details({
          access_level: AccessLevel.ReadAndWrite,
          group_member_access_level: AccessLevel.ReadAndWrite,
          explicit_page_access_level: AccessLevel.ReadAndComment,
        }),
        AccessLevel.ReadOnly,
        noGroups
      )
    ).toEqual({ level: AccessLevel.ReadAndWrite, source: { kind: 'group', groupName: undefined } });
  });

  test('follows the server when it names a page share without per-source levels', () => {
    expect(
      extraSpaceAccess(
        { space_id: 'space', uid: '1', access_level: AccessLevel.ReadAndComment, source: 'explicit_page_share' },
        AccessLevel.ReadOnly,
        noGroups
      )
    ).toEqual({ level: AccessLevel.ReadAndComment, source: { kind: 'pageShare' } });
  });

  test('never names a group or Access to all spaces that gives more than the final decision', () => {
    // Something lower decided the access; a stronger source above it explains nothing.
    expect(
      extraSpaceAccess(
        details({
          access_level: AccessLevel.ReadAndComment,
          group_member_access_level: AccessLevel.ReadAndWrite,
          group_space_coverage_access_level: AccessLevel.ReadAndWrite,
        }),
        AccessLevel.ReadOnly,
        noGroups
      )
    ).toBeNull();
  });

  test.each([
    ['nothing gives more than the chosen level', details({ group_member_access_level: AccessLevel.ReadOnly }), AccessLevel.ReadOnly],
    ['the final decision is not above the chosen level', details({ access_level: AccessLevel.ReadOnly, group_member_access_level: AccessLevel.ReadAndWrite }), AccessLevel.ReadOnly],
    ['the user has no access at all', details({ access_level: null, group_member_access_level: AccessLevel.ReadAndWrite }), null],
    ['an older server sends no per-source levels', { space_id: 'space', uid: '1', access_level: AccessLevel.ReadAndWrite, source: 'space_member' } as SpaceAccessDetails, AccessLevel.ReadOnly],
    ['a level this client does not know', details({ group_member_access_level: 40 as AccessLevel }), AccessLevel.ReadOnly],
  ])('explains nothing when %s', (_case, access, configured) => {
    expect(extraSpaceAccess(access, configured as AccessLevel | null, noGroups)).toBeNull();
  });
});

describe('fetchOwnSpaceAccessDetails', () => {
  const ownUid = '9223372036854775806';
  const own = { space_id: 'space', uid: ownUid, access_level: AccessLevel.ReadAndWrite, source: 'space_member' };

  test('returns the details of the signed-in user', async () => {
    jest.mocked(getSpaceAccessDetails).mockResolvedValue(own as never);
    await expect(fetchOwnSpaceAccessDetails('workspace', 'space', ownUid)).resolves.toBe(own);
    expect(getSpaceAccessDetails).toHaveBeenCalledWith('workspace', 'space');
  });

  test.each([
    ['another account', { ...own, uid: '42' }],
    ['another space', { ...own, space_id: 'other' }],
  ])('drops details that describe %s', async (_case, response) => {
    jest.mocked(getSpaceAccessDetails).mockResolvedValue(response as never);
    await expect(fetchOwnSpaceAccessDetails('workspace', 'space', ownUid)).resolves.toBeNull();
  });

  test.each([
    ['an older server without the route', { code: 404, httpStatus: 404, message: 'Not Found' }],
    ['a denial', { code: 1012, httpStatus: 403, message: 'Forbidden' }],
    ['a network error', { code: -1, message: 'Network Error' }],
  ])('stays quiet after %s', async (_case, error) => {
    jest.mocked(getSpaceAccessDetails).mockRejectedValue(error);
    await expect(fetchOwnSpaceAccessDetails('workspace', 'space', ownUid)).resolves.toBeNull();
  });

  test('drops an answer that arrives after the account changed', async () => {
    let resolve!: (value: unknown) => void;

    jest.mocked(getSpaceAccessDetails).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done as never;
        })
    );
    const pending = fetchOwnSpaceAccessDetails('workspace', 'space', ownUid);

    mockActor = 'other';
    resolve(own);
    await expect(pending).resolves.toBeNull();
  });

  test('sends nothing without a signed-in user', async () => {
    await expect(fetchOwnSpaceAccessDetails('workspace', 'space', undefined)).resolves.toBeNull();
    expect(getSpaceAccessDetails).not.toHaveBeenCalled();
  });
});
