import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SpacePermission, ViewLayout } from '@/application/types';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';

import type { ReactNode } from 'react';

const mockCreateSpace = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();

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

  it('offers Public and Private while keeping Open and Closed hidden', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('space-visibility-button').textContent).toContain('space.publicPermission');
    fireEvent.click(screen.getByTestId('space-visibility-button'));

    expect(screen.queryByTestId('space-visibility-option-open')).toBeNull();
    expect(screen.queryByTestId('space-visibility-option-closed')).toBeNull();
    expect(screen.getByTestId('space-visibility-option-default').textContent).toContain('space.publicPermission');
    expect(screen.getByTestId('space-visibility-option-private')).toBeTruthy();
  });

  it('uses the compatibility Public value so the server maps it to Default', async () => {
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
