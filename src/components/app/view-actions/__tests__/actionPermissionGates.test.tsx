import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { Role } from '@/application/types';
import MoreActionsContent from '@/components/app/header/MoreActionsContent';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';

import type { ReactNode } from 'react';

const mockUseViewActionPermissions = jest.fn();
const mockUseSpaceActionPermissions = jest.fn();
let mockWorkspaceRole = Role.Member;
const mockDocumentView = {
  children: [],
  extra: null,
  icon: null,
  is_published: false,
  layout: 0,
  name: 'Document',
  parent_view_id: 'space-1',
  view_id: 'view-1',
};
const mockSpaceView = {
  ...mockDocumentView,
  extra: {
    is_space: true,
  },
  parent_view_id: undefined,
  view_id: 'space-1',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    loading: jest.fn(() => 'toast-id'),
    dismiss: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
    [key: string]: unknown;
  }) => (
    <button
      data-testid={props['data-testid'] as string | undefined}
      disabled={disabled}
      type='button'
      onClick={() => onSelect?.({ preventDefault: () => undefined })}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: () => <span data-testid='progress' />,
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: () => <span data-testid='switch' />,
}));

jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({
    hideBlockingLoader: jest.fn(),
    openCreateSpaceModal: jest.fn(),
    openDeleteModal: jest.fn(),
    openDeleteSpaceModal: jest.fn(),
    openManageSpaceModal: jest.fn(),
    showBlockingLoader: jest.fn(),
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => [],
  useAppView: () => mockDocumentView,
  useCurrentWorkspaceId: () => 'workspace-1',
  useLoadViewChildren: () => jest.fn(),
  useRefreshOutline: () => jest.fn(),
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      role: mockWorkspaceRole,
    },
  }),
}));

jest.mock('@/components/app/contexts/SyncInternalContext', () => ({
  useSyncInternal: () => ({
    syncAllToServer: jest.fn(async () => undefined),
  }),
}));

jest.mock('@/components/app/view-actions/MovePagePopover', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/app/view-actions/AddPageActions', () => ({
  __esModule: true,
  default: () => <div data-testid='add-page-actions' />,
}));

jest.mock('@/components/app/view-actions/MorePageActions', () => ({
  __esModule: true,
  default: () => <div data-testid='more-page-actions' />,
}));

jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: (...args: unknown[]) => mockUseViewActionPermissions(...args),
}));

jest.mock('@/components/app/view-actions/useSpaceActionPermissions', () => ({
  useSpaceActionPermissions: (...args: unknown[]) => mockUseSpaceActionPermissions(...args),
}));

