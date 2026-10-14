import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { View, ViewLayout } from '@/application/types';
import MoreSpaceActions from '@/components/app/view-actions/MoreSpaceActions';

const mockDuplicate = jest.fn();
const mockGetView = jest.fn();
const mockGetCapabilities = jest.fn();
const mockRefresh = jest.fn();
const mockToastError = jest.fn();
let mockCanCreateSpace = true;
let mockStatus: 'loading' | 'ready' | 'unsupported' | 'error' = 'ready';

jest.mock('@/components/app/hooks/useSpaceCreationCapability', () => ({
  useSpaceCreationCapability: () => ({
    status: mockStatus,
    canCreateSpace: mockCanCreateSpace,
    capability: mockStatus === 'ready' ? { can_create_space: mockCanCreateSpace } : undefined,
    refresh: mockRefresh,
  }),
}));
jest.mock('@/application/services/domains', () => ({
  PageService: { duplicate: (...args: unknown[]) => mockDuplicate(...args) },
  WorkspaceService: { getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockGetCapabilities(...args) },
}));
jest.mock('@/application/services/js-services/http/view-api', () => ({
  getView: (...args: unknown[]) => mockGetView(...args),
}));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ openDeleteSpaceModal: jest.fn(), openManageSpaceModal: jest.fn() }),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
  useRefreshOutline: () => jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, disabled, onSelect, ...props }: {
    children: ReactNode; disabled?: boolean; onSelect?: () => void; [key: string]: unknown;
  }) => (
    <button data-testid={props['data-testid'] as string | undefined} disabled={disabled} onClick={onSelect} type='button'>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span data-testid='progress' /> }));

const space: View = {
  view_id: 'space-id', name: 'HR', icon: null, layout: ViewLayout.Document, extra: { is_space: true },
  children: [], is_published: false, is_private: false,
};

function renderActions() {
  return render(
    <MoreSpaceActions view={space} onClose={jest.fn()} canManageActions={false} canOpenManageActions isLoadingActions={false} />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanCreateSpace = true;
  mockStatus = 'ready';
  mockGetView.mockResolvedValue(space);
  mockDuplicate.mockResolvedValue(undefined);
});

test.each([
  ['denied', 'ready', 'workspacePermissions.denied'],
  ['still being checked', 'loading', 'workspacePermissions.loading'],
  ['unknown after a failed check', 'error', 'workspacePermissions.loadError'],
] as const)('shows a visible reason inside the disabled Duplicate item when creation is %s', (_case, status, reason) => {
  mockCanCreateSpace = false;
  mockStatus = status;
  renderActions();

  const duplicate = screen.getByTestId('space-action-duplicate');

  expect(duplicate.hasAttribute('disabled')).toBe(true);
  expect(within(duplicate).getByTestId('space-action-duplicate-reason').textContent).toBe(reason);
});

test('keeps Duplicate available on a server without the capability route and lets the server decide', async () => {
  mockCanCreateSpace = false;
  mockStatus = 'unsupported';
  mockRefresh.mockResolvedValue(undefined);
  mockGetCapabilities.mockRejectedValue({ code: 404, httpStatus: 404, message: 'Not Found' });
  renderActions();

  const duplicate = screen.getByTestId('space-action-duplicate');

  expect(duplicate.hasAttribute('disabled')).toBe(false);
  expect(screen.queryByTestId('space-action-duplicate-reason')).toBeNull();
  fireEvent.click(duplicate);
  await waitFor(() => expect(mockDuplicate).toHaveBeenCalledWith('workspace-id', 'space-id'));
  expect(mockToastError).not.toHaveBeenCalled();
});

test('a fresh denial stops duplication with a clear reason', async () => {
  mockRefresh.mockResolvedValue({ can_create_space: false });
  renderActions();

  fireEvent.click(screen.getByTestId('space-action-duplicate'));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('workspacePermissions.denied'));
  expect(mockDuplicate).not.toHaveBeenCalled();
});

test('names the space menu items in sentence case', () => {
  renderActions();

  expect(screen.getByTestId('space-action-manage').textContent).toBe('space.manageSpace');
  expect(screen.getByTestId('space-action-duplicate').textContent).toContain('space.duplicate');
});
