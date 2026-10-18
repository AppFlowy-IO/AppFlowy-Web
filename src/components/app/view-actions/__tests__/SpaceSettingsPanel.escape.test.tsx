import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
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
// The real icon popover runs; only the icon grid is replaced by its search field.
jest.mock('@/components/_shared/icon-picker/IconPicker', () => ({
  __esModule: true,
  default: ({ onEscape }: { onEscape?: () => void }) => (
    <input
      aria-label='Search icons'
      autoFocus
      onKeyUp={(event) => {
        if (event.key === 'Escape') onEscape?.();
      }}
    />
  ),
}));
jest.mock('@/components/_shared/emoji-picker', () => ({ EmojiPicker: () => null }));
jest.mock('@/components/_shared/image-upload', () => ({ UploadImage: () => null }));

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

/** Create Space resets its whole draft when the dialog closes, so an extra close loses the user's work. */
function renderPanel(onClose = jest.fn()) {
  render(
    <SpaceSettingsPanel
      open
      onClose={onClose}
      title='Create space'
      modalTestId='create-space-modal'
      activeTab='general'
      onTabChange={jest.fn()}
      membersTabVisible
      spaceName='Research'
      spaceIcon=''
      spaceIconColor=''
      onSpaceNameChange={jest.fn()}
      onSpaceIconChange={jest.fn()}
      permissionSettings={permission}
      visibilityOptions={[SpaceVisibility.Public, SpaceVisibility.Custom, SpaceVisibility.Private]}
      workspaceName='Acme'
      onVisibilitySelect={jest.fn()}
      onMembersAccessChange={jest.fn()}
      onEveryoneElseAccessChange={jest.fn()}
      onSidebarEditPolicyChange={jest.fn()}
    />
  );
  return onClose;
}

/** A real key press: down and up on the focused element. */
function pressEscape() {
  const target = document.activeElement as HTMLElement;

  fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
  fireEvent.keyUp(target, { key: 'Escape', code: 'Escape' });
}

describe('Escape in the space settings dialog', () => {
  it('closes only an open access menu and returns to its button', async () => {
    const onClose = renderPanel();
    const trigger = screen.getByTestId('manage-space-workspace-members-access');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menu');
    pressEscape();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes only the open icon picker and returns to the space icon', async () => {
    const onClose = renderPanel();
    const icon = screen.getByRole('button', { name: 'space.changeIcon' });

    act(() => icon.focus());
    fireEvent.click(icon);
    const search = await screen.findByRole('textbox', { name: 'Search icons' });

    await waitFor(() => expect(document.activeElement).toBe(search));
    pressEscape();
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search icons' })).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(icon));
  });

  it('still closes the dialog on Escape from one of its own controls', () => {
    const onClose = renderPanel();
    const name = screen.getByPlaceholderText('space.spaceNamePlaceholder');

    act(() => name.focus());
    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
