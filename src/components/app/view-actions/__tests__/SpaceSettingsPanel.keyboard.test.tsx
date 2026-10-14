import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useState } from 'react';

import { showsKeyboardFocus } from '@/__mocks__/keyboardFocus';
import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { NormalModal } from '@/components/_shared/modal';
import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';
import SpaceSettingsPanel from '@/components/app/view-actions/SpaceSettingsPanel';

mockResizeObserver();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// The icon picker itself is not under test; the trigger is.
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const basePermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Public,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: null,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: { disable_guests: false, disable_public_links: false, disable_export: false },
};

let setBusy: (busy: boolean) => void = () => undefined;

function Harness({
  visibility = SpaceVisibility.Public,
  disabled = false,
  nameDisabled = false,
  loading = false,
  initiallyOpen = true,
  busyOnChange = false,
  onMembersAccessChange = jest.fn(),
}: {
  visibility?: SpaceVisibility;
  disabled?: boolean;
  /** The name and icon, which only people who manage the space can change. */
  nameDisabled?: boolean;
  /** Like Manage Space while it rechecks access in the background. */
  loading?: boolean;
  initiallyOpen?: boolean;
  /** Like Manage Space: choosing a value pauses the settings while it saves. */
  busyOnChange?: boolean;
  onMembersAccessChange?: (value: AccessLevel | null) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusyState] = useState(false);
  // Like Manage Space, a type switch asks first in a modal that does not restore focus itself.
  const [confirming, setConfirming] = useState(false);

  setBusy = setBusyState;

  return (
    <>
      <button type='button' onClick={() => setOpen(true)}>
        Open manage space
      </button>
      <SpaceSettingsPanel
        open={open}
        onClose={() => setOpen(false)}
        title='Manage space'
        modalTestId='manage-space-modal'
        activeTab='general'
        onTabChange={jest.fn()}
        membersTabVisible
        spaceName='Research'
        spaceIcon=''
        spaceIconColor=''
        onSpaceNameChange={jest.fn()}
        onSpaceIconChange={jest.fn()}
        metadataDisabled={nameDisabled}
        permissionSettings={{
          ...basePermission,
          visibility,
          everyone_else_access_level: visibility === SpaceVisibility.Custom ? AccessLevel.ReadOnly : null,
        }}
        visibilityOptions={[SpaceVisibility.Public, SpaceVisibility.Custom, SpaceVisibility.Private]}
        permissionSettingsDisabled={disabled || busy}
        loadingSettings={loading}
        workspaceName='Acme'
        onVisibilitySelect={() => setConfirming(true)}
        onMembersAccessChange={(value) => {
          onMembersAccessChange(value);
          if (busyOnChange) setBusyState(true);
        }}
        onEveryoneElseAccessChange={jest.fn()}
        onSidebarEditPolicyChange={jest.fn()}
        overlay={
          confirming ? (
            <NormalModal
              open
              keepMounted={false}
              disableRestoreFocus
              title='Switch space type?'
              okText='Switch'
              onOk={() => {
                setConfirming(false);
                setBusyState(true);
              }}
              onCancel={() => setConfirming(false)}
              onClose={() => setConfirming(false)}
              PaperProps={{ 'data-testid': 'confirm-dialog' } as object}
            >
              Switch it?
            </NormalModal>
          ) : null
        }
      />
    </>
  );
}

function dialog() {
  return screen.getByTestId('manage-space-modal');
}

function tabbables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('button, input, [tabindex]')).filter(
    (element) => element.tabIndex >= 0 && !(element as HTMLButtonElement).disabled
  );
}

