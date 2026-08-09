import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { CrossWorkspaceCopyTerminalError } from '@/application/services/domains/page';
import { ViewLayout, type View, type Workspace } from '@/application/types';

const mockCopyPageToWorkspace = jest.fn();
const mockMovePage = jest.fn();
const mockNavigate = jest.fn();
const mockOnMoved = jest.fn();
const mockShowBlockingLoader = jest.fn();
const mockHideBlockingLoader = jest.fn();
const mockUuidv4 = jest.fn();

const sourceWorkspace: Workspace = {
  id: 'source-workspace-id',
  name: 'Source workspace',
  icon: '',
  memberCount: 1,
  databaseStorageId: 'source-storage-id',
  createdAt: '',
};
const destinationWorkspace: Workspace = {
  id: 'destination-workspace-id',
  name: 'Destination workspace',
  icon: '',
  memberCount: 1,
  databaseStorageId: 'destination-storage-id',
  createdAt: '',
};
const sourceView: View = {
  view_id: 'source-view-id',
  name: 'Source page',
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
};
const destinationParent: View = {
  ...sourceView,
  view_id: 'destination-parent-id',
  name: 'Destination parent',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; workspace?: string }) => {
      const messages: Record<string, string> = {
        'button.duplicate': 'Duplicate',
        'disclosureAction.copyToWorkspaceDependencies':
          'Links and relations to content outside this page may need attention.',
        'disclosureAction.copyToWorkspacePrivate': `A copy will be added to Private in ${values?.workspace}.`,
        'disclosureAction.copyToWorkspaceSourceRetained': 'The original stays in this workspace.',
        'disclosureAction.copyingToWorkspace': `Copying to ${values?.workspace}...`,
        'disclosureAction.move': 'Move',
        'disclosureAction.movePageTo': 'Move page to',
        'disclosureAction.moveToWorkspaceSelect': 'Select a destination workspace',
      };

      return messages[key] ?? key;
    },
  }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('uuid', () => ({
  v4: () => mockUuidv4(),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    copyPageToWorkspace: mockCopyPageToWorkspace,
    movePage: mockMovePage,
  }),
  useAppOutline: () => [destinationParent],
  useAppView: () => sourceView,
  useCurrentWorkspaceId: () => sourceWorkspace.id,
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: sourceWorkspace,
    userId: 'user-id',
    workspaces: [sourceWorkspace, destinationWorkspace],
  }),
}));

jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({
    showBlockingLoader: mockShowBlockingLoader,
    hideBlockingLoader: mockHideBlockingLoader,
  }),
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

jest.mock('@/components/_shared/outline/OutlineIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/app/outline/SpaceItem', () => ({
  __esModule: true,
  default: ({ view, onClickView }: { view: View; onClickView: (viewId: string) => void }) => (
    <button data-testid={`move-target-${view.view_id}`} onClick={() => onClickView(view.view_id)}>
      {view.name}
    </button>
  ),
}));

import MovePagePopover from '../MovePagePopover';

