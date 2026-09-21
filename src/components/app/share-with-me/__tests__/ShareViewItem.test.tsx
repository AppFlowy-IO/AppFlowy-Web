import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, CollabObjectPermission, Types, View, ViewIconType, ViewLayout } from '@/application/types';
import { ShareViewItem } from '@/components/app/share-with-me/ShareViewItem';

import type { ReactNode } from 'react';

const mockRename = jest.fn();
const mockUpdatePage = jest.fn().mockResolvedValue(undefined);
const mockUploadFile = jest.fn().mockResolvedValue('https://example.com/icon.png');
let mockSource = { managed: false, loading: true, readOnly: true };
let mockPermission: CollabObjectPermission;
let mockIconActions: {
  onSelectIcon: (icon: { ty: ViewIconType; value: string }) => void | Promise<void>;
  onUploadFile: (file: File) => Promise<string>;
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@/application/services/domains', () => ({ AccessService: {}, ViewService: {} }));
jest.mock('@/application/view-utils', () => ({
  ...jest.requireActual('@/application/view-utils'),
  getViewUrl: () => '/app/workspace/view',
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => 'view',
  useCurrentWorkspaceId: () => 'workspace',
  useAppOperations: () => ({ updatePage: mockUpdatePage, uploadFile: mockUploadFile }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'member@example.com' }) }));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ openRenameModal: mockRename }),
}));
jest.mock('@/components/app/hooks/useViewObjectPermission', () => ({
  useViewObjectPermission: () => mockPermission,
}));
jest.mock('@/components/app/github-sync/useGithubPageSource', () => ({
  useGithubPageSource: () => mockSource,
}));
jest.mock('@/components/app/outline/ViewItem', () => ({
  __esModule: true,
  default: ({ renderExtra }: { renderExtra: (props: { hovered: boolean }) => ReactNode }) => (
    <div data-testid='shared-view-row'>{renderExtra({ hovered: true })}</div>
  ),
}));
jest.mock('@/components/app/share/RemoveAccessConfirmDialog', () => ({ RemoveAccessConfirmDialog: () => null }));
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: React.MouseEventHandler }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: React.MouseEventHandler }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: () => null,
}));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children, ...actions }: { children: ReactNode } & typeof mockIconActions) => {
    mockIconActions = actions;
    return <>{children}</>;
  },
}));

const view = {
  view_id: 'view',
  name: 'Shared documentation',
  layout: ViewLayout.Document,
  access_level: AccessLevel.FullAccess,
  children: [],
} as View;
const props = {
  view,
  width: 240,
  expandIds: [],
  toggleExpand: jest.fn(),
  navigateToView: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSource = { managed: false, loading: true, readOnly: true };
  mockPermission = {
    object_id: 'view',
    governing_view_id: 'view',
    collab_type: Types.Document,
    access_level: AccessLevel.FullAccess,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: true,
  } as CollabObjectPermission;
});

function openMenu() {
  fireEvent.click(screen.getByTestId('shared-view-row').querySelector('button')!);
}

test('pending and managed source ownership hide metadata editing despite cached Full Access', async () => {
  const { rerender } = render(<ShareViewItem {...props} />);

  openMenu();
  expect(screen.queryByText('button.rename')).toBeNull();
  expect(screen.queryByText('disclosureAction.changeIcon')).toBeNull();

  mockSource = { managed: true, loading: false, readOnly: true };
  rerender(<ShareViewItem {...props} />);

  await waitFor(() => expect(screen.getByText('disclosureAction.openNewTab')).toBeTruthy());
  expect(screen.queryByText('button.rename')).toBeNull();
  expect(screen.queryByText('disclosureAction.changeIcon')).toBeNull();
  expect(screen.getByText('shareAction.removeYourAccess')).toBeTruthy();
  expect(mockRename).not.toHaveBeenCalled();
  expect(mockUpdatePage).not.toHaveBeenCalled();
});

test('an ordinary writable page exposes metadata editing after source ownership resolves', async () => {
  const { rerender } = render(<ShareViewItem {...props} />);

  openMenu();
  mockSource = { managed: false, loading: false, readOnly: false };
  rerender(<ShareViewItem {...props} />);

  await waitFor(() => expect(screen.getByText('button.rename')).toBeTruthy());
  expect(screen.getByText('disclosureAction.changeIcon')).toBeTruthy();
  fireEvent.click(screen.getByText('button.rename'));
  expect(mockRename).toHaveBeenCalledWith('view');
});

test('canonical write denial also hides editing for an ordinary page with stale Full Access metadata', () => {
  mockSource = { managed: false, loading: false, readOnly: false };
  mockPermission.can_write = false;
  render(<ShareViewItem {...props} />);

  openMenu();
  expect(screen.queryByText('button.rename')).toBeNull();
  expect(screen.queryByText('disclosureAction.changeIcon')).toBeNull();
});

test('a managed page can still be opened in a new tab', () => {
  mockSource = { managed: true, loading: false, readOnly: true };
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);

  try {
    render(<ShareViewItem {...props} />);
    openMenu();
    fireEvent.click(screen.getByText('disclosureAction.openNewTab'));
    expect(open).toHaveBeenCalledWith('/app/workspace/view', '_blank');
  } finally {
    open.mockRestore();
  }
});

test.each(['access revoked', 'menu closed'])('retained icon callbacks cannot write after %s', async (transition) => {
  mockSource = { managed: false, loading: false, readOnly: false };
  const { rerender } = render(<ShareViewItem {...props} />);

  openMenu();
  await waitFor(() => expect(screen.getByText('disclosureAction.changeIcon')).toBeTruthy());
  const retained = mockIconActions;

  if (transition === 'access revoked') {
    mockSource = { managed: true, loading: false, readOnly: true };
    rerender(<ShareViewItem {...props} />);
  } else {
    fireEvent.click(screen.getByText('button.rename'));
  }

  await act(async () => {
    // UploadImage invokes the captured icon callback when an in-flight upload finishes.
    await retained.onSelectIcon({ ty: ViewIconType.URL, value: 'https://example.com/icon.png' });
    await expect(retained.onUploadFile(new File(['icon'], 'icon.png'))).rejects.toThrow('Page is read-only');
  });
  expect(mockUpdatePage).not.toHaveBeenCalled();
  expect(mockUploadFile).not.toHaveBeenCalled();
});
