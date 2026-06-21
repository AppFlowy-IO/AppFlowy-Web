import { AccessLevel, View, ViewExtra, ViewLayout } from '@/application/types';
import { getPlatform } from '@/utils/platform';

import { getViewReadOnlyStatus } from '../useViewOperations';

// useViewOperations pulls in service/loader modules at import time; stub the
// heavy ones so the pure getViewReadOnlyStatus function can be tested in isolation.
jest.mock('@/application/services/domains', () => ({
  CollabService: {},
  ViewService: {},
  WorkspaceService: {},
}));
jest.mock('@/application/view-loader', () => ({ openView: jest.fn() }));
jest.mock('@/utils/platform', () => ({ getPlatform: jest.fn(() => ({ isMobile: false })) }));

const mockGetPlatform = getPlatform as jest.MockedFunction<typeof getPlatform>;

function createView(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

/**
 * Build the hidden "Shared with me" space holding a shared private space that
 * itself contains a child page.
 *
 * This mirrors the user-reported scenario: an owner creates a private space,
 * invites a member with View-only (ReadOnly) access, and the member opens a
 * page *inside* that space. The server reports the access level on the shared
 * space node; the child page does not carry its own `access_level`.
 */
function shareWithMePrivateSpaceOutline(spaceAccessLevel: AccessLevel, childPage: View): View[] {
  return [
    createView({
      view_id: 'share-with-me-space',
      extra: { is_space: true, is_hidden_space: true } as ViewExtra,
      children: [
        createView({
          view_id: 'shared-private-space',
          is_private: true,
          extra: { is_space: true } as ViewExtra,
          access_level: spaceAccessLevel,
          children: [childPage],
        }),
      ],
    }),
  ];
}

describe('getViewReadOnlyStatus (private space inherited access)', () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue({ isMobile: false } as ReturnType<typeof getPlatform>);
  });

  it('treats the shared private space root as read-only for a View-only member', () => {
    // Sanity check: the shared node itself carries the access level, so this
    // already works today and pins the boundary of the inheritance gap below.
    const outline = shareWithMePrivateSpaceOutline(
      AccessLevel.ReadOnly,
      createView({ view_id: 'child-page' })
    );

    expect(getViewReadOnlyStatus('shared-private-space', outline)).toBe(true);
  });

  it('treats a child page of a View-only private space as read-only', () => {
    // User-reported bug: a member invited to a private space with View-only
    // access can still edit pages *inside* the space. The child page inherits
    // the space's ReadOnly access and must therefore be read-only, even though
    // the page itself has no explicit `access_level`.
    const outline = shareWithMePrivateSpaceOutline(
      AccessLevel.ReadOnly,
      createView({ view_id: 'child-page' })
    );

    expect(getViewReadOnlyStatus('child-page', outline)).toBe(true);
  });

  it('treats a nested page of a View-only private space as read-only', () => {
    // Deeper nesting must still inherit the space's restricted access.
    const outline = shareWithMePrivateSpaceOutline(
      AccessLevel.ReadOnly,
      createView({
        view_id: 'child-page',
        children: [createView({ view_id: 'grandchild-page' })],
      })
    );

    expect(getViewReadOnlyStatus('grandchild-page', outline)).toBe(true);
  });

  it('keeps a child page editable when the private space grants write access', () => {
    // Counter-case: a member shared into the private space with write access
    // must be able to edit pages inside it.
    const outline = shareWithMePrivateSpaceOutline(
      AccessLevel.ReadAndWrite,
      createView({ view_id: 'child-page' })
    );

    expect(getViewReadOnlyStatus('child-page', outline)).toBe(false);
  });

  it('lets an explicit child access level override the inherited space access', () => {
    // A child re-shared with write access inside an otherwise View-only space
    // should follow its own (more permissive) access level.
    const outline = shareWithMePrivateSpaceOutline(
      AccessLevel.ReadOnly,
      createView({ view_id: 'child-page', access_level: AccessLevel.ReadAndWrite })
    );

    expect(getViewReadOnlyStatus('child-page', outline)).toBe(false);
  });
});
