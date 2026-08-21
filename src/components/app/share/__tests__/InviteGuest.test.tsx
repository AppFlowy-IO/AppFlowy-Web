import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, WorkspaceGroup } from '@/application/types';
import { InviteGuest } from '@/components/app/share/InviteGuest';

import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import type { EmailTag } from '../InviteInput';
import type { InviteSuggestion } from '../PersonSuggestionItem';

const mockGetWorkspaceGroups = jest.fn();
const mockSharePageTo = jest.fn();
const mockSharePageToGroup = jest.fn();
const mockSharePageToGroups = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    sharePageTo: (...args: unknown[]) => mockSharePageTo(...args),
    sharePageToGroup: (...args: unknown[]) => mockSharePageToGroup(...args),
    sharePageToGroups: (...args: unknown[]) => mockSharePageToGroups(...args),
  },
  BillingService: {
    getSubscriptionLink: jest.fn(),
  },
  WorkspaceService: {
    getWorkspaceGroups: (...args: unknown[]) => mockGetWorkspaceGroups(...args),
  },
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: (...args: unknown[]) => mockNotifyError(...args),
    success: (...args: unknown[]) => mockNotifySuccess(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { role: 'Owner' } }),
}));

jest.mock('@/utils/subscription', () => ({
  isAppFlowyHosted: () => false,
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('../InviteInput', () => ({
  InviteInput: ({
    afterExtra,
    disabled,
    emailTags = [],
    inputValue = '',
    onClick,
    onInputChange,
    onKeyDown,
    readOnly,
  }: {
    afterExtra?: ReactNode;
    disabled?: boolean;
    emailTags?: EmailTag[];
    inputValue?: string;
    onClick?: () => void;
    onInputChange?: (value: string) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    readOnly?: boolean;
  }) => (
    <div>
      <div data-testid='selected-tags'>
        {emailTags.map((tag) => (
          <span key={tag.id} data-testid={`tag-${tag.id}`}>
            {tag.name || tag.email}
          </span>
        ))}
      </div>
      <input
        aria-label='invite-input'
        disabled={disabled}
        readOnly={readOnly}
        value={inputValue}
        onChange={(event) => onInputChange?.(event.target.value)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
      {afterExtra}
    </div>
  ),
}));

jest.mock('../PersonSuggestionItem', () => ({
  PersonSuggestionItem: ({ suggestion, onClick }: { suggestion: InviteSuggestion; onClick: () => void }) => {
    const id =
      suggestion.type === 'email'
        ? `email:${suggestion.data}`
        : suggestion.type === 'group'
        ? `group:${suggestion.data.group_id}`
        : `user:${suggestion.data.email}`;
    const label = suggestion.type === 'email' ? suggestion.data : suggestion.data.name;

    return (
      <button type='button' data-testid={`suggestion-${id}`} onClick={onClick}>
        {label}
      </button>
    );
  },
}));

const successfulGroup: WorkspaceGroup = {
  group_id: 'successful-group',
  name: 'Successful Team',
  member_count: 3,
};

const failedGroup: WorkspaceGroup = {
  group_id: 'failed-group',
  name: 'Failed Team',
  member_count: 2,
};

function inviteGuestProps(overrides: Partial<ComponentProps<typeof InviteGuest>> = {}) {
  return {
    sharedPeople: [],
    sharedGroups: [],
    isLoadingPeople: false,
    mentionable: [],
    isLoadingMentionable: false,
    mentionableError: null,
    onInviteSuccess: async () => undefined,
    viewId: 'view-1',
    hasFullAccess: true,
    canGrantFullAccess: true,
    canManageGroupAccess: true,
    ...overrides,
  };
}

function renderInviteGuest(overrides: Partial<ComponentProps<typeof InviteGuest>> = {}) {
  return render(<InviteGuest {...inviteGuestProps(overrides)} />);
}

describe('InviteGuest group sharing', () => {
  beforeEach(() => {
    mockGetWorkspaceGroups.mockReset();
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [successfulGroup, failedGroup] });
    mockSharePageTo.mockReset();
    mockSharePageTo.mockResolvedValue(undefined);
    mockSharePageToGroup.mockReset();
    mockSharePageToGroup.mockResolvedValue(undefined);
    mockSharePageToGroups.mockReset();
    mockNotifyError.mockReset();
    mockNotifySuccess.mockReset();
  });

  it('loads group summaries for a workspace member with page Full Access', async () => {
    renderInviteGuest();

    expect(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`)).toBeTruthy();
    expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1');
  });

  it('does not load group summaries for a workspace member without page Full Access', async () => {
    renderInviteGuest({ hasFullAccess: false, canManageGroupAccess: false });

    await waitFor(() => expect(mockGetWorkspaceGroups).not.toHaveBeenCalled());
    expect(screen.queryByTestId(`suggestion-group:${successfulGroup.group_id}`)).toBeNull();
    expect(screen.getByLabelText('invite-input').readOnly).toBe(true);
  });

  it('keeps person sharing available to a Full Access guest without loading or mutating groups', async () => {
    renderInviteGuest({ canManageGroupAccess: false });

    await waitFor(() => expect(mockGetWorkspaceGroups).not.toHaveBeenCalled());
    expect(screen.queryByTestId(`suggestion-group:${successfulGroup.group_id}`)).toBeNull();

    const input = screen.getByLabelText('invite-input');

    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: 'person@example.com' } });
    fireEvent.click(await screen.findByTestId('suggestion-email:person@example.com'));
    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() =>
      expect(mockSharePageTo).toHaveBeenCalledWith('workspace-1', 'view-1', ['person@example.com'], AccessLevel.ReadOnly)
    );
    expect(mockSharePageToGroup).not.toHaveBeenCalled();
  });

  it('drops selected groups when group authority is lost but still submits selected people', async () => {
    const { rerender } = render(<InviteGuest {...inviteGuestProps()} />);

    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));
    const input = screen.getByLabelText('invite-input');

    fireEvent.change(input, { target: { value: 'person@example.com' } });
    fireEvent.click(await screen.findByTestId('suggestion-email:person@example.com'));
    expect(screen.getByTestId(`tag-group:${successfulGroup.group_id}`)).toBeTruthy();
    expect(screen.getByTestId('tag-user:person@example.com')).toBeTruthy();

    rerender(<InviteGuest {...inviteGuestProps({ canManageGroupAccess: false })} />);

    await waitFor(() => expect(screen.queryByTestId(`tag-group:${successfulGroup.group_id}`)).toBeNull());
    expect(screen.queryByTestId(`suggestion-group:${successfulGroup.group_id}`)).toBeNull();
    expect(screen.getByTestId('tag-user:person@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() =>
      expect(mockSharePageTo).toHaveBeenCalledWith('workspace-1', 'view-1', ['person@example.com'], AccessLevel.ReadOnly)
    );
    expect(mockSharePageToGroup).not.toHaveBeenCalled();
  });

  it('keeps only failed recipients selected and allows retry after a partially successful send', async () => {
    const onInviteSuccess = jest.fn(async () => undefined);

    mockSharePageToGroup.mockImplementation(async (_workspaceId: string, _viewId: string, groupId: string) => {
      if (groupId === failedGroup.group_id) {
        throw new Error('Failed Team request failed');
      }
    });

    renderInviteGuest({ onInviteSuccess });

    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));
    fireEvent.click(await screen.findByTestId(`suggestion-group:${failedGroup.group_id}`));

    const input = screen.getByLabelText('invite-input');

    fireEvent.change(input, { target: { value: 'person@example.com' } });
    fireEvent.click(await screen.findByTestId('suggestion-email:person@example.com'));
    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() => {
      expect(screen.queryByTestId(`tag-group:${successfulGroup.group_id}`)).toBeNull();
      expect(screen.queryByTestId('tag-user:person@example.com')).toBeNull();
      expect(screen.getByTestId(`tag-group:${failedGroup.group_id}`)).toBeTruthy();
    });

    expect(mockSharePageTo).toHaveBeenCalledWith('workspace-1', 'view-1', ['person@example.com'], AccessLevel.ReadOnly);
    expect(mockSharePageToGroup).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      successfulGroup.group_id,
      AccessLevel.ReadOnly
    );
    expect(mockSharePageToGroup).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      failedGroup.group_id,
      AccessLevel.ReadOnly
    );
    expect(mockSharePageToGroups).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith('Failed Team request failed');
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(onInviteSuccess).toHaveBeenCalledTimes(1);

    mockSharePageToGroup.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() => expect(screen.queryByTestId(`tag-group:${failedGroup.group_id}`)).toBeNull());
    expect(mockSharePageTo).toHaveBeenCalledTimes(1);
    expect(mockSharePageToGroup).toHaveBeenCalledTimes(3);
    expect(mockSharePageToGroup).toHaveBeenLastCalledWith(
      'workspace-1',
      'view-1',
      failedGroup.group_id,
      AccessLevel.ReadOnly
    );
    expect(mockNotifySuccess).toHaveBeenCalledWith('shareAction.inviteSuccess');
    expect(onInviteSuccess).toHaveBeenCalledTimes(2);
  });

  it('renders usable group suggestions alongside a mentionable-user error', async () => {
    renderInviteGuest({ mentionableError: 'People could not be loaded' });

    expect(await screen.findByText('People could not be loaded')).toBeTruthy();
    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));

    expect(screen.getByTestId(`tag-group:${successfulGroup.group_id}`)).toBeTruthy();
  });

  it('never submits a Full Access group invite after owner-tier authority is lost', async () => {
    const { rerender } = render(<InviteGuest {...inviteGuestProps()} />);

    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));
    fireEvent.click(screen.getByText('shareAction.fullAccess'));

    rerender(<InviteGuest {...inviteGuestProps({ canGrantFullAccess: false })} />);

    expect(screen.queryByText('shareAction.fullAccess')).toBeNull();
    expect(screen.getByRole('button', { name: 'shareAction.canView' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() =>
      expect(mockSharePageToGroup).toHaveBeenCalledWith(
        'workspace-1',
        'view-1',
        successfulGroup.group_id,
        AccessLevel.ReadOnly
      )
    );
    expect(mockSharePageToGroup).not.toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      successfulGroup.group_id,
      AccessLevel.FullAccess
    );
  });

  it('ignores a late invite result after switching to another view', async () => {
    let resolveFirstInvite!: () => void;
    const firstInvite = new Promise<void>((resolve) => {
      resolveFirstInvite = resolve;
    });
    const firstViewRefresh = jest.fn(async () => undefined);
    const secondViewRefresh = jest.fn(async () => undefined);

    mockSharePageToGroup.mockReturnValueOnce(firstInvite).mockResolvedValueOnce(undefined);

    const { rerender } = render(<InviteGuest {...inviteGuestProps({ onInviteSuccess: firstViewRefresh })} />);

    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));
    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() =>
      expect(mockSharePageToGroup).toHaveBeenCalledWith(
        'workspace-1',
        'view-1',
        successfulGroup.group_id,
        AccessLevel.ReadOnly
      )
    );

    rerender(<InviteGuest {...inviteGuestProps({ viewId: 'view-2', onInviteSuccess: secondViewRefresh })} />);

    await waitFor(() => expect(screen.queryByTestId(`tag-group:${successfulGroup.group_id}`)).toBeNull());
    fireEvent.click(await screen.findByTestId(`suggestion-group:${successfulGroup.group_id}`));
    expect(screen.getByTestId(`tag-group:${successfulGroup.group_id}`)).toBeTruthy();

    await act(async () => {
      resolveFirstInvite();
      await firstInvite;
    });

    expect(screen.getByTestId(`tag-group:${successfulGroup.group_id}`)).toBeTruthy();
    expect(firstViewRefresh).not.toHaveBeenCalled();
    expect(secondViewRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'shareAction.invite' }));

    await waitFor(() => expect(screen.queryByTestId(`tag-group:${successfulGroup.group_id}`)).toBeNull());
    expect(mockSharePageToGroup).toHaveBeenLastCalledWith(
      'workspace-1',
      'view-2',
      successfulGroup.group_id,
      AccessLevel.ReadOnly
    );
    expect(secondViewRefresh).toHaveBeenCalledTimes(1);
  });
});
