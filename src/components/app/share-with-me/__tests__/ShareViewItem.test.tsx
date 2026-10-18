import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AccessService } from '@/application/services/domains';
import { AccessLevel, Role, Types, View, ViewIconType, ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { ShareViewItem } from '@/components/app/share-with-me/ShareViewItem';

import type { ReactNode } from 'react';

const mockUseViewActionPermissions = jest.fn();
const mockAddPage = jest.fn();
const mockUpdatePage = jest.fn();
const mockUploadFile = jest.fn();
const mockOpenPageModal = jest.fn();
const mockOpenRenameModal = jest.fn();
const mockOpenDeleteModal = jest.fn();
const mockNavigate = jest.fn();
// The permissions hook refreshes on permission notifications from the app event emitter.
const mockEventEmitter = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
let mockRole = Role.Member;
// An account without a workspace has no selected workspace (and no role) yet.
let mockHasSelectedWorkspace = true;
let mockViewId = 'root-page';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), loading: jest.fn(() => 'loading'), dismiss: jest.fn() },
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: { revokeAccess: jest.fn(), getObjectPermission: jest.fn() },
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'member@example.com' }) }));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ openRenameModal: mockOpenRenameModal, openDeleteModal: mockOpenDeleteModal }),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ addPage: mockAddPage, updatePage: mockUpdatePage, uploadFile: mockUploadFile }),
  useAppViewId: () => mockViewId,
  useCurrentWorkspaceId: () => 'workspace',
  useEventEmitter: () => mockEventEmitter,
  useUserWorkspaceInfo: () => ({ selectedWorkspace: mockHasSelectedWorkspace ? { role: mockRole } : undefined }),
  useAIEnabled: () => false,
  useOpenPageModal: () => mockOpenPageModal,
  useToView: () => mockNavigate,
}));
jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({
  useDatabaseViewCreation: () => ({ getAction: () => ({ type: 'create' }), checkCreation: () => true }),
}));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: (...args: unknown[]) => mockUseViewActionPermissions(...args),
}));
jest.mock('@/components/app/view-actions/useSpaceActionPermissions', () => ({
  useSpaceActionPermissions: () => ({
    canOpenManageSpace: false,
    hasLoadedSpaceActionPermissions: true,
    isLoadingSpaceActionPermissions: false,
  }),
}));
// Duplicate is a More menu action (mocked out below); shared rows only exercise Add here, so the
// destination check for a duplicate stays out of the permission calls this suite inspects.
jest.mock('@/components/app/view-actions/usePageDestinationAccess', () => ({
  ...jest.requireActual('@/components/app/view-actions/usePageDestinationAccess'),
  useDuplicateDestinationAccess: () => ({ state: 'none' }),
}));
jest.mock('@/components/app/view-actions/MorePageActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/view-actions/MoreSpaceActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/_shared/cutsom-icon', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { createPortal } = jest.requireActual<typeof import('react-dom')>('react-dom');

  return {
    CustomIconPopover: ({
      children,
      onSelectIcon,
      removeIcon,
      onUploadFile,
    }: {
      children: ReactNode;
      onSelectIcon: (icon: { ty: ViewIconType; value: string; color?: string }) => void;
      removeIcon: () => void;
      onUploadFile: (file: File) => Promise<string>;
    }) => {
      const [open, setOpen] = React.useState(false);

      return (
        <>
          <div onClick={() => setOpen(true)}>{children}</div>
          {open &&
            createPortal(
              <div role='dialog' aria-label='Icon picker'>
                <button onClick={() => onSelectIcon({ ty: 0, value: '🌱' })}>Select emoji</button>
                <button onClick={() => onSelectIcon({ ty: 2, value: 'nature/leaf', color: 'green' })}>
                  Select icon
                </button>
                <button onClick={removeIcon}>Remove icon</button>
                <input
                  aria-label='Upload icon'
                  type='file'
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) void onUploadFile(file);
                  }}
                />
              </div>,
              document.body
            )}
        </>
      );
    },
  };
});
jest.mock('@/components/_shared/view-icon', () => ({ ViewIcon: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span>Loading</span> }));