describe('view action permission gates', () => {
  beforeEach(() => {
    mockUseViewActionPermissions.mockReset();
    mockUseSpaceActionPermissions.mockReset();
    mockUseSpaceActionPermissions.mockReturnValue({
      canOpenManageSpace: false,
      hasLoadedSpaceActionPermissions: true,
      isLoadingSpaceActionPermissions: false,
    });
    mockWorkspaceRole = Role.Member;
  });

  it('keeps page duplicate available for edit access while hiding full-management actions', () => {
    render(
      <MoreActionsContent
        viewId='view-1'
        canDuplicateActions
        canManageActions={false}
        canUsePageHistory={false}
        onFindAndReplace={jest.fn()}
      />
    );

    expect(screen.getByTestId('more-page-duplicate')).toBeTruthy();
    expect(screen.queryByTestId('more-page-move-to')).toBeNull();
    expect(screen.queryByTestId('view-action-delete')).toBeNull();
    expect(screen.getByTestId('more-page-find-and-replace')).toBeTruthy();
  });

  it('hides page duplicate when edit/create permission is denied', () => {
    render(
      <MoreActionsContent
        viewId='view-1'
        canDuplicateActions={false}
        canManageActions={false}
        canUsePageHistory={false}
        onFindAndReplace={jest.fn()}
      />
    );

    expect(screen.queryByTestId('more-page-duplicate')).toBeNull();
  });

  it('keeps space duplicate for members while hiding selected-space management and workspace create', () => {
    render(
      <MoreSpaceActions
        view={mockSpaceView}
        onClose={jest.fn()}
        canDuplicateActions
        canManageActions={false}
        canOpenManageActions={false}
        isLoadingActions={false}
      />
    );

    expect(screen.queryByTestId('space-action-manage')).toBeNull();
    expect(screen.getByTestId('space-action-duplicate')).toBeTruthy();
    expect(screen.queryByTestId('create-new-space-button')).toBeNull();
    expect(screen.queryByTestId('space-action-delete')).toBeNull();
  });

  it('hides space duplicate and workspace create for guests without selected-space management permission', () => {
    mockWorkspaceRole = Role.Guest;

    render(
      <MoreSpaceActions
        view={mockSpaceView}
        onClose={jest.fn()}
        canDuplicateActions
        canManageActions={false}
        canOpenManageActions={false}
        isLoadingActions={false}
      />
    );

    expect(screen.queryByTestId('create-new-space-button')).toBeNull();
    expect(screen.queryByTestId('space-action-duplicate')).toBeNull();
  });

  it('lets sidebar editors open Manage Space without exposing Delete', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: true,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });
    mockUseSpaceActionPermissions.mockReturnValue({
      canOpenManageSpace: true,
      hasLoadedSpaceActionPermissions: true,
      isLoadingSpaceActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockSpaceView}
        popoverType={{ category: 'space', type: 'more' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(mockUseSpaceActionPermissions).toHaveBeenCalledWith(mockSpaceView, true);
    expect(screen.getByTestId('space-action-manage')).toBeTruthy();
    expect(screen.queryByTestId('space-action-delete')).toBeNull();
  });

  it('lets invite-only members open Manage Space without exposing Delete', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: true,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });
    mockUseSpaceActionPermissions.mockReturnValue({
      canOpenManageSpace: true,
      hasLoadedSpaceActionPermissions: true,
      isLoadingSpaceActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockSpaceView}
        popoverType={{ category: 'space', type: 'more' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(screen.getByTestId('space-action-manage')).toBeTruthy();
    expect(screen.queryByTestId('space-action-delete')).toBeNull();
  });

  it('lets member managers open Manage Space without exposing Delete', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: true,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });
    mockUseSpaceActionPermissions.mockReturnValue({
      canOpenManageSpace: true,
      hasLoadedSpaceActionPermissions: true,
      isLoadingSpaceActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockSpaceView}
        popoverType={{ category: 'space', type: 'more' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(screen.getByTestId('space-action-manage')).toBeTruthy();
    expect(screen.queryByTestId('space-action-delete')).toBeNull();
  });

  it('keeps Delete available for delegated Full Access without structured space management', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: true,
      canManageViewActions: true,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });
    mockUseSpaceActionPermissions.mockReturnValue({
      canOpenManageSpace: false,
      hasLoadedSpaceActionPermissions: true,
      isLoadingSpaceActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockSpaceView}
        popoverType={{ category: 'space', type: 'more' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(screen.queryByTestId('space-action-manage')).toBeNull();
    expect(screen.getByTestId('space-action-delete')).toBeTruthy();
  });

  it('does not mount add actions until effective permissions allow mutations', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: false,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockDocumentView}
        popoverType={{ category: 'page', type: 'add' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(mockUseViewActionPermissions).toHaveBeenCalledWith(mockDocumentView, true);
    expect(screen.queryByTestId('add-page-actions')).toBeNull();
  });

  it('shows a loading item while add action permissions are unresolved', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: false,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: false,
      isLoadingViewActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockDocumentView}
        popoverType={{ category: 'page', type: 'add' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(screen.getByTestId('add-page-permission-loading')).toBeTruthy();
    expect(screen.queryByTestId('add-page-actions')).toBeNull();
  });

  it('mounts add actions for edit access even when manage actions are denied', () => {
    mockUseViewActionPermissions.mockReturnValue({
      canCreateViewActions: true,
      canManageViewActions: false,
      hasLoadedViewActionPermissions: true,
      isLoadingViewActionPermissions: false,
    });

    render(
      <ViewActionsPopover
        view={mockDocumentView}
        popoverType={{ category: 'page', type: 'add' }}
        open
        onOpenChange={jest.fn()}
      >
        <button type='button'>trigger</button>
      </ViewActionsPopover>
    );

    expect(screen.getByTestId('add-page-actions')).toBeTruthy();
  });
});
