import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { AccessLevel, Role, View, ViewLayout } from '@/application/types';
import { ShareViewItem } from '@/components/app/share-with-me/ShareViewItem';

import type { ReactNode } from 'react';

const mockUseViewActionPermissions = jest.fn();
const mockAddPage = jest.fn();
const mockOpenPageModal = jest.fn();
const mockOpenRenameModal = jest.fn();
const mockNavigate = jest.fn();
let mockRole = Role.Member;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), loading: jest.fn(() => 'loading'), dismiss: jest.fn() },
}));

jest.mock('@/application/services/domains', () => ({ AccessService: { revokeAccess: jest.fn() } }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'member@example.com' }) }));
jest.mock('@/components/app/app-overlay/AppOverlayContext', () => ({
  useAppOverlayContext: () => ({ openRenameModal: mockOpenRenameModal }),
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ addPage: mockAddPage, updatePage: jest.fn(), uploadFile: jest.fn() }),
  useAppViewId: () => 'root-page',
  useCurrentWorkspaceId: () => 'workspace',
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { role: mockRole } }),
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
jest.mock('@/components/app/view-actions/MorePageActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/view-actions/MoreSpaceActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/_shared/view-icon', () => ({ ViewIcon: () => null }));
jest.mock('@/components/app/share/RemoveAccessConfirmDialog', () => ({ RemoveAccessConfirmDialog: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span>Loading</span> }));

// Replace portal/focus mechanics only. The real ViewActionsPopover and
// AddPageActions still resolve their permissions and handle the create click.
jest.mock('@/components/ui/dropdown-menu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => undefined });

  return {
    DropdownMenu: ({ children, open = false, onOpenChange = () => undefined }: {
      children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void;
    }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }> }) => {
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

      return menu.open ? <div role='menu'>{children}</div> : null;
    },
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect, disabled, ...props }: {
      children: ReactNode; disabled?: boolean; onSelect?: (event: { preventDefault: () => void }) => void;
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
  DatabaseViewCreationItem: ({ children, onSelect, ...props }: {
    children: ReactNode; onSelect?: () => void; 'data-testid'?: string;
  }) => <button type='button' data-testid={props['data-testid']} onClick={onSelect}>{children}</button>,
}));

jest.mock('@/components/app/outline/ViewItem', () => {
  function Row({ view, renderExtra, onClickView }: {
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
    default: ({ view, renderExtra, onClickView }: {
      view: View;
      renderExtra: (props: { hovered: boolean; view: View }) => ReactNode;
      onClickView: (viewId: string) => void;
    }) => <>{[view, ...view.children].map((row) => (
      <Row key={row.view_id} view={row} renderExtra={renderExtra} onClickView={onClickView} />
    ))}</>,
  };
});

function view(id: string, overrides: Partial<View> = {}): View {
  return {
    view_id: id, name: id, parent_view_id: 'private-space', layout: ViewLayout.Document,
    children: [], icon: null, extra: null, is_published: false, is_private: true,
    access_level: AccessLevel.FullAccess, ...overrides,
  };
}

function permissions(overrides: Record<string, boolean> = {}) {
  return {
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
  const result = render(
    <ShareViewItem
      view={root}
      width={240}
      expandIds={[root.view_id]}
      toggleExpand={toggleExpand}
      navigateToView={navigateToView}
      onImportClick={onImportClick}
    />
  );

  return { ...result, toggleExpand, navigateToView, onImportClick };
}

describe('shared page sidebar creation actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = Role.Member;
    mockAddPage.mockResolvedValue({ view_id: 'created-child' });
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

    await waitFor(() => expect(mockAddPage).toHaveBeenCalledWith('root-page', expect.objectContaining({ layout: ViewLayout.Document })));
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
    await waitFor(() => expect(mockAddPage).toHaveBeenCalledWith('nested-child', expect.objectContaining({ layout: ViewLayout.Document })));
    expect(mockAddPage.mock.calls.some(([id]) => id === 'root-page')).toBe(false);
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
    expect(mockUseViewActionPermissions.mock.calls.some(([target, opened]) => target.view_id === 'nested-child' && opened)).toBe(true);
    expect(mockUseViewActionPermissions.mock.calls.some(([target, opened]) => target.view_id === 'root-page' && opened)).toBe(false);
    fireEvent.click(within(childRow).getByTestId('inline-add-page'));
    fireEvent.mouseLeave(childRow);
    expect(screen.getByTestId('add-document-button')).toBeTruthy();
  });

  it('keeps a readonly descendant locked even when its shared root is writable', () => {
    mockUseViewActionPermissions.mockImplementation((target: View) => permissions({ canCreateViewActions: target.view_id === 'root-page' }));
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
});
