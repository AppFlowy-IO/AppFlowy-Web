import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';

let mockManageSpaceModuleLoads = 0;
let mockCreateSpaceModuleLoads = 0;
let mockManageSpaceModuleError: Error | null = null;
const mockNotifyError = jest.fn();

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ updatePage: jest.fn() }),
  useAppOutline: () => [],
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));

jest.mock('@/components/app/view-actions/RenameModal', () => ({
  __esModule: true,
  default: () => <div data-testid='rename-modal' />,
}));

jest.mock('@/components/app/view-actions/DeletePageConfirm', () => ({
  __esModule: true,
  default: () => <div data-testid='delete-page-modal' />,
}));

jest.mock('@/components/app/view-actions/DeleteSpaceConfirm', () => ({
  __esModule: true,
  default: () => <div data-testid='delete-space-modal' />,
}));

jest.mock('@/components/app/view-actions/ManageSpace', () => {
  mockManageSpaceModuleLoads += 1;
  if (mockManageSpaceModuleError) throw mockManageSpaceModuleError;

  return {
    __esModule: true,
    default: ({ viewId, onClose }: { viewId: string; onClose: () => void }) => (
      <div data-testid='manage-space-modal'>
        {viewId}
        <button data-testid='close-manage-space' onClick={onClose}>
          close manage
        </button>
      </div>
    ),
  };
});

jest.mock('@/components/app/view-actions/CreateSpaceModal', () => {
  mockCreateSpaceModuleLoads += 1;

  return {
    __esModule: true,
    default: ({ onClose }: { onClose: () => void }) => (
      <div data-testid='create-space-modal'>
        <button data-testid='close-create-space' onClick={onClose}>
          close create
        </button>
      </div>
    ),
  };
});

function OverlayControls() {
  const { openCreateSpaceModal, openManageSpaceModal } = useAppOverlayContext();

  return (
    <div data-testid='app-content'>
      <button data-testid='open-manage-space' onClick={() => openManageSpaceModal('space-1')}>
        manage
      </button>
      <button data-testid='open-create-space' onClick={openCreateSpaceModal}>
        create
      </button>
    </div>
  );
}

describe('AppOverlayProvider lazy space modals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManageSpaceModuleError = null;
  });

  it('keeps lazy dialog loading dismissible and retries a failed import without replacing app content', async () => {
    render(
      <AppOverlayProvider>
        <OverlayControls />
      </AppOverlayProvider>
    );

    expect(mockManageSpaceModuleLoads).toBe(0);
    expect(mockCreateSpaceModuleLoads).toBe(0);
    expect(screen.getByTestId('app-content')).toBeTruthy();

    mockManageSpaceModuleError = new Error('chunk unavailable');
    fireEvent.click(screen.getByTestId('open-manage-space'));
    expect(screen.getByTestId('manage-space-loading')).toBeTruthy();
    fireEvent.click(screen.getByTestId('manage-space-loading-cancel'));
    await act(async () => undefined);
    expect(mockNotifyError).not.toHaveBeenCalled();
    expect(screen.queryByTestId('manage-space-loading')).toBeNull();
    expect(screen.queryByTestId('manage-space-modal')).toBeNull();
    expect(screen.getByTestId('app-content')).toBeTruthy();

    fireEvent.click(screen.getByTestId('open-manage-space'));
    expect(screen.getByTestId('manage-space-loading')).toBeTruthy();
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Unable to load the space dialog. Please try again.'));
    expect(screen.queryByTestId('manage-space-loading')).toBeNull();
    expect(screen.queryByTestId('manage-space-modal')).toBeNull();
    expect(screen.getByTestId('app-content')).toBeTruthy();

    mockManageSpaceModuleError = null;
    fireEvent.click(screen.getByTestId('open-manage-space'));
    expect(screen.getByTestId('manage-space-loading')).toBeTruthy();
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(await screen.findByTestId('manage-space-modal')).toBeTruthy();
    expect(mockManageSpaceModuleLoads).toBe(3);
    expect(mockCreateSpaceModuleLoads).toBe(0);

    fireEvent.click(screen.getByTestId('close-manage-space'));
    await waitFor(() => expect(screen.queryByTestId('manage-space-modal')).toBeNull());

    fireEvent.click(screen.getByTestId('open-create-space'));
    expect(screen.getByTestId('create-space-loading')).toBeTruthy();
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(await screen.findByTestId('create-space-modal')).toBeTruthy();
    expect(mockManageSpaceModuleLoads).toBe(3);
    expect(mockCreateSpaceModuleLoads).toBe(1);

    fireEvent.click(screen.getByTestId('close-create-space'));
    await waitFor(() => expect(screen.queryByTestId('create-space-modal')).toBeNull());
    expect(screen.getByTestId('app-content')).toBeTruthy();
  });
});
