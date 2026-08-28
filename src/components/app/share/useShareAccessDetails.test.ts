import { AccessLevel, IPeopleWithAccessType, Role, View, ViewLayout } from '@/application/types';
import { resolveCurrentUserAccessLevel } from '@/components/app/share/shareAccessLevel';
import {
  isInheritedWorkspaceAccess,
  resolveShareSectionType,
  ShareSectionType,
} from '@/components/app/share/shareSectionType';

const createView = (overrides: Partial<View> = {}): View => ({
  view_id: 'view-1',
  name: 'View',
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
  ...overrides,
});

const createPerson = (email: string, overrides: Partial<IPeopleWithAccessType> = {}): IPeopleWithAccessType => ({
  email,
  name: email,
  access_level: AccessLevel.FullAccess,
  role: Role.Member,
  avatar_url: '',
  pending_invitation: false,
  ...overrides,
});

describe('resolveShareSectionType', () => {
  it('treats public outline views as public even when multiple people have access', () => {
    expect(
      resolveShareSectionType({
        outline: [createView({ is_private: false })],
        viewId: 'view-1',
        sharedPeople: [createPerson('owner@appflowy.io'), createPerson('member@appflowy.io')],
        workspaceMemberCount: 2,
      })
    ).toBe(ShareSectionType.Public);
  });

  it('does not trust a public outline flag when access details are not workspace-wide', () => {
    expect(
      resolveShareSectionType({
        outline: [createView({ is_private: false })],
        viewId: 'view-1',
        sharedPeople: [createPerson('owner@appflowy.io'), createPerson('guest@example.com', { role: Role.Guest })],
        workspaceMemberCount: 3,
      })
    ).toBe(ShareSectionType.Shared);
  });

  it('treats private views with multiple shared users as shared', () => {
    expect(
      resolveShareSectionType({
        outline: [createView({ is_private: true })],
        viewId: 'view-1',
        sharedPeople: [createPerson('owner@appflowy.io'), createPerson('guest@example.com')],
      })
    ).toBe(ShareSectionType.Shared);
  });

  it('treats private views with only one user as private', () => {
    expect(
      resolveShareSectionType({
        outline: [createView({ is_private: true })],
        viewId: 'view-1',
        sharedPeople: [createPerson('owner@appflowy.io')],
      })
    ).toBe(ShareSectionType.Private);
  });

  it('prioritizes the Share with me space over the view private flag', () => {
    const sharedView = createView({ is_private: false, view_id: 'shared-view' });
    const shareWithMeSpace = createView({
      view_id: 'share-with-me',
      extra: {
        is_space: true,
        is_hidden_space: true,
      },
      children: [sharedView],
    });

    expect(
      resolveShareSectionType({
        outline: [shareWithMeSpace],
        viewId: 'shared-view',
        sharedPeople: [createPerson('owner@appflowy.io')],
      })
    ).toBe(ShareSectionType.Shared);
  });
});

describe('isInheritedWorkspaceAccess', () => {
  it('marks non-guest public-section members as inherited workspace access', () => {
    expect(isInheritedWorkspaceAccess(ShareSectionType.Public, createPerson('member@appflowy.io'))).toBe(true);
  });

  it('keeps guests, pending invites, and shared-section rows mutable as direct access rows', () => {
    expect(
      isInheritedWorkspaceAccess(ShareSectionType.Public, createPerson('guest@appflowy.io', { role: Role.Guest }))
    ).toBe(false);
    expect(
      isInheritedWorkspaceAccess(
        ShareSectionType.Public,
        createPerson('pending@appflowy.io', { pending_invitation: true })
      )
    ).toBe(false);
    expect(isInheritedWorkspaceAccess(ShareSectionType.Shared, createPerson('member@appflowy.io'))).toBe(false);
  });
});

describe('resolveCurrentUserAccessLevel', () => {
  it('prefers the v2 current user permission over shared rows and outline access', () => {
    expect(
      resolveCurrentUserAccessLevel({
        currentUserEmail: 'member@appflowy.io',
        currentUserPermission: { access_level: AccessLevel.ReadOnly },
        outlineAccessLevel: AccessLevel.ReadAndWrite,
        sharedPeople: [createPerson('member@appflowy.io', { access_level: AccessLevel.FullAccess })],
      })
    ).toBe(AccessLevel.ReadOnly);
  });

  it('falls back to shared rows and then outline access for legacy responses', () => {
    expect(
      resolveCurrentUserAccessLevel({
        currentUserEmail: 'member@appflowy.io',
        outlineAccessLevel: AccessLevel.ReadOnly,
        sharedPeople: [createPerson('member@appflowy.io', { access_level: AccessLevel.ReadAndWrite })],
      })
    ).toBe(AccessLevel.ReadAndWrite);

    expect(
      resolveCurrentUserAccessLevel({
        currentUserEmail: 'missing@appflowy.io',
        outlineAccessLevel: AccessLevel.ReadOnly,
        sharedPeople: [createPerson('member@appflowy.io', { access_level: AccessLevel.ReadAndWrite })],
      })
    ).toBe(AccessLevel.ReadOnly);
  });
});
