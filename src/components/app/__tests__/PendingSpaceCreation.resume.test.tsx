import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { PendingSpaceCreation } from '@/components/app/PendingSpaceCreation';

// Renders the real sidebar entry with the real Create Space dialog: only transport, session and
// heavy UI primitives are replaced.
const mockCreateSpace = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockRefreshCreationPermission = jest.fn();
const mockClient = {};

jest.mock('uuid', () => ({ v4: () => 'fresh-id' }));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: 'actor-a' } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server-a' }));
jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => mockClient }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  PageService: {},
  WorkspaceService: {
    getMembers: async () => [],
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
    getWorkspaceSpaceCreationCapabilities: async () => ({ can_create_space: true }),
  },
}));
jest.mock('@/components/app/hooks/useSpaceCreationCapability', () => ({
  useSpaceCreationCapability: () => ({
    status: 'ready',
    canCreateSpace: true,
    capability: { can_create_space: true },
    refresh: mockRefreshCreationPermission,
  }),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ createSpace: mockCreateSpace }),
  useCurrentWorkspaceId: () => 'workspace-a',
  useUserWorkspaceInfo: () => ({
    userId: 'current-user',
    selectedWorkspace: { id: 'workspace-a', name: 'Acme' },
    workspaces: [{ id: 'workspace-a', name: 'Acme' }],
  }),
  useEnsureViewVisibleInOutline: () => jest.fn(),
  useOpenPageModal: () => jest.fn(),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ name: 'Nathan', email: 'nathan@appflowy.io', avatar: '' }),
}));
jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    open,
    title,
    children,
    onOk,
    onClose,
    onCancel,
    okText,
    okButtonProps,
    PaperProps,
  }: {
    open: boolean;
    title: ReactNode;
    children: ReactNode;
    onOk?: () => void;
    onClose?: () => void;
    onCancel?: () => void;
    okText?: ReactNode;
    okButtonProps?: { disabled?: boolean; 'data-testid'?: string };
    PaperProps?: { 'data-testid'?: string };
  }) =>
    open ? (
      <div role='dialog' data-testid={PaperProps?.['data-testid']}>
        <h2>{title}</h2>
        <button onClick={onClose ?? onCancel}>close</button>
        <button data-testid={okButtonProps?.['data-testid']} disabled={okButtonProps?.disabled} onClick={onOk}>
          {okText}
        </button>
        {children}
      </div>
    ) : null,
}));
jest.mock('@/components/app/share/WorkspaceMemberInlineSearch', () => ({
  getWorkspaceMemberUid: (member: { uid?: string }) => member.uid || null,
  workspaceMemberDisplayName: (member: { name?: string; email: string }) => member.name || member.email,
  useAddableWorkspaceMembers: () => [],
  WorkspaceMemberInlineSearch: () => null,
}));
jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  dropdownMenuItemVariants: () => '',
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItemTick: () => null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span /> }));
jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button role='tab'>{children}</button>,
  TabsContent: ({ children, value }: { children: ReactNode; value: string }) =>
    value === 'general' ? <div>{children}</div> : null,
}));

const permission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Public,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: null,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: { disable_guests: false, disable_public_links: false, disable_export: false },
};

function store() {
  return new SpaceCreationIntentStore('workspace-a');
}

/** A request whose first attempt had an ambiguous outcome (for example a lost response). */
function saveAmbiguousRequest() {
  store().begin({
    payload: {
      name: 'Submitted',
      space_icon: '',
      space_icon_color: '',
      view_id: 'space-original',
      client_generated_view_id: true,
      permission,
    },
    members: [],
    selectedMembers: [],
    appliedMemberUids: [],
  });
}

async function openResumedDialog() {
  fireEvent.click(screen.getByTestId('resume-space-creation'));
  return screen.findByTestId('create-space-modal');
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockRefreshCreationPermission.mockResolvedValue({ can_create_space: true });
  // The first request has not committed (yet).
  mockGetSpacePermission.mockRejectedValue({ code: -2, httpStatus: 404, message: 'Space not found' });
});

test('a resumed request stays open and saved with its fields when Check again is refused', async () => {
  saveAmbiguousRequest();
  mockCreateSpace.mockRejectedValueOnce({ code: 1008, httpStatus: 400, message: 'invalid space name' });
  render(<PendingSpaceCreation />);

  await openResumedDialog();
  expect(screen.getByTestId('space-name-input').value).toBe('Submitted');
  fireEvent.click(screen.getByTestId('create-space-submit'));

  await waitFor(() => expect(notify.error).toHaveBeenCalledWith('invalid space name'));
  expect(mockCreateSpace).toHaveBeenCalledWith(expect.objectContaining({ view_id: 'space-original' }));
  // The earlier attempt may still commit, so the dialog keeps the request instead of vanishing.
  expect(screen.getByTestId('create-space-modal')).toBeTruthy();
  expect(store().snapshot()?.payload.view_id).toBe('space-original');
  expect(screen.getByTestId('space-name-input').value).toBe('Submitted');
  expect(screen.getByTestId('create-space-submit').textContent).toBe('spaceCreation.checkAgain');
  expect(screen.getByTestId('space-creation-recovery-unconfirmed')).toBeTruthy();
  expect(screen.getByTestId('resume-space-creation')).toBeTruthy();
});

test('discarding a resumed request closes the dialog, and a later saved request does not reopen it', async () => {
  saveAmbiguousRequest();
  render(<PendingSpaceCreation />);

  await openResumedDialog();
  fireEvent.click(screen.getByTestId('space-creation-discard'));
  fireEvent.click(screen.getByTestId('discard-space-request-confirm'));

  await waitFor(() => expect(screen.queryByTestId('create-space-modal')).toBeNull());
  expect(sessionStorage.length).toBe(0);
  expect(screen.queryByTestId('pending-space-creation')).toBeNull();

  // Another entry point saves a new request: the sidebar offers it, but does not pop it open.
  act(() => saveAmbiguousRequest());
  expect(await screen.findByTestId('resume-space-creation')).toBeTruthy();
  expect(screen.queryByTestId('create-space-modal')).toBeNull();
});
