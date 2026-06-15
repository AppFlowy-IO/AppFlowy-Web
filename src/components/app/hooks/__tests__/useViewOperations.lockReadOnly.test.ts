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

/** Wrap views inside the hidden "Shared with me" space that findViewInShareWithMe looks for. */
function shareWithMeOutline(...children: View[]): View[] {
  return [
    createView({
      view_id: 'share-with-me-space',
      extra: { is_space: true, is_hidden_space: true } as ViewExtra,
      children,
    }),
  ];
}

describe('getViewReadOnlyStatus (lock + access)', () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue({ isMobile: false } as ReturnType<typeof getPlatform>);
  });

  it('returns false when there is no outline', () => {
    expect(getViewReadOnlyStatus('view-id', undefined)).toBe(false);
  });

  it('always returns true on mobile, regardless of lock/access', () => {
    mockGetPlatform.mockReturnValue({ isMobile: true } as ReturnType<typeof getPlatform>);

    expect(getViewReadOnlyStatus('view-id', [])).toBe(true);
  });

  it('returns true for a locked view in the workspace outline', () => {
    const outline = [createView({ view_id: 'view-id', is_locked: true })];

    expect(getViewReadOnlyStatus('view-id', outline)).toBe(true);
  });

  it('returns false for an unlocked, owned view', () => {
    const outline = [createView({ view_id: 'view-id', is_locked: false })];

    expect(getViewReadOnlyStatus('view-id', outline)).toBe(false);
  });

  it('returns true for a locked view found in the shared-with-me space', () => {
    const outline = shareWithMeOutline(
      createView({ view_id: 'view-id', is_locked: true, access_level: AccessLevel.ReadAndWrite })
    );

    expect(getViewReadOnlyStatus('view-id', outline)).toBe(true);
  });

  it('returns true for a shared view with read-only access', () => {
    const outline = shareWithMeOutline(
      createView({ view_id: 'view-id', access_level: AccessLevel.ReadAndComment })
    );

    expect(getViewReadOnlyStatus('view-id', outline)).toBe(true);
  });

  it('returns false for a shared view with write access (and not locked)', () => {
    const outline = shareWithMeOutline(
      createView({ view_id: 'view-id', access_level: AccessLevel.ReadAndWrite })
    );

    expect(getViewReadOnlyStatus('view-id', outline)).toBe(false);
  });

  it('honors the lock when the view is only present in the fallback (not yet in the outline)', () => {
    // Simulates AppPage opening a page by direct URL before the outline branch
    // has loaded — outline does not contain the view, but the server-fetched
    // fallback does and reports is_locked=true.
    const fallback = createView({ view_id: 'view-id', is_locked: true });

    expect(getViewReadOnlyStatus('view-id', [], fallback)).toBe(true);
  });

  it('ignores a fallback view that does not match the requested viewId', () => {
    const fallback = createView({ view_id: 'some-other-view', is_locked: true });

    expect(getViewReadOnlyStatus('view-id', [], fallback)).toBe(false);
  });
});
