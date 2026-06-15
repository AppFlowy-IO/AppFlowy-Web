import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import NotificationBell from '../NotificationBell';

import type { ReactNode } from 'react';

const mockUseCurrentWorkspaceIdOptional = jest.fn();
const mockUseNotifications = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => mockUseCurrentWorkspaceIdOptional(),
}));

jest.mock('../useNotifications', () => ({
  useNotifications: (workspaceId: string | undefined) => mockUseNotifications(workspaceId),
}));

jest.mock('../NotificationPanel', () => () => <div>notification-panel</div>);

jest.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button data-testid='popover-open' onClick={() => onOpenChange?.(true)}>
        open
      </button>
      {children}
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/assets/icons/mention_send_notification.svg', () => ({
  ReactComponent: () => <svg data-testid='notification-bell-icon' />,
}));

const createHookValue = (overrides: Partial<ReturnType<typeof createHookValueBase>> = {}) => ({
  ...createHookValueBase(),
  ...overrides,
});

function createHookValueBase() {
  return {
  notifications: [],
  inboxNotifications: [],
  unreadNotifications: [],
  archivedNotifications: [],
  unreadCount: 0,
  hasLoaded: false,
  isLoading: false,
  isLoadingMore: false,
  hasMoreInbox: false,
  hasMoreArchive: false,
  refresh: jest.fn(async () => undefined),
  loadMore: jest.fn(async () => undefined),
  markRead: jest.fn(async () => undefined),
  markAllRead: jest.fn(async () => undefined),
  archive: jest.fn(async () => undefined),
  archiveAll: jest.fn(async () => undefined),
  };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCurrentWorkspaceIdOptional.mockReturnValue('workspace-id');
    mockUseNotifications.mockReturnValue(createHookValue());
  });

  it('does not enable notifications when workspace context is unavailable', () => {
    mockUseCurrentWorkspaceIdOptional.mockReturnValue(undefined);

    render(<NotificationBell />);

    expect(mockUseNotifications).toHaveBeenCalledWith(undefined);
    expect(
      screen.queryByRole('button', { name: 'settings.notifications.titles.notifications' })
    ).toBeNull();
  });

  it('enables notifications when workspace context is available', () => {
    render(<NotificationBell />);

    expect(mockUseNotifications).toHaveBeenCalledWith('workspace-id');
    expect(
      screen.getByRole('button', { name: 'settings.notifications.titles.notifications' })
    ).toBeTruthy();
  });

  it('refreshes immediately when first opened before notifications have loaded', () => {
    const hookValue = createHookValue();

    mockUseNotifications.mockReturnValue(hookValue);

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('popover-open'));

    expect(hookValue.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on open after notifications have loaded', () => {
    const hookValue = createHookValue({ hasLoaded: true });

    mockUseNotifications.mockReturnValue(hookValue);

    render(<NotificationBell />);
    fireEvent.click(screen.getByTestId('popover-open'));

    expect(hookValue.refresh).not.toHaveBeenCalled();
  });
});
