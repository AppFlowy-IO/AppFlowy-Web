import EventEmitter from 'events';

import { act, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, Types, type View, ViewLayout } from '@/application/types';
import SpaceSidebarActions from '@/components/app/view-actions/SpaceSidebarActions';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';

import type { ReactNode } from 'react';

const mockGetSpacePermission = jest.fn();
const mockGetObjectPermission = jest.fn();
const mockEventEmitter = new EventEmitter();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args) },
  AccessService: { getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args) },
  ViewService: { get: jest.fn() },
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useAppView: () => undefined,
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span /> }));
jest.mock('@/components/app/view-actions/MoreSpaceActions', () => ({
  __esModule: true,
  default: ({ canOpenManageActions }: { canOpenManageActions: boolean }) => (
    <div data-testid='more-space-actions'>{canOpenManageActions ? 'manage' : 'no-manage'}</div>
  ),
}));
jest.mock('@/components/app/view-actions/MorePageActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/view-actions/AddPageActions', () => ({ __esModule: true, default: () => null }));

const space: View = {
  view_id: 'space-1',
  name: 'HR',
  icon: null,
  layout: ViewLayout.Document,
  extra: { is_space: true },
  children: [],
  is_published: false,
  is_private: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEventEmitter.removeAllListeners();
  mockGetObjectPermission.mockResolvedValue({
    object_id: 'space-1', collab_type: Types.Document, governing_view_id: 'space-1',
    access_level: AccessLevel.ReadAndWrite, can_read: true, can_write: true, can_comment: true, can_share: false,
  });
  mockGetSpacePermission.mockResolvedValue({ can_manage_space: true, can_edit_sidebar: true });
});

test('a hovered space row reads its space permission once, also after a permission change', async () => {
  render(<SpaceSidebarActions view={space} visible onActionClick={jest.fn()} />);

  await screen.findByTestId('inline-add-page');
  expect(screen.getByTestId('inline-more-actions')).toBeTruthy();
  expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
  act(() => {
    mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  await waitFor(() => expect(mockGetSpacePermission).toHaveBeenCalledTimes(2));
  await screen.findByTestId('inline-add-page');
  expect(mockGetSpacePermission).toHaveBeenCalledTimes(2);
});

test('an open space menu reads its space permission once', async () => {
  render(
    <ViewActionsPopover view={space} popoverType={{ category: 'space', type: 'more' }} open onOpenChange={jest.fn()}>
      <button type='button'>trigger</button>
    </ViewActionsPopover>
  );

  await waitFor(() => expect(screen.getByTestId('more-space-actions').textContent).toBe('manage'));
  expect(mockGetSpacePermission).toHaveBeenCalledTimes(1);
});
