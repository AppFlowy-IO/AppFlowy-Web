import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { WorkspaceSpaceCreationCapabilities } from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { SettingsDialog } from '../Settings';

mockResizeObserver();

const workspaceId = '1053b770-ef6d-4e8f-8485-a795a359d13c';
const emitter = new EventEmitter();
const mockRead = jest.fn();
const mockPolicy = jest.fn();
const mockSetCoverage = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => '1053b770-ef6d-4e8f-8485-a795a359d13c',
  useUserWorkspaceInfo: () => undefined,
  useIsOfficialHosted: () => false,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => undefined,
  useAuthenticatedUserIdOptional: () => 'operator',
}));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockRead(...args),
    setWorkspaceSpaceCreationPolicy: (...args: unknown[]) => mockPolicy(...args),
    listWorkspaceSpaceCreators: async () => ({ selections: [], next_cursor: null }),
    setWorkspaceSpaceCreator: async () => ({ changed: true }),
    getMembers: async () => [],
    getWorkspaceGroups: async () => ({ groups: [] }),
  },
}));
// The first panel stands in for any settings panel with a menu (People, Groups, Billing).
jest.mock('@/components/app/settings/AccountAppPanel', () => ({
  AccountAppPanel: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const menu = jest.requireActual('@/components/ui/dropdown-menu') as typeof import('@/components/ui/dropdown-menu');

    return (
      <menu.DropdownMenu>
        <menu.DropdownMenuTrigger>Language</menu.DropdownMenuTrigger>
        <menu.DropdownMenuContent>
          <menu.DropdownMenuItem>Français</menu.DropdownMenuItem>
        </menu.DropdownMenuContent>
      </menu.DropdownMenu>
    );
  },
}));
// A dialog that keeps itself open on Escape while it saves, like People > Groups > Create group.
jest.mock('@/components/app/settings/ProfilePanel', () => ({
  ProfilePanel: () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const ui = jest.requireActual('@/components/ui/dialog') as typeof import('@/components/ui/dialog');
    /* eslint-enable @typescript-eslint/no-var-requires */

    return (
      <ui.Dialog open>
        <ui.DialogContent data-testid='saving-dialog' onEscapeKeyDown={(event) => event.preventDefault()}>
          <ui.DialogTitle>Create group</ui.DialogTitle>
          <ui.DialogDescription>Saving</ui.DialogDescription>
          <button type='button'>Create</button>
        </ui.DialogContent>
      </ui.Dialog>
    );
  },
}));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));
jest.mock('@/application/services/js-services/http/group-space-coverage-api', () => ({
  ...jest.requireActual('@/application/services/js-services/http/group-space-coverage-api'),
  setGroupSpaceCoverage: (...args: unknown[]) => mockSetCoverage(...args),
}));
// People > Groups > group dialog (a Radix dialog inside Settings) with its real coverage card.
jest.mock('@/components/app/settings/MembersPanel', () => ({
  MembersPanel: () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = jest.requireActual('react') as typeof import('react');
    const ui = jest.requireActual('@/components/ui/dialog') as typeof import('@/components/ui/dialog');
    const coverage = jest.requireActual(
      '@/components/app/settings/GroupSpaceCoverageControl'
    ) as typeof import('@/components/app/settings/GroupSpaceCoverageControl');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const [open, setOpen] = React.useState(true);
    const [group] = React.useState(() => ({
      group_id: 'a9897632-edee-47e0-ae03-0996cc65d7a2',
      name: 'W_RH_edit',
      member_count: 3,
      space_coverage_supported: true,
      can_manage_space_coverage: true,
      space_coverage_access_level: null,
    }));

    return (
      <ui.Dialog open={open} onOpenChange={setOpen}>
        <ui.DialogContent data-testid='group-dialog'>
          <ui.DialogTitle>W_RH_edit</ui.DialogTitle>
          <ui.DialogDescription>Group settings</ui.DialogDescription>
          <coverage.GroupSpaceCoverageCard workspaceId='1053b770-ef6d-4e8f-8485-a795a359d13c' group={group} />
        </ui.DialogContent>
      </ui.Dialog>
    );
  },
}));

const capability: WorkspaceSpaceCreationCapabilities = {
  workspace_id: workspaceId,
  policy: 'members_and_owners',
  revision: { epoch: '1', counter: '1' },
  selected_creators_supported: true,
  group_selection_supported: true,
  can_create_space: true,
  can_manage_space_creators: true,
  can_grant_creator_groups: true,
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AuthInternalContext.Provider
        value={{ isAuthenticated: true, currentWorkspaceId: workspaceId, onChangeWorkspace: jest.fn() }}
      >
        <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
      </AuthInternalContext.Provider>
    </MemoryRouter>
  );
}

function renderSettings() {
  const onClose = jest.fn();

  render(<SettingsDialog open onClose={onClose} />, { wrapper: Providers });
  return onClose;
}

describe('Escape in Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    mockRead.mockResolvedValue(capability);
  });

  it('cancels the question about fewer people creating spaces and keeps Settings open', async () => {
    const onClose = renderSettings();

    fireEvent.click(screen.getByTestId('settings-menu-permissions'));
    const narrower = await screen.findByTestId('space-creation-policy-owners_only');

    act(() => narrower.focus());
    fireEvent.click(narrower);
    const question = await screen.findByRole('alertdialog');

    await waitFor(() => expect(question.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-dialog')).toBeTruthy();
    expect(mockPolicy).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('space-creation-policy-owners_only')));
  });

  it('closes only an open menu inside Settings', async () => {
    const onClose = renderSettings();
    const trigger = screen.getByRole('button', { name: 'Language' });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('cancels giving a group access to all spaces and keeps the group dialog and Settings open', async () => {
    const onClose = renderSettings();

    fireEvent.click(screen.getByTestId('settings-menu-members'));
    const trigger = await screen.findByTestId('group-space-coverage-trigger');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const canView = await screen.findByTestId('group-space-coverage-option-10');

    act(() => canView.focus());
    fireEvent.keyDown(canView, { key: 'Enter' });
    const question = await screen.findByTestId('group-space-coverage-confirmation');

    await waitFor(() => expect(question.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('group-space-coverage-confirmation')).toBeNull());

    expect(mockSetCoverage).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Settings open on Escape while a dialog inside it keeps itself open to save', async () => {
    const onClose = renderSettings();

    fireEvent.click(screen.getByTestId('settings-menu-profile'));
    const saving = await screen.findByTestId('saving-dialog');
    const create = within(saving).getByRole('button', { name: 'Create' });

    act(() => create.focus());
    fireEvent.keyDown(create, { key: 'Escape', code: 'Escape' });

    expect(screen.getByTestId('saving-dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes Settings on Escape from one of its own controls', () => {
    const onClose = renderSettings();
    const item = screen.getByTestId('settings-menu-permissions');

    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
