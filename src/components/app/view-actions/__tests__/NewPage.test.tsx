import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AtomicCreationPendingError } from '@/application/atomic-creation';
import { AccessLevel, ViewLayout } from '@/application/types';
import type { CreatePagePayload } from '@/application/types';
import NewPage from '@/components/app/view-actions/NewPage';

import type { ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockOpenPageModal = jest.fn();
const mockEnsureViewVisibleInOutline = jest.fn();
const mockNotifyError = jest.fn();
const mockRefreshCapability = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockEventEmitter = new EventEmitter();
let mockCanCreateSpace = true;
let mockCapabilityStatus: 'loading' | 'ready' | 'unsupported' | 'error' = 'ready';

jest.mock('@/components/app/hooks/useSpaceCreationCapability', () => ({
  useSpaceCreationCapability: () => ({
    status: mockCapabilityStatus,
    canCreateSpace: mockCanCreateSpace,
    capability: mockCapabilityStatus === 'ready' ? { can_create_space: mockCanCreateSpace } : undefined,
    refresh: mockRefreshCapability,
    scopeKey: 'workspace-1',
  }),
}));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args) },
  AccessService: { getObjectPermission: jest.fn() },
}));
let mockCreateSpaceModuleLoads = 0;
let mockCreateSpaceModuleError: Error | null = null;
let mockOutline: Array<{
  view_id: string;
  name: string;
  extra: Record<string, never>;
  is_private: boolean;
  children: never[];
}> = [];
let mockCreatedSpaceId = 'space-created';
let mockCreatedPageId = 'page-created';
let lastCreateSpaceProps:
  | {
      initialPage?: CreatePagePayload;
      onClose: () => void;
      onCreated?: (spaceId: string, pageId?: string) => void | Promise<void>;
    }
  | undefined;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@mui/material', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span data-testid='progress' /> }));
jest.mock('@/components/_shared/view-icon/SpaceIcon', () => ({ __esModule: true, default: () => <span /> }));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onClose,
    onOk,
    okButtonProps,
    ...props
  }: {
    children: ReactNode;
    open: boolean;
    onClose: () => void;
    onOk?: () => void;
    okButtonProps?: { disabled?: boolean };
    [key: string]: unknown;
  }) =>
    open ? (
      <div data-testid={props['data-testid'] as string | undefined}>
        <button data-testid='new-page-modal-close' onClick={onClose}>
          close
        </button>
        <button data-testid='new-page-modal-ok' disabled={okButtonProps?.disabled} onClick={onOk}>
          ok
        </button>
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useAppOperations: () => ({
    addPage: mockAddPage,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
  useAppOutline: () => mockOutline,
  useEnsureViewVisibleInOutline: () => mockEnsureViewVisibleInOutline,
  useOpenPageModal: () => mockOpenPageModal,
}));

jest.mock('@/components/app/view-actions/CreateSpaceModal', () => {
  mockCreateSpaceModuleLoads += 1;
  if (mockCreateSpaceModuleError) throw mockCreateSpaceModuleError;

  return {
    __esModule: true,
    default: ({
      open,
      initialPage,
      onClose,
      onCreated,
    }: {
      open: boolean;
      initialPage?: CreatePagePayload;
      onClose: () => void;
      onCreated?: (spaceId: string, pageId?: string) => void | Promise<void>;
    }) => {
      lastCreateSpaceProps = { initialPage, onClose, onCreated };

      return open ? (
        <div data-testid='create-space-draft-panel'>
          <button data-testid='create-space-draft-close' onClick={onClose}>
            close draft
          </button>
          <button
            data-testid='create-space-draft-complete'
            onClick={async () => {
              await onCreated?.(mockCreatedSpaceId, mockCreatedPageId);
              onClose();
            }}
          >
            complete draft
          </button>
        </div>
      ) : null;
    },
  };
});