describe('MovePagePopover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockUuidv4.mockReturnValue('copy-action-id');
    mockMovePage.mockResolvedValue(undefined);
    mockCopyPageToWorkspace.mockResolvedValue({
      duplicated_view_id: 'copied-view-id',
      dest_workspace_id: destinationWorkspace.id,
      operation: 'cross_workspace_copy',
      source_retained: true,
      warnings: [],
    });
  });

  it('keeps same-workspace selection as an identity-preserving move', async () => {
    render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );

    fireEvent.click(screen.getByTestId(`move-target-${destinationParent.view_id}`));
    fireEvent.click(screen.getByTestId('move-page-confirm'));

    await waitFor(() => expect(mockMovePage).toHaveBeenCalledWith(sourceView.view_id, destinationParent.view_id));
    expect(mockCopyPageToWorkspace).not.toHaveBeenCalled();
  });

  it('explains and starts a source-retaining copy when another workspace is selected', async () => {
    render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );

    fireEvent.change(screen.getByTestId('move-page-workspace-selector'), {
      target: { value: destinationWorkspace.id },
    });

    expect(screen.getByText('A copy will be added to Private in Destination workspace.')).toBeTruthy();
    expect(screen.getByText('The original stays in this workspace.')).toBeTruthy();
    expect(screen.getByTestId('move-page-confirm').textContent).toBe('Duplicate');

    fireEvent.click(screen.getByTestId('move-page-confirm'));

    await waitFor(() =>
      expect(mockCopyPageToWorkspace).toHaveBeenCalledWith(sourceView.view_id, {
        dest_workspace_id: destinationWorkspace.id,
        idempotency_key: 'copy-action-id',
      })
    );
    expect(mockMovePage).not.toHaveBeenCalled();
    expect(mockShowBlockingLoader).toHaveBeenCalledWith('Copying to Destination workspace...');
    expect(mockNavigate).toHaveBeenCalledWith(`/app/${destinationWorkspace.id}/copied-view-id`);
    expect(mockHideBlockingLoader).toHaveBeenCalled();
  });

  it('reuses the idempotency key after an ambiguous failure and popover remount', async () => {
    mockCopyPageToWorkspace.mockRejectedValueOnce({ code: -1, message: 'Network error' });
    const firstRender = render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );

    fireEvent.change(screen.getByTestId('move-page-workspace-selector'), {
      target: { value: destinationWorkspace.id },
    });

    fireEvent.click(screen.getByTestId('move-page-confirm'));
    await waitFor(() => expect(mockCopyPageToWorkspace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockHideBlockingLoader).toHaveBeenCalledTimes(1));
    expect(mockOnMoved).not.toHaveBeenCalled();

    firstRender.unmount();
    render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );
    fireEvent.change(screen.getByTestId('move-page-workspace-selector'), {
      target: { value: destinationWorkspace.id },
    });
    fireEvent.click(screen.getByTestId('move-page-confirm'));
    await waitFor(() => expect(mockCopyPageToWorkspace).toHaveBeenCalledTimes(2));

    expect(mockCopyPageToWorkspace.mock.calls[0][1].idempotency_key).toBe('copy-action-id');
    expect(mockCopyPageToWorkspace.mock.calls[1][1].idempotency_key).toBe('copy-action-id');
    expect(mockUuidv4).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockOnMoved).toHaveBeenCalledTimes(1));
  });

  it('uses a new idempotency key after a server-confirmed terminal failure', async () => {
    mockUuidv4.mockReturnValueOnce('failed-action-id').mockReturnValueOnce('replacement-action-id');
    mockCopyPageToWorkspace.mockRejectedValueOnce(new CrossWorkspaceCopyTerminalError('Failed', 'Copy task failed'));
    const firstRender = render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );

    fireEvent.change(screen.getByTestId('move-page-workspace-selector'), {
      target: { value: destinationWorkspace.id },
    });

    fireEvent.click(screen.getByTestId('move-page-confirm'));
    await waitFor(() => expect(mockHideBlockingLoader).toHaveBeenCalledTimes(1));

    firstRender.unmount();
    render(
      <MovePagePopover viewId={sourceView.view_id} open onMoved={mockOnMoved}>
        <button>Open</button>
      </MovePagePopover>
    );
    fireEvent.change(screen.getByTestId('move-page-workspace-selector'), {
      target: { value: destinationWorkspace.id },
    });
    fireEvent.click(screen.getByTestId('move-page-confirm'));
    await waitFor(() => expect(mockCopyPageToWorkspace).toHaveBeenCalledTimes(2));

    expect(mockCopyPageToWorkspace.mock.calls[0][1].idempotency_key).toBe('failed-action-id');
    expect(mockCopyPageToWorkspace.mock.calls[1][1].idempotency_key).toBe('replacement-action-id');
    expect(mockUuidv4).toHaveBeenCalledTimes(2);
  });
});