// Simplify dropdown focus mechanics while preserving portal click bubbling.
// ViewActionsPopover, AddPageActions, and RemoveAccessConfirmDialog stay real.
jest.mock('@/components/ui/dropdown-menu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { createPortal } = jest.requireActual<typeof import('react-dom')>('react-dom');
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => undefined });

  return {
    DropdownMenu: ({
      children,
      open = false,
      onOpenChange = () => undefined,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({
      children,
    }: {
      children: React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>;
    }) => {
      const menu = React.useContext(Context);

      return React.cloneElement(children, {
        onClick: (event: React.MouseEvent) => {
          children.props.onClick?.(event);
          menu.onOpenChange(!menu.open);
        },
      });
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => {
      const menu = React.useContext(Context);

      return menu.open ? createPortal(<div role='menu'>{children}</div>, document.body) : null;
    },
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
      ...props
    }: {
      children: ReactNode;
      disabled?: boolean;
      onSelect?: (event: { preventDefault: () => void }) => void;
      'data-testid'?: string;
    }) => (
      <button
        type='button'
        disabled={disabled}
        data-testid={props['data-testid']}
        onClick={() => onSelect?.({ preventDefault: () => undefined })}
      >
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

jest.mock('@/components/_shared/DatabaseViewCreationItem', () => ({
  DatabaseViewCreationItem: ({
    children,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    onSelect?: () => void;
    'data-testid'?: string;
  }) => (
    <button type='button' data-testid={props['data-testid']} onClick={onSelect}>
      {children}
    </button>
  ),
}));

jest.mock('@/components/app/outline/ViewItem', () => {
  function Row({
    view,
    renderExtra,
    onClickView,
  }: {
    view: View;
    renderExtra: (props: { hovered: boolean; view: View }) => ReactNode;
    onClickView: (viewId: string) => void;
  }) {
    const [hovered, setHovered] = useState(false);

    return (
      <div
        data-testid={`row-${view.view_id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onClickView(view.view_id)}
      >
        {view.name}
        {renderExtra({ hovered, view })}
      </div>
    );
  }

  return {
    __esModule: true,
    default: ({
      view,
      renderExtra,
      onClickView,
    }: {
      view: View;
      renderExtra: (props: { hovered: boolean; view: View }) => ReactNode;
      onClickView: (viewId: string) => void;
    }) => (
      <>
        {[view, ...view.children].map((row) => (
          <Row key={row.view_id} view={row} renderExtra={renderExtra} onClickView={onClickView} />
        ))}
      </>
    ),
  };
});

function view(id: string, overrides: Partial<View> = {}): View {
  return {
    view_id: id,
    name: id,
    parent_view_id: 'private-space',
    layout: ViewLayout.Document,
    children: [],
    icon: null,
    extra: null,
    is_published: false,
    is_private: true,
    access_level: AccessLevel.FullAccess,
    ...overrides,
  };
}

function permissions(overrides: Record<string, boolean> = {}) {
  return {
    canWrite: true,
    canCreateViewActions: true,
    canManageViewActions: true,
    hasLoadedViewActionPermissions: true,
    isLoadingViewActionPermissions: false,
    ...overrides,
  };
}

function renderShared(root = view('root-page'), onImportClick = jest.fn()) {
  const toggleExpand = jest.fn();
  const navigateToView = jest.fn();
  const onDataRefresh = jest.fn();
  const result = render(
    <ShareViewItem
      view={root}
      width={240}
      expandIds={[root.view_id]}
      toggleExpand={toggleExpand}
      navigateToView={navigateToView}
      onImportClick={onImportClick}
      onDataRefresh={onDataRefresh}
    />
  );

  return { ...result, toggleExpand, navigateToView, onImportClick, onDataRefresh };
}

function openMoreActions(targetId = 'root-page') {
  const row = screen.getByTestId(`row-${targetId}`);

  fireEvent.mouseEnter(row);
  fireEvent.click(within(row).getByTestId('shared-page-more-actions'));
  return row;
}

function openRemoveDialog(targetId = 'nested-child') {
  const row = openMoreActions(targetId);

  fireEvent.click(screen.getByText('shareAction.removeYourAccess'));
  fireEvent.mouseLeave(row);
  const dialog = screen.getByRole('alertdialog');

  // The actual Radix dialog is outside the row's DOM but inside its React tree.
  expect(row.contains(dialog)).toBe(false);
  return dialog;
}

function configureCanonicalPermissions(accessLevel = AccessLevel.FullAccess) {
  mockUseViewActionPermissions.mockImplementation(
    jest.requireActual<typeof import('@/components/app/view-actions/useViewActionPermissions')>(
      '@/components/app/view-actions/useViewActionPermissions'
    ).useViewActionPermissions
  );
  jest.mocked(AccessService.getObjectPermission).mockImplementation(async (_workspaceId, objectId, collabType) => ({
    object_id: objectId,
    collab_type: collabType,
    governing_view_id: objectId,
    access_level: accessLevel,
    can_read: true,
    can_write: accessLevel >= AccessLevel.ReadAndWrite,
    can_comment: accessLevel >= AccessLevel.ReadAndComment,
    can_share: accessLevel === AccessLevel.FullAccess,
  }));
}

describe('shared page sidebar actions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRole = Role.Member;
    mockHasSelectedWorkspace = true;
    mockViewId = 'root-page';
    mockAddPage.mockResolvedValue({ view_id: 'created-child' });
    mockUpdatePage.mockResolvedValue(undefined);
    mockUploadFile.mockResolvedValue('https://example.test/icon.png');
    jest.mocked(AccessService.revokeAccess).mockResolvedValue(undefined);
    mockUseViewActionPermissions.mockReturnValue(permissions());
  });

  it('lets a FullAccess member create under the shared document and opens the new child', async () => {
    const { toggleExpand, navigateToView } = renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('inline-add-page'));
    expect(toggleExpand).toHaveBeenCalledWith('root-page', true);
    expect(navigateToView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('add-document-button'));

    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('root-page', expect.objectContaining({ layout: ViewLayout.Document }))
    );
    await waitFor(() => expect(mockOpenPageModal).toHaveBeenCalledWith('created-child'));
  });

  it('creates a grandchild under the clicked descendant, not the top shared page', async () => {
    const child = view('nested-child', { parent_view_id: 'root-page' });
    const { toggleExpand } = renderShared(view('root-page', { children: [child] }));
    const row = screen.getByTestId('row-nested-child');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('inline-add-page'));
    fireEvent.click(screen.getByTestId('add-document-button'));

    expect(toggleExpand).toHaveBeenCalledWith('nested-child', true);
    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('nested-child', expect.objectContaining({ layout: ViewLayout.Document }))
    );
    expect(mockAddPage.mock.calls.some(([id]) => id === 'root-page')).toBe(false);
  });

  it.each([AccessLevel.FullAccess, AccessLevel.ReadAndWrite])(
    'reuses the hovered descendant permission when opening Add with access %s',
    async (accessLevel) => {
      configureCanonicalPermissions(accessLevel);
      renderShared(
        view('root-page', {
          children: [view('nested-child', { parent_view_id: 'root-page', access_level: undefined })],
        })
      );
      const row = screen.getByTestId('row-nested-child');

      expect(AccessService.getObjectPermission).not.toHaveBeenCalled();
      fireEvent.mouseEnter(row);
      const addButton = await within(row).findByTestId('inline-add-page');

      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1);
      fireEvent.click(addButton);

      expect(screen.queryByTestId('add-page-permission-loading')).toBeNull();
      fireEvent.click(screen.getByTestId('add-document-button'));
      await waitFor(() => expect(mockOpenPageModal).toHaveBeenCalledWith('created-child'));

      expect(mockAddPage).toHaveBeenCalledWith('nested-child', expect.objectContaining({ layout: ViewLayout.Document }));
      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1);
      expect(AccessService.getObjectPermission).toHaveBeenCalledWith('workspace', 'nested-child', Types.Document);
    }
  );

  it('revalidates on the next hover and removes Add when write access has been revoked', async () => {
    configureCanonicalPermissions();
    renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    const addButton = await within(row).findByTestId('inline-add-page');

    fireEvent.click(addButton);
    expect(screen.getByTestId('add-document-button')).toBeTruthy();
    fireEvent.click(addButton);
    fireEvent.mouseLeave(row);
    configureCanonicalPermissions(AccessLevel.ReadOnly);
    fireEvent.mouseEnter(row);

    await waitFor(() =>
      expect(mockUseViewActionPermissions.mock.results.at(-1)?.value).toMatchObject({
        canWrite: false,
        hasLoadedViewActionPermissions: true,
        isLoadingViewActionPermissions: false,
      })
    );
    expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('inline-add-page')).toBeNull();
    expect(screen.queryByTestId('add-document-button')).toBeNull();
  });

  it.each([
    ['read-only', { canCreateViewActions: false }],
    ['no permission', { canCreateViewActions: false, canManageViewActions: false }],
    ['unresolved', { hasLoadedViewActionPermissions: false }],
    ['loading', { isLoadingViewActionPermissions: true }],
  ])('hides Add while canonical permission is %s even when sidebar metadata says FullAccess', (_name, result) => {
    mockUseViewActionPermissions.mockReturnValue(permissions(result));
    renderShared();
    fireEvent.mouseEnter(screen.getByTestId('row-root-page'));

    expect(screen.queryByTestId('inline-add-page')).toBeNull();
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it('keeps guest creation hidden and does not start a creation-permission probe', () => {
    mockRole = Role.Guest;
    renderShared();
    fireEvent.mouseEnter(screen.getByTestId('row-root-page'));

    expect(screen.queryByTestId('inline-add-page')).toBeNull();
    expect(mockUseViewActionPermissions.mock.calls.every(([, opened]) => opened === false)).toBe(true);
  });

  it('does not probe the whole tree on mount and keeps the active menu open after hover leaves', () => {
    renderShared(view('root-page', { children: [view('nested-child')] }));
    expect(mockUseViewActionPermissions.mock.calls.every(([, opened]) => opened === false)).toBe(true);

    mockUseViewActionPermissions.mockClear();
    const childRow = screen.getByTestId('row-nested-child');

    fireEvent.mouseEnter(childRow);
    expect(
      mockUseViewActionPermissions.mock.calls.some(([target, opened]) => target.view_id === 'nested-child' && opened)
    ).toBe(true);
    expect(
      mockUseViewActionPermissions.mock.calls.some(([target, opened]) => target.view_id === 'root-page' && opened)
    ).toBe(false);
    fireEvent.click(within(childRow).getByTestId('inline-add-page'));
    fireEvent.mouseLeave(childRow);
    expect(screen.getByTestId('add-document-button')).toBeTruthy();
  });

  it('keeps a readonly descendant locked even when its shared root is writable', () => {
    mockUseViewActionPermissions.mockImplementation((target: View) =>
      permissions({ canCreateViewActions: target.view_id === 'root-page' })
    );
    renderShared(view('root-page', { children: [view('nested-child', { access_level: AccessLevel.ReadOnly })] }));
    fireEvent.mouseEnter(screen.getByTestId('row-root-page'));
    fireEvent.mouseEnter(screen.getByTestId('row-nested-child'));

    expect(within(screen.getByTestId('row-root-page')).getByTestId('inline-add-page')).toBeTruthy();
    expect(within(screen.getByTestId('row-nested-child')).queryByTestId('inline-add-page')).toBeNull();
  });

  it('routes descendant rename and Import actions to the same descendant', () => {
    const child = view('nested-child', { parent_view_id: 'root-page' });
    const { onImportClick } = renderShared(view('root-page', { children: [child] }));
    const row = screen.getByTestId('row-nested-child');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));
    fireEvent.click(screen.getByText('button.rename'));
    expect(mockOpenRenameModal).toHaveBeenCalledWith('nested-child');
    fireEvent.click(within(row).getByTestId('inline-add-page'));
    fireEvent.click(screen.getByTestId('add-import-button'));
    expect(onImportClick).toHaveBeenCalledWith(child);
  });

  it.each([
    ['shared root', 'root-page', Role.Member],
    ['shared descendant', 'nested-child', Role.Member],
    ['shared descendant as workspace owner', 'nested-child', Role.Owner],
  ])('opens the trash confirmation for the clicked %s', (_name, targetId, role) => {
    mockRole = role as Role;
    // A descendant's management permission must be checked independently of
    // its shared root; stale sidebar access_level metadata is not authority.
    mockUseViewActionPermissions.mockImplementation((target: View) =>
      permissions({
        canManageViewActions: target.view_id === targetId,
      })
    );
    const { navigateToView } = renderShared(view('root-page', { children: [view('nested-child')] }));
    const row = screen.getByTestId(`row-${targetId}`);

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));
    fireEvent.mouseLeave(row);
    fireEvent.click(screen.getByTestId('shared-move-to-trash'));

    expect(mockOpenDeleteModal).toHaveBeenCalledTimes(1);
    expect(mockOpenDeleteModal).toHaveBeenCalledWith(targetId);
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it.each([
    ['read-only', { canCreateViewActions: false, canManageViewActions: false }],
    ['edit without FullAccess', { canCreateViewActions: true, canManageViewActions: false }],
    ['unresolved', { hasLoadedViewActionPermissions: false }],
    ['loading', { isLoadingViewActionPermissions: true }],
  ])('hides trash while canonical permission is %s despite FullAccess sidebar metadata', (_name, result) => {
    mockUseViewActionPermissions.mockReturnValue(permissions(result));
    renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));

    expect(screen.queryByTestId('shared-move-to-trash')).toBeNull();
    expect(mockOpenDeleteModal).not.toHaveBeenCalled();
  });

  it('offers neither Add nor Move to trash to an account without a selected workspace', () => {
    mockHasSelectedWorkspace = false;
    renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    expect(within(row).queryByTestId('inline-add-page')).toBeNull();
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));

    expect(screen.queryByTestId('shared-move-to-trash')).toBeNull();
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockOpenDeleteModal).not.toHaveBeenCalled();
  });

  it('keeps trash hidden for guests even with canonical FullAccess', () => {
    mockRole = Role.Guest;
    renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));

    expect(screen.queryByTestId('shared-move-to-trash')).toBeNull();
    expect(mockOpenDeleteModal).not.toHaveBeenCalled();
  });

  it.each([AccessLevel.FullAccess, AccessLevel.ReadAndWrite])(
    'resolves inherited edit actions for a descendant with canonical access %s',
    async (accessLevel) => {
      configureCanonicalPermissions(accessLevel);
      const child = view('nested-child', { parent_view_id: 'root-page', access_level: undefined });
      const { navigateToView } = renderShared(view('root-page', { children: [child], access_level: accessLevel }));

      expect(AccessService.getObjectPermission).not.toHaveBeenCalled();
      const row = openMoreActions('nested-child');

      await waitFor(() => expect(within(row).getByTestId('inline-add-page')).toBeTruthy());
      expect(AccessService.getObjectPermission).toHaveBeenCalledWith('workspace', 'nested-child', Types.Document);
      expect(jest.mocked(AccessService.getObjectPermission).mock.calls.every(([, id]) => id === 'nested-child')).toBe(
        true
      );
      expect(screen.getByText('disclosureAction.changeIcon')).toBeTruthy();
      expect(Boolean(screen.queryByTestId('shared-move-to-trash'))).toBe(accessLevel === AccessLevel.FullAccess);

      fireEvent.click(screen.getByText('button.rename'));
      expect(mockOpenRenameModal).toHaveBeenCalledWith('nested-child');
      expect(navigateToView).not.toHaveBeenCalled();
    }
  );

  it.each([AccessLevel.ReadOnly, AccessLevel.ReadAndComment])(
    'hides descendant mutations when canonical access is %s despite FullAccess metadata',
    async (accessLevel) => {
      configureCanonicalPermissions(accessLevel);
      renderShared(view('root-page', { children: [view('nested-child')] }));
      const row = openMoreActions('nested-child');

      await waitFor(() =>
        expect(mockUseViewActionPermissions.mock.results.at(-1)?.value).toMatchObject({
          hasLoadedViewActionPermissions: true,
          isLoadingViewActionPermissions: false,
        })
      );
      expect(within(row).queryByTestId('inline-add-page')).toBeNull();
      expect(screen.queryByTestId('shared-move-to-trash')).toBeNull();
      expect(screen.queryByText('button.rename')).toBeNull();
      expect(screen.queryByText('disclosureAction.changeIcon')).toBeNull();
      expect(screen.getByText('shareAction.removeYourAccess')).toBeTruthy();
    }
  );

  it.each([
    ['denied', { canWrite: false }],
    ['unresolved', { hasLoadedViewActionPermissions: false }],
    ['loading', { isLoadingViewActionPermissions: true }],
  ])('hides Rename and Change icon while write permission is %s', (_name, result) => {
    mockUseViewActionPermissions.mockReturnValue(permissions(result));
    renderShared();
    openMoreActions();

    expect(screen.queryByText('button.rename')).toBeNull();
    expect(screen.queryByText('disclosureAction.changeIcon')).toBeNull();
    expect(mockOpenRenameModal).not.toHaveBeenCalled();
    expect(mockUpdatePage).not.toHaveBeenCalled();
  });

  it('resolves guest editing when the menu opens while keeping creation and trash unavailable', async () => {
    mockRole = Role.Guest;
    configureCanonicalPermissions(AccessLevel.ReadAndWrite);
    renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    expect(AccessService.getObjectPermission).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByTestId('shared-page-more-actions'));

    await waitFor(() =>
      expect(AccessService.getObjectPermission).toHaveBeenCalledWith('workspace', 'root-page', Types.Document)
    );
    expect(await screen.findByText('button.rename')).toBeTruthy();
    expect(screen.getByText('disclosureAction.changeIcon')).toBeTruthy();
    expect(within(row).queryByTestId('inline-add-page')).toBeNull();
    expect(screen.queryByTestId('shared-move-to-trash')).toBeNull();
  });

  it.each([
    ['space', { extra: { is_space: true } }],
    ['database container', { extra: { is_space: false, is_database_container: true } }],
    ['grid', { layout: ViewLayout.Grid }],
    ['board', { layout: ViewLayout.Board }],
    ['calendar', { layout: ViewLayout.Calendar }],
  ] as const)('does not offer document children under a %s', (_name, overrides) => {
    renderShared(view('root-page', overrides));
    fireEvent.mouseEnter(screen.getByTestId('row-root-page'));

    expect(screen.queryByTestId('inline-add-page')).toBeNull();
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it('reports a rejected child creation without opening or navigating to a new page', async () => {
    mockAddPage.mockRejectedValueOnce(new Error('Write access was revoked'));
    const { navigateToView } = renderShared();
    const row = screen.getByTestId('row-root-page');

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByTestId('inline-add-page'));
    fireEvent.click(screen.getByTestId('add-document-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create page'));
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    expect(navigateToView).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each([
    ['Select emoji', { ty: ViewIconType.Emoji, value: '🌱' }],
    [
      'Select icon',
      { ty: ViewIconType.Icon, value: JSON.stringify({ color: 'green', groupName: 'nature', iconName: 'leaf' }) },
    ],
    ['Remove icon', { ty: ViewIconType.Emoji, value: '' }],
  ])('targets the descendant when choosing %s from its icon picker', async (action, icon) => {
    const child = view('nested-child', { parent_view_id: 'root-page', access_level: undefined });
    const { navigateToView } = renderShared(view('root-page', { children: [child] }));

    openMoreActions('nested-child');
    fireEvent.click(screen.getByText('disclosureAction.changeIcon'));
    fireEvent.click(screen.getByRole('button', { name: action as string }));

    await waitFor(() =>
      expect(mockUpdatePage).toHaveBeenCalledWith('nested-child', {
        icon,
        name: child.name,
        extra: {},
      })
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(mockUpdatePage).toHaveBeenCalledTimes(1);
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it('uploads an icon to the descendant selected in the shared tree', async () => {
    renderShared(view('root-page', { children: [view('nested-child', { access_level: undefined })] }));
    openMoreActions('nested-child');
    fireEvent.click(screen.getByText('disclosureAction.changeIcon'));
    const file = new File(['icon'], 'icon.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Upload icon'), { target: { files: [file] } });

    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledWith('nested-child', file));
  });

  it.each(['cancel', 'close', 'escape'])('dismisses removal via %s without navigating or revoking access', (action) => {
    const { navigateToView, onDataRefresh } = renderShared(view('root-page', { children: [view('nested-child')] }));
    const dialog = openRemoveDialog();

    if (action === 'escape') {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    } else {
      fireEvent.click(within(dialog).getByRole('button', { name: action === 'cancel' ? 'button.cancel' : '' }));
    }

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(navigateToView).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(AccessService.revokeAccess).not.toHaveBeenCalled();
    expect(onDataRefresh).not.toHaveBeenCalled();

    // Normal row navigation must still work after the dialog is dismissed.
    fireEvent.click(screen.getByTestId('row-nested-child'));
    expect(navigateToView).toHaveBeenCalledWith('nested-child');
  });

  it('isolates removal dialog content and overlay clicks from row navigation', () => {
    const { navigateToView } = renderShared(view('root-page', { children: [view('nested-child')] }));
    const dialog = openRemoveDialog();

    fireEvent.click(within(dialog).getByRole('heading'));
    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');

    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(navigateToView).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(AccessService.revokeAccess).not.toHaveBeenCalled();
  });

  it.each(['root-page', 'nested-child'])(
    'revokes only the selected descendant and navigates after success only if it is the current page (%s)',
    async (currentViewId) => {
      mockViewId = currentViewId;
      let finishRemoval!: () => void;

      jest.mocked(AccessService.revokeAccess).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRemoval = resolve;
          })
      );
      const { navigateToView, onDataRefresh } = renderShared(view('root-page', { children: [view('nested-child')] }));
      const dialog = openRemoveDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: 'button.remove' }));

      expect(AccessService.revokeAccess).toHaveBeenCalledTimes(1);
      expect(AccessService.revokeAccess).toHaveBeenCalledWith('workspace', 'nested-child', ['member@example.com']);
      expect(navigateToView).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(onDataRefresh).not.toHaveBeenCalled();

      await act(async () => finishRemoval());

      expect(onDataRefresh).toHaveBeenCalledTimes(1);
      expect(notify.success).toHaveBeenCalledWith('shareAction.removeAccessSuccess');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(navigateToView).not.toHaveBeenCalled();
      if (currentViewId === 'nested-child') {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/app');
      } else {
        expect(mockNavigate).not.toHaveBeenCalled();
      }
    }
  );

  it('reports a rejected removal without refreshing or navigating away', async () => {
    jest.mocked(AccessService.revokeAccess).mockRejectedValueOnce(new Error('Removal failed'));
    const { navigateToView, onDataRefresh } = renderShared(view('root-page', { children: [view('nested-child')] }));
    const dialog = openRemoveDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'button.remove' }));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Removal failed'));
    expect(navigateToView).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onDataRefresh).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });
});