describe('NewPage create-space flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter.removeAllListeners();
    mockCanCreateSpace = true;
    mockCapabilityStatus = 'ready';
    mockGetSpacePermission.mockResolvedValue({
      current_user_access_level: AccessLevel.ReadAndWrite,
      can_edit_sidebar: true,
    });
    mockOutline = [];
    mockCreatedSpaceId = 'space-created';
    mockCreatedPageId = 'page-created';
    mockCreateSpaceModuleError = null;
    lastCreateSpaceProps = undefined;
    mockEnsureViewVisibleInOutline.mockResolvedValue([]);
  });

  async function openCreateSpaceFlow() {
    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
    await screen.findByTestId('create-space-draft-panel');
  }

  function space(viewId: string, name = viewId) {
    return { view_id: viewId, name, extra: {} as Record<string, never>, is_private: false, children: [] as never[] };
  }

  async function selectSpace(name: string) {
    const row = screen.getAllByTestId('space-item').find((item) => item.textContent?.includes(name));

    if (!row) throw new Error(`No destination row for ${name}`);
    fireEvent.click(row);
    return row;
  }

  it('denies new spaces without disabling creation inside an existing authorized space', async () => {
    mockCanCreateSpace = false;
    mockOutline = [space('space-existing', 'Existing')];
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));
    expect((screen.getByTestId('new-page-create-space-button')).disabled).toBe(true);
    await selectSpace('Existing');
    await waitFor(() => expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(false));
  });

  it('offers only spaces where pages can be added directly and says why the others are unavailable', async () => {
    mockOutline = [space('general', 'General'), space('hr', 'HR'), space('product', 'Product')];
    mockGetSpacePermission.mockImplementation(async (_workspaceId: string, spaceId: string) => ({
      general: { current_user_access_level: AccessLevel.ReadAndWrite, can_edit_sidebar: true },
      hr: { current_user_access_level: AccessLevel.ReadAndWrite, can_edit_sidebar: false },
      product: { current_user_access_level: AccessLevel.ReadOnly, can_edit_sidebar: false },
    })[spaceId]);
    mockAddPage.mockResolvedValue({ view_id: 'general-page' });
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));

    const rows = () => screen.getAllByTestId('space-item');

    await waitFor(() => expect(rows()[1].hasAttribute('disabled')).toBe(true));
    expect(rows()[0].hasAttribute('disabled')).toBe(false);
    expect(within(rows()[1]).getByText('spaceCreation.pageDestination.ownersOnly')).toBeTruthy();
    await waitFor(() => expect(rows()[2].hasAttribute('disabled')).toBe(true));
    expect(within(rows()[2]).getByText('spaceCreation.pageDestination.noEdit')).toBeTruthy();
    expect(mockGetSpacePermission).toHaveBeenCalledTimes(3);

    await selectSpace('General');
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledWith('general', expect.objectContaining({ layout: ViewLayout.Document })));
  });

  it('keeps Add disabled while the selected space is still being checked', async () => {
    const permission = deferred<{ current_user_access_level: AccessLevel; can_edit_sidebar: boolean }>();

    mockOutline = [space('general', 'General')];
    mockGetSpacePermission.mockReturnValue(permission.promise);
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));
    await selectSpace('General');
    expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(true);
    expect(screen.getByTestId('new-page-destination-status').textContent).toBe('spaceCreation.pageDestination.checking');
    await act(async () => {
      permission.resolve({ current_user_access_level: AccessLevel.ReadAndWrite, can_edit_sidebar: true });
      await permission.promise;
    });
    expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(false);
    expect(screen.queryByTestId('new-page-destination-status')).toBeNull();
  });

  it('forgets a selected space that is no longer listed instead of checking it forever', async () => {
    mockOutline = [space('general', 'General'), space('hr', 'HR')];
    const app = render(<NewPage />);
    const ok = () => screen.getByTestId('new-page-modal-ok');
    const probesSettled = () => expect(screen.queryAllByTestId('progress')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('new-page-button'));
    await selectSpace('HR');
    await waitFor(() => expect(ok().disabled).toBe(false));

    // HR leaves the outline while the dialog is open (for example the member was removed).
    mockOutline = [space('general', 'General')];
    app.rerender(<NewPage />);
    await waitFor(probesSettled);
    expect(ok().disabled).toBe(true);
    expect(screen.queryByTestId('new-page-destination-status')).toBeNull();

    // Reopening never resumes the old selection or waits for a check that will not run.
    fireEvent.click(screen.getByTestId('new-page-modal-close'));
    fireEvent.click(screen.getByTestId('new-page-button'));
    await waitFor(probesSettled);
    expect(ok().disabled).toBe(true);
    expect(screen.queryByTestId('new-page-destination-status')).toBeNull();
    expect(screen.getAllByTestId('space-item').map((row) => row.getAttribute('aria-pressed'))).toEqual(['false']);

    await selectSpace('General');
    await waitFor(() => expect(ok().disabled).toBe(false));
  });

  it('explains when no space accepts new pages', async () => {
    mockOutline = [space('hr', 'HR')];
    mockGetSpacePermission.mockResolvedValue({ current_user_access_level: AccessLevel.ReadOnly, can_edit_sidebar: false });
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));
    await waitFor(() =>
      expect(screen.getByTestId('new-page-destination-status').textContent).toBe('spaceCreation.pageDestination.noneAvailable'));
  });

  it.each([
    ['denied', 'ready', 'workspacePermissions.denied'],
    ['still checking', 'loading', 'workspacePermissions.loading'],
    ['unknown after a failed check', 'error', 'workspacePermissions.loadError'],
  ] as const)('shows a visible reason when space creation is %s', async (_case, status, reason) => {
    mockCanCreateSpace = false;
    mockCapabilityStatus = status;
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));

    expect((screen.getByTestId('new-page-create-space-button')).disabled).toBe(true);
    expect(screen.getByTestId('new-page-create-space-reason').textContent).toContain(reason);
    if (status === 'error') {
      fireEvent.click(within(screen.getByTestId('new-page-create-space-reason')).getByRole('button'));
      expect(mockRefreshCapability).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps lazy loading dismissible and retries the Create Space import after a failure', async () => {
    render(<NewPage />);

    mockCreateSpaceModuleError = new Error('chunk unavailable');
    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
    expect(screen.getByTestId('new-page-create-space-loading')).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-page-create-space-loading-cancel'));
    await act(async () => undefined);
    expect(mockNotifyError).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-page-create-space-loading')).toBeNull();
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
    expect(screen.getByTestId('new-page-create-space-loading')).toBeTruthy();
    await waitFor(() =>
      expect(mockNotifyError).toHaveBeenCalledWith('Unable to load the Create Space dialog. Please try again.')
    );
    expect(screen.queryByTestId('new-page-create-space-loading')).toBeNull();
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();

    mockCreateSpaceModuleError = null;
    await openCreateSpaceFlow();
    expect(mockCreateSpaceModuleLoads).toBe(3);
    expect(screen.getByTestId('create-space-draft-panel')).toBeTruthy();
  });

  it('loads and mounts the Create Space draft only while that flow is open', async () => {
    render(<NewPage />);

    expect(lastCreateSpaceProps).toBeUndefined();
    fireEvent.click(screen.getByTestId('new-page-button'));
    expect(lastCreateSpaceProps).toBeUndefined();
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
    await screen.findByTestId('create-space-draft-panel');

    expect(screen.getByTestId('create-space-draft-panel')).toBeTruthy();
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(lastCreateSpaceProps?.initialPage).toEqual({ layout: ViewLayout.Document });
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-space-draft-close'));
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();
  });

  it('hydrates the exact created child before opening it when creation wins the outline race', async () => {
    const hydration = deferred<string[]>();

    mockEnsureViewVisibleInOutline.mockReturnValue(hydration.promise);
    render(<NewPage />);

    await openCreateSpaceFlow();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-space-draft-complete'));

    expect(mockEnsureViewVisibleInOutline).toHaveBeenCalledWith('page-created');
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    await act(async () => {
      hydration.resolve(['space-created']);
      await hydration.promise;
    });

    await waitFor(() => expect(mockOpenPageModal).toHaveBeenCalledTimes(1));
    expect(mockOpenPageModal).toHaveBeenCalledTimes(1);
    expect(mockOpenPageModal).toHaveBeenCalledWith('page-created');
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();
  });

  it('does not let an older hydration open after a newer create-space flow', async () => {
    const firstHydration = deferred<string[]>();
    const secondHydration = deferred<string[]>();

    mockEnsureViewVisibleInOutline.mockImplementation((viewId: string) => {
      return viewId === 'page-first' ? firstHydration.promise : secondHydration.promise;
    });
    render(<NewPage />);

    mockCreatedSpaceId = 'space-first';
    mockCreatedPageId = 'page-first';
    await openCreateSpaceFlow();
    fireEvent.click(screen.getByTestId('create-space-draft-complete'));
    expect(mockEnsureViewVisibleInOutline).toHaveBeenCalledWith('page-first');

    mockCreatedSpaceId = 'space-second';
    mockCreatedPageId = 'page-second';
    await openCreateSpaceFlow();
    fireEvent.click(screen.getByTestId('create-space-draft-complete'));
    expect(mockEnsureViewVisibleInOutline).toHaveBeenCalledWith('page-second');

    await act(async () => {
      secondHydration.resolve(['space-second']);
      await secondHydration.promise;
    });
    await waitFor(() => expect(mockOpenPageModal).toHaveBeenCalledWith('page-second'));

    await act(async () => {
      firstHydration.resolve(['space-first']);
      await firstHydration.promise;
    });
    expect(mockOpenPageModal).toHaveBeenCalledTimes(1);
    expect(mockOpenPageModal).not.toHaveBeenCalledWith('page-first');
  });

  it('discards a draft without opening a page', async () => {
    render(<NewPage />);

    await openCreateSpaceFlow();
    fireEvent.click(screen.getByTestId('create-space-draft-close'));

    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  });

  it('adds a page to an existing space without opening the create controller', async () => {
    mockAddPage.mockResolvedValue({ view_id: 'existing-space-page' });
    mockOutline = [space('space-existing', 'Existing')];
    render(<NewPage />);

    fireEvent.click(screen.getByTestId('new-page-button'));
    await selectSpace('Existing');
    await waitFor(() => expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));

    await act(async () => undefined);
    expect(mockAddPage).toHaveBeenCalledWith('space-existing', {
      layout: ViewLayout.Document,
      prev_view_id: undefined,
    });
    expect(mockOpenPageModal).toHaveBeenCalledWith('existing-space-page');
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  });

  async function addToExisting() {
    mockOutline = [space('space-existing', 'Existing')];
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));
    await selectSpace('Existing');
    await waitFor(() => expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledTimes(1));
  }

  it('says in plain words when the server refuses to add the page to that space', async () => {
    // For example access changed after the destination was checked. Server errors arrive as plain
    // { code, message } objects, never as Error instances.
    mockAddPage.mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view', httpStatus: 403 });
    await addToExisting();

    expect(mockNotifyError).toHaveBeenCalledWith('spaceCreation.pageDestination.addDenied');
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    // The dialog stays open so another space can be chosen.
    expect(screen.getByTestId('new-page-modal')).toBeTruthy();
  });

  it('says the same when an atomic page creation is refused', async () => {
    // Atomic creation keeps the server's answer as the cause of its pending command.
    const denial = { code: 1012, message: 'user is not allowed to access this view', httpStatus: 403 };

    mockAddPage.mockRejectedValue(new AtomicCreationPendingError({ id: 'journal', requestId: 'request' } as never, denial));
    await addToExisting();

    expect(mockNotifyError).toHaveBeenCalledWith('spaceCreation.pageDestination.addDenied');
  });

  it('shows the reviewed pending guidance when an atomic page creation could not be confirmed', async () => {
    const pending = new AtomicCreationPendingError({ id: 'journal', requestId: 'request' } as never, new Error('lost'));

    mockAddPage.mockRejectedValue(pending);
    await addToExisting();

    expect(mockNotifyError).toHaveBeenCalledWith(pending.message);
  });

  it('reports any other failure in plain words instead of the raw error', async () => {
    mockAddPage.mockRejectedValue({ code: -1, message: 'Network error' });
    await addToExisting();

    expect(mockNotifyError).toHaveBeenCalledWith('spaceCreation.pageDestination.addFailed');
  });

  it('blocks the create-draft link while adding an existing page', async () => {
    const addition = deferred<{ view_id: string }>();

    mockAddPage.mockReturnValue(addition.promise);
    mockOutline = [space('space-existing', 'Existing')];
    render(<NewPage />);

    fireEvent.click(screen.getByTestId('new-page-button'));
    await selectSpace('Existing');
    await waitFor(() => expect((screen.getByTestId('new-page-modal-ok')).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));
    const createButton = screen.getByTestId('new-page-create-space-button');

    expect(createButton.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(createButton);
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();

    await act(async () => {
      addition.resolve({ view_id: 'existing-space-page' });
      await addition.promise;
    });
  });

  it('keeps Create a new space available on a server without the capability route', async () => {
    mockCanCreateSpace = false;
    mockCapabilityStatus = 'unsupported';
    render(<NewPage />);
    fireEvent.click(screen.getByTestId('new-page-button'));

    expect((screen.getByTestId('new-page-create-space-button')).disabled).toBe(false);
    expect(screen.queryByTestId('new-page-create-space-reason')).toBeNull();
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
    await screen.findByTestId('create-space-draft-panel');
  });
});
