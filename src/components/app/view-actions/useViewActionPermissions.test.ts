import { AccessLevel, Role } from '@/application/types';
import {
  canUsePageHistoryAction,
  canUseViewMutationActions,
  resolveCurrentUserActionAccessLevel,
} from '@/components/app/view-actions/viewActionPermission';

describe('canUseViewMutationActions', () => {
  it('denies management before server permission has loaded', () => {
    expect(canUseViewMutationActions({})).toBe(false);
  });

  it('does not allow non-creators with read/write access to manage pages', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadAndWrite,
          object_creator: false,
          ancestor_creator: false,
        },
      })
    ).toBe(false);
  });

  it('allows the object creator even without full access', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadOnly,
          object_creator: true,
        },
      })
    ).toBe(true);
  });

  it('allows the ancestor creator for inherited private-space permissions', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadOnly,
          ancestor_creator: true,
        },
      })
    ).toBe(true);
  });

  it('allows full access from the resolved current user permission', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.FullAccess,
        },
      })
    ).toBe(true);
  });

  it('does not let stale outline access override the resolved current user permission', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadAndWrite,
        },
      })
    ).toBe(false);
  });

  it('denies read-only and read-write guests that are not creators', () => {
    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadOnly,
        },
      })
    ).toBe(false);

    expect(
      canUseViewMutationActions({
        currentUserPermission: {
          access_level: AccessLevel.ReadAndWrite,
        },
      })
    ).toBe(false);
  });
});

describe('canUsePageHistoryAction', () => {
  it('allows read-write and stronger page access to use page history', () => {
    expect(
      canUsePageHistoryAction({
        currentUserPermission: {
          access_level: AccessLevel.ReadAndWrite,
        },
      })
    ).toBe(true);

    expect(
      canUsePageHistoryAction({
        currentUserPermission: {
          access_level: AccessLevel.FullAccess,
        },
      })
    ).toBe(true);
  });

  it('denies read-only page access even when the user is a creator', () => {
    expect(
      canUsePageHistoryAction({
        currentUserPermission: {
          access_level: AccessLevel.ReadOnly,
          object_creator: true,
          ancestor_creator: true,
        },
      })
    ).toBe(false);
  });

  it('denies page history before permission has loaded', () => {
    expect(canUsePageHistoryAction({})).toBe(false);
  });
});

describe('resolveCurrentUserActionAccessLevel', () => {
  it('falls back from v2 current user permission to legacy shared rows and outline access', () => {
    expect(
      resolveCurrentUserActionAccessLevel({
        currentUserEmail: 'eva@appflowy.io',
        currentUserPermission: null,
        outlineAccessLevel: AccessLevel.ReadOnly,
        sharedPeople: [
          {
            email: 'eva@appflowy.io',
            name: 'Eva',
            access_level: AccessLevel.FullAccess,
            role: Role.Guest,
            avatar_url: '',
            pending_invitation: false,
          },
        ],
      })
    ).toBe(AccessLevel.FullAccess);

    expect(
      resolveCurrentUserActionAccessLevel({
        currentUserEmail: 'missing@appflowy.io',
        currentUserPermission: null,
        outlineAccessLevel: AccessLevel.ReadOnly,
        sharedPeople: [],
      })
    ).toBe(AccessLevel.ReadOnly);
  });
});
