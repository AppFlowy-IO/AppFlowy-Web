import { AccessLevel, IPeopleWithAccessType, Role, View, ViewLayout } from '@/application/types';
import { resolveShareSectionType, ShareSectionType } from '@/components/app/share/shareSectionType';

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
