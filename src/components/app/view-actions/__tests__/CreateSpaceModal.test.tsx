import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, SpaceInvitePolicy, SpaceSidebarEditPolicy, SpaceVisibility } from '@/application/types';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';

import type { ReactNode } from 'react';

const mockGetSpaces = jest.fn();
const mockCreateSpace = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockEventEmitter = new EventEmitter();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getSpaces: (...args: unknown[]) => mockGetSpaces(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    createSpace: mockCreateSpace,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn() },
}));

jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
}));

jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({
  __esModule: true,
  default: () => <div data-testid='space-icon-button' />,
}));

function listedSpace(visibility: SpaceVisibility) {
  return {
    space_id: 'space-default',
    name: 'General',
    permission: {
      visibility,
      owner_access_level: AccessLevel.FullAccess,
      member_default_access_level: AccessLevel.ReadAndWrite,
      everyone_else_access_level: AccessLevel.ReadOnly,
      invite_policy: SpaceInvitePolicy.OwnersOnly,
      sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
      invite_link_enabled: false,
      security: {
        disable_guests: false,
        disable_public_links: false,
        disable_export: false,
      },
    },
    current_user_access_level: AccessLevel.FullAccess,
    explicit_member_count: 1,
    is_explicit_member: true,
    can_join: false,
    can_leave: visibility !== SpaceVisibility.Default,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('CreateSpaceModal visibility options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter.removeAllListeners();
  });

  it('keeps Default unavailable when the workspace already has one', async () => {
    mockGetSpaces.mockResolvedValue({ spaces: [listedSpace(SpaceVisibility.Default)] });

    render(<CreateSpaceModal open onClose={jest.fn()} />);

    await waitFor(() => expect(mockGetSpaces).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByTestId('space-visibility-button'));

    expect(screen.queryByTestId('space-visibility-option-default')).toBeNull();
  });

  it('offers Default when the workspace has no active Default space', async () => {
    mockGetSpaces.mockResolvedValue({ spaces: [listedSpace(SpaceVisibility.Open)] });

    render(<CreateSpaceModal open onClose={jest.fn()} />);

    await waitFor(() => expect(mockGetSpaces).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByTestId('space-visibility-button'));

    await waitFor(() => expect(screen.getByTestId('space-visibility-option-default')).toBeTruthy());
  });

  it('removes a selected Default when a permission event reports a newly existing Default space', async () => {
    mockGetSpaces
      .mockResolvedValueOnce({ spaces: [listedSpace(SpaceVisibility.Open)] })
      .mockResolvedValueOnce({ spaces: [listedSpace(SpaceVisibility.Default)] });

    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('space-visibility-button'));
    const defaultOption = await screen.findByTestId('space-visibility-option-default');

    fireEvent.click(defaultOption);
    expect(screen.getByTestId('space-visibility-button').textContent).toContain('space.permissionManager.default');

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-default' });
    });

    await waitFor(() => expect(mockGetSpaces).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('space-visibility-button').textContent).toContain('space.permissionManager.open')
    );
  });

  it('ignores an older availability response after a permission-event refresh', async () => {
    const staleRequest = deferred<{ spaces: ReturnType<typeof listedSpace>[] }>();
    const currentRequest = deferred<{ spaces: ReturnType<typeof listedSpace>[] }>();

    mockGetSpaces.mockReturnValueOnce(staleRequest.promise).mockReturnValueOnce(currentRequest.promise);

    render(<CreateSpaceModal open onClose={jest.fn()} />);

    await waitFor(() => expect(mockGetSpaces).toHaveBeenCalledTimes(1));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space-default' });
    });
    await waitFor(() => expect(mockGetSpaces).toHaveBeenCalledTimes(2));

    await act(async () => {
      currentRequest.resolve({ spaces: [listedSpace(SpaceVisibility.Default)] });
      await currentRequest.promise;
    });
    fireEvent.click(screen.getByTestId('space-visibility-button'));
    await waitFor(() => expect(screen.queryByTestId('space-visibility-option-default')).toBeNull());
    fireEvent.click(screen.getByTestId('space-visibility-button'));
    await act(async () => {
      staleRequest.resolve({ spaces: [listedSpace(SpaceVisibility.Open)] });
      await staleRequest.promise;
    });

    fireEvent.click(screen.getByTestId('space-visibility-button'));
    await waitFor(() => expect(screen.queryByTestId('space-visibility-option-default')).toBeNull());
  });
});