describe('Manage Space General tab with a keyboard', () => {
  it('reaches every control, including the space icon, as named buttons and fields', () => {
    render(<Harness />);
    const reachable = tabbables(dialog());
    const icon = within(dialog()).getByRole('button', { name: 'space.changeIcon' });

    expect(reachable).toContain(icon);
    expect(reachable).toContain(within(dialog()).getByPlaceholderText('space.spaceNamePlaceholder'));
    for (const visibility of [SpaceVisibility.Public, SpaceVisibility.Custom, SpaceVisibility.Private]) {
      expect(reachable).toContain(screen.getByTestId(`manage-space-visibility-option-${visibility}`));
    }

    expect(reachable).toContain(screen.getByTestId('manage-space-workspace-members-access'));
    expect(reachable).toContain(screen.getByTestId('manage-space-switch-to-custom'));
    expect(reachable).toContain(screen.getByTestId('space-sidebar-policy'));
  });

  it('enters the tabs at the current tab and moves between them with the arrow keys', async () => {
    render(<Harness />);
    const tablist = within(dialog()).getByRole('tablist');
    const general = within(dialog()).getByRole('tab', { name: 'space.permissionManager.generalTab' });
    const members = within(dialog()).getByRole('tab', { name: 'space.permissionManager.membersTab' });

    // The tab list is the Tab stop and hands focus to the current tab.
    expect(tabbables(dialog())).toContain(tablist);
    act(() => tablist.focus());
    expect(document.activeElement).toBe(general);
    fireEvent.keyDown(general, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(members));
  });

  it.each([
    [
      SpaceVisibility.Public,
      [
        [
          'manage-space-workspace-members-access',
          'space.permissionManager.workspaceMembers space.memberOverride.levels.canEdit',
        ],
      ],
    ],
    [
      SpaceVisibility.Custom,
      [
        ['manage-space-custom-members-access', 'space.permissionManager.members space.memberOverride.levels.canEdit'],
        [
          'manage-space-everyone-else-access',
          'space.permissionManager.everyoneElse space.memberOverride.levels.canView',
        ],
      ],
    ],
  ])('names each access menu in a %s space by the audience it sets', (visibility, triggers) => {
    render(<Harness visibility={visibility} />);
    for (const [testId, name] of triggers) {
      expect(screen.getByRole('button', { name })).toBe(screen.getByTestId(testId));
    }
  });

  it('opens an access menu from the keyboard, chooses a level, and returns to the menu button', async () => {
    const onMembersAccessChange = jest.fn();

    render(<Harness onMembersAccessChange={onMembersAccessChange} />);
    const trigger = screen.getByTestId('manage-space-workspace-members-access');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const canView = await screen.findByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`);

    act(() => canView.focus());
    fireEvent.keyDown(canView, { key: 'Enter' });
    expect(onMembersAccessChange).toHaveBeenCalledWith(AccessLevel.ReadOnly);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps keyboard focus in the tab while the settings are paused, then returns to the same control', () => {
    const { rerender } = render(<Harness />);
    const trigger = screen.getByTestId('space-sidebar-policy');

    act(() => trigger.focus());
    rerender(<Harness disabled />);
    // Browsers move focus off a disabled button to the page; it stays in the General tab instead.
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId('space-settings-general').contains(document.activeElement)).toBe(true);
    rerender(<Harness />);
    expect(document.activeElement).toBe(trigger);
  });

  /** A background recheck: Manage Space passes `loadingSettings || revalidating`. */
  function recheck(rerender: (ui: JSX.Element) => void) {
    rerender(<Harness loading />);
    rerender(<Harness />);
  }

  /** The user goes from the access menu button back to the space name. */
  function focusNameAfterAnotherControl() {
    const name = within(dialog()).getByPlaceholderText('space.spaceNamePlaceholder');

    act(() => screen.getByTestId('manage-space-workspace-members-access').focus());
    act(() => name.focus());
    return name;
  }

  /** MUI makes this element focusable when nothing in the dialog had focus as it opened. */
  function focusableDialogRoot() {
    const root = dialog().parentElement as HTMLElement;

    root.setAttribute('tabindex', '-1');
    return root;
  }

  it('leaves focus on the tab the user moved to while the settings are rechecked', () => {
    const { rerender } = render(<Harness />);
    const name = focusNameAfterAnotherControl();
    const panel = within(dialog()).getByRole('tabpanel');

    // Shift+Tab from the first control, or a click on blank space in the tab, focuses the tab itself.
    fireEvent.keyDown(name, { key: 'Tab', shiftKey: true });
    act(() => panel.focus());
    recheck(rerender);

    // Typing must not go into the space name.
    expect(document.activeElement).toBe(panel);
  });

  it('leaves focus off the controls after the user clicked blank space that takes no focus', () => {
    const { rerender } = render(<Harness />);
    const name = focusNameAfterAnotherControl();
    const title = within(dialog()).getByText('Manage space');

    fireEvent.pointerDown(title);
    act(() => name.blur());
    fireEvent.pointerUp(title);
    recheck(rerender);

    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus on the dialog after the user clicked blank space in it', () => {
    const { rerender } = render(<Harness />);
    const root = focusableDialogRoot();
    const title = within(dialog()).getByText('Manage space');

    focusNameAfterAnotherControl();
    fireEvent.pointerDown(title);
    act(() => root.focus());
    fireEvent.pointerUp(title);
    recheck(rerender);

    expect(document.activeElement).toBe(root);
  });

  it('still returns to the control after its focus was lost to the dialog', () => {
    const { rerender } = render(<Harness />);
    const root = focusableDialogRoot();
    const name = focusNameAfterAnotherControl();

    // A closing menu dropped focus, and MUI put it on the dialog; no one clicked.
    act(() => root.focus());
    recheck(rerender);

    expect(document.activeElement).toBe(name);
  });

  it('returns to the space name the dialog opened on after a pause', () => {
    const { rerender } = render(<Harness />);
    const name = within(dialog()).getByPlaceholderText('space.spaceNamePlaceholder');

    expect(document.activeElement).toBe(name);
    rerender(<Harness nameDisabled />);
    expect(screen.getByTestId('space-settings-general').contains(document.activeElement)).toBe(true);
    rerender(<Harness />);

    expect(document.activeElement).toBe(name);
  });

  it('returns to the access menu button once a choice that paused the settings has saved', async () => {
    render(<Harness busyOnChange />);
    const trigger = screen.getByTestId('manage-space-workspace-members-access');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const canView = await screen.findByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`);

    act(() => canView.focus());
    fireEvent.keyDown(canView, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // The menu could not give focus back to the paused button.
    expect(document.activeElement).not.toBe(trigger);
    act(() => setBusy(false));
    expect(document.activeElement).toBe(trigger);
  });

  it.each(['Cancel', 'Switch'])('returns to the space type card after its confirmation closes (%s)', async (choice) => {
    render(<Harness />);
    const card = screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`);

    act(() => card.focus());
    fireEvent.click(card);
    const confirm = await screen.findByTestId('confirm-dialog');

    fireEvent.click(within(confirm).getByRole('button', { name: choice === 'Cancel' ? 'button.cancel' : 'Switch' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    if (choice === 'Switch') {
      // Saving the switch pauses the settings; focus comes back when they are available again.
      expect((card as HTMLButtonElement).disabled).toBe(true);
      act(() => setBusy(false));
    }

    expect(document.activeElement).toBe(card);
  });

  it('keeps focus inside the dialog and gives it back to the button that opened it', async () => {
    render(<Harness initiallyOpen={false} />);
    const launcher = screen.getByRole('button', { name: 'Open manage space' });

    act(() => launcher.focus());
    fireEvent.click(launcher);
    const panel = await screen.findByTestId('manage-space-modal');
    const root = panel.closest('[role="presentation"]') as HTMLElement;

    // The name field takes focus when the dialog opens.
    await waitFor(() =>
      expect(document.activeElement).toBe(within(panel).getByPlaceholderText('space.spaceNamePlaceholder'))
    );
    // Focus cannot leave the open dialog.
    act(() => launcher.focus());
    await waitFor(() => expect(root.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(launcher);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('manage-space-modal')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });

  it('shows keyboard focus on the buttons of the space type confirmation', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId(`manage-space-visibility-option-${SpaceVisibility.Custom}`));
    const confirm = await screen.findByTestId('confirm-dialog');

    // The confirmation is its own dialog on the page body, outside the space dialog's rules.
    expect(dialog().contains(confirm)).toBe(false);
    expect(showsKeyboardFocus(within(confirm).getByRole('button', { name: 'button.cancel' }))).toBe(true);
    expect(showsKeyboardFocus(within(confirm).getByRole('button', { name: 'Switch' }))).toBe(true);
  });

  it('shows a visible focus ring on every button in the dialog', () => {
    render(<Harness />);
    // The shared Button removes the browser outline, so the dialog draws the ring for all of them,
    // including a notice above the tabs and the footer buttons.
    expect(dialog().className).toContain('[&_button:focus-visible]:ring-2');
  });
});
