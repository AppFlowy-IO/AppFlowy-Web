import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermission,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  ViewLayout,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';

import type { ReactNode } from 'react';

const mockCreateSpace = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();

// The default structured settings a new custom space is created with.
const customPermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Custom,
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
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    createSpace: mockCreateSpace,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ children, open, onOk }: { children: ReactNode; open: boolean; onOk: () => void | Promise<void> }) =>
    open ? (
      <div>
        <button data-testid='create-space-save' onClick={() => void onOk()}>
          save
        </button>
        {children}
      </div>
    ) : null,
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

describe('CreateSpaceModal visibility options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSpace.mockResolvedValue('space-id');
    mockCreateSpaceWithInitialPage.mockResolvedValue({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });
  });

  it('offers Public, Custom and Private, defaulting to Public', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('space-visibility-button').textContent).toContain('space.publicPermission');
    fireEvent.click(screen.getByTestId('space-visibility-button'));

    expect(screen.getAllByTestId(/^space-visibility-option-/)).toHaveLength(3);
    expect(screen.getByTestId('space-visibility-option-public').textContent).toContain('space.publicPermission');
    expect(screen.getByTestId('space-visibility-option-custom').textContent).toContain('space.customPermission');
    expect(screen.getByTestId('space-visibility-option-custom').textContent).toContain(
      'space.customPermissionDescription'
    );
    expect(screen.getByTestId('space-visibility-option-private').textContent).toContain('space.privatePermission');
    expect(screen.getByTestId('space-visibility-option-private').textContent).toContain(
      'space.privatePermissionDescription'
    );
    // Only the new Custom option carries the NEW badge.
    expect(screen.getAllByTestId('space-visibility-new-badge')).toHaveLength(1);
    expect(screen.getByTestId('space-visibility-option-custom').textContent).toContain('space.newBadge');
    expect(screen.getByTestId('space-visibility-option-public').textContent).not.toContain('space.newBadge');
  });

  it('uses the compatibility Public value for a public space', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Marketing' },
    });
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'Marketing',
        space_icon: '',
        space_icon_color: '',
        space_permission: SpacePermission.Public,
      })
    );
  });

  it('uses the compatibility Private value for a private space', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('space-visibility-button'));
    fireEvent.click(screen.getByTestId('space-visibility-option-private'));
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith(
        expect.objectContaining({
          space_permission: SpacePermission.Private,
        })
      )
    );
  });

  it('sends the structured custom permission instead of a legacy value for a custom space', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('space.spaceNamePlaceholder'), {
      target: { value: 'Custom space' },
    });
    fireEvent.click(screen.getByTestId('space-visibility-button'));
    fireEvent.click(screen.getByTestId('space-visibility-option-custom'));
    expect(screen.getByTestId('space-visibility-button').textContent).toContain('space.customPermission');
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'Custom space',
        space_icon: '',
        space_icon_color: '',
        permission: customPermission,
      })
    );
    expect(mockCreateSpace.mock.calls[0][0]).not.toHaveProperty('space_permission');
  });

  it('keeps the structured custom permission when creating the initial page', async () => {
    const initialPage = { layout: ViewLayout.Document, name: 'First page' };

    render(<CreateSpaceModal open onClose={jest.fn()} initialPage={initialPage} />);
    fireEvent.click(screen.getByTestId('space-visibility-button'));
    fireEvent.click(screen.getByTestId('space-visibility-option-custom'));
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() =>
      expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledWith({
        name: '',
        space_icon: '',
        space_icon_color: '',
        permission: customPermission,
        initial_page: initialPage,
      })
    );
    expect(mockCreateSpaceWithInitialPage.mock.calls[0][0]).not.toHaveProperty('space_permission');
    expect(mockCreateSpace).not.toHaveBeenCalled();
  });

  it('surfaces a structured create failure for a custom space instead of swallowing it', async () => {
    mockCreateSpace.mockRejectedValueOnce(new Error('structured spaces unavailable'));
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('space-visibility-button'));
    fireEvent.click(screen.getByTestId('space-visibility-option-custom'));
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('structured spaces unavailable'));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('uses the same Public compatibility path when creating the initial page', async () => {
    const initialPage = { layout: ViewLayout.Document, name: 'First page' };

    render(<CreateSpaceModal open onClose={jest.fn()} initialPage={initialPage} />);
    fireEvent.click(screen.getByTestId('create-space-save'));

    await waitFor(() =>
      expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledWith({
        name: '',
        space_icon: '',
        space_icon_color: '',
        space_permission: SpacePermission.Public,
        initial_page: initialPage,
      })
    );
    expect(mockCreateSpace).not.toHaveBeenCalled();
  });
});
