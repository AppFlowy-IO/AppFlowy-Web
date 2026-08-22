import { fireEvent, render, screen } from '@testing-library/react';

import ShareTabs from '@/components/app/share/ShareTabs';

const mockUpdateGroupInAccessList = jest.fn();
const mockSharePanelProps = jest.fn();
const mockPublishPanelProps = jest.fn();
let mockObjectPermission: { can_read: boolean; can_share: boolean } | undefined;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => ({ is_published: false }),
}));

jest.mock('@/components/app/hooks/useViewObjectPermission', () => ({
  useViewObjectPermission: () => mockObjectPermission,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'owner@example.com' }),
}));

jest.mock('@/components/app/share/useShareAccessDetails', () => ({
  useShareAccessDetails: () => ({
    people: [],
    groups: [],
    isLoadingPeople: false,
    loadPeople: jest.fn(),
    removePersonFromAccessList: jest.fn(),
    updateGroupInAccessList: mockUpdateGroupInAccessList,
    currentUserAccessLevel: undefined,
    hasFullAccess: true,
    canManageFullAccess: false,
    sectionType: undefined,
  }),
}));

jest.mock('@/components/app/share/SharePanel', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockSharePanelProps(props);
    return <div data-testid='share-panel' />;
  },
}));

jest.mock('@/components/app/share/PublishPanel', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockPublishPanelProps(props);
    return <div data-testid='publish-panel' />;
  },
}));

jest.mock('@/components/app/share/TemplatePanel', () => ({
  __esModule: true,
  default: () => <div data-testid='template-panel' />,
}));

jest.mock('@/components/app/share/ExportPanel', () => ({
  __esModule: true,
  default: () => <div data-testid='export-panel' />,
}));

function renderShareTabs(hidePublish: boolean) {
  return render(<ShareTabs opened viewId='database-view' hidePublish={hidePublish} onClose={() => undefined} />);
}

describe('ShareTabs publish availability', () => {
  beforeEach(() => {
    mockSharePanelProps.mockClear();
    mockUpdateGroupInAccessList.mockClear();
    mockPublishPanelProps.mockClear();
    mockObjectPermission = { can_read: true, can_share: true };
  });

  it('keeps Share available while removing Publish when requested', () => {
    renderShareTabs(true);

    expect(screen.getByRole('tab', { name: 'shareAction.shareTab' })).toBeTruthy();
    expect(screen.queryByTestId('publish-tab')).toBeNull();
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('keeps Publish available by default', () => {
    renderShareTabs(false);

    expect(screen.getByTestId('publish-tab')).toBeTruthy();
  });

  it('falls back to Share when Publish is removed after being selected', () => {
    const { rerender } = renderShareTabs(false);

    fireEvent.mouseDown(screen.getByTestId('publish-tab'), { button: 0, ctrlKey: false });
    expect(screen.getByTestId('publish-panel')).toBeTruthy();

    rerender(<ShareTabs opened viewId='database-view' hidePublish onClose={() => undefined} />);

    expect(screen.queryByTestId('publish-tab')).toBeNull();
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('forwards group mutation state from the access hook', () => {
    renderShareTabs(false);

    expect(mockSharePanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        updateGroupInAccessList: mockUpdateGroupInAccessList,
        canManageFullAccess: false,
      })
    );
  });

  it('uses canonical can_share instead of the legacy access-level result', () => {
    mockObjectPermission = { can_read: true, can_share: false };

    renderShareTabs(false);

    expect(mockSharePanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        hasFullAccess: false,
        canManageFullAccess: false,
      })
    );

    fireEvent.mouseDown(screen.getByTestId('publish-tab'), { button: 0, ctrlKey: false });
    expect(mockPublishPanelProps).toHaveBeenCalledWith(expect.objectContaining({ canShare: false }));
  });
});
