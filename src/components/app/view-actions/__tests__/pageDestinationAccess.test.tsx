import EventEmitter from 'events';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, Types, type View, ViewLayout } from '@/application/types';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';

import type { ReactNode } from 'react';

const mockGetSpacePermission = jest.fn();
const mockGetObjectPermission = jest.fn();
const mockMovePage = jest.fn();
const mockEventEmitter = new EventEmitter();

function view(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

const page = view('onboarding', { parent_view_id: 'hr' });
const nested = view('nested', { parent_view_id: 'handbook' });
const handbook = view('handbook', { parent_view_id: 'general', children: [nested] });
const hr = view('hr', { extra: { is_space: true }, parent_view_id: 'workspace-1', children: [page] });
const general = view('general', { extra: { is_space: true }, parent_view_id: 'workspace-1', children: [handbook] });
const mockOutline = [hr, general];

function findView(views: View[], id?: string): View | undefined {
  for (const item of views) {
    if (item.view_id === id) return item;
    const child = findView(item.children ?? [], id);

    if (child) return child;
  }
}

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args) },
  AccessService: { getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args) },
  ViewService: { get: jest.fn() },
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useAppView: (id?: string) => findView(mockOutline, id),
  useAppOutline: () => mockOutline,
  useAppOperations: () => ({ movePage: mockMovePage }),
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/ui/progress', () => ({ Progress: () => <span /> }));
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/search-input', () => ({ SearchInput: () => <input /> }));
jest.mock('@/components/ui/separator', () => ({ Separator: () => <hr /> }));
jest.mock('@/components/_shared/outline/OutlineIcon', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/outline/SpaceItem', () => ({
  __esModule: true,
  default: ({ view: item, onClickSpace, onClickView }: {
    view: View; onClickSpace: (id: string) => void; onClickView: (id: string) => void;
  }) => (
    <div>
      <button data-testid={`destination-${item.view_id}`} onClick={() => onClickSpace(item.view_id)}>{item.name}</button>
      {item.children.flatMap((child) => [child, ...child.children]).map((child) => (
        <button key={child.view_id} data-testid={`destination-${child.view_id}`} onClick={() => onClickView(child.view_id)}>
          {child.name}
        </button>
      ))}
    </div>
  ),
}));
jest.mock('@/components/app/view-actions/MorePageActions', () => ({
  __esModule: true,
  default: ({ canDuplicateActions, isLoadingActions }: { canDuplicateActions: boolean; isLoadingActions: boolean }) => (
    <div data-testid='more-page-actions'>
      {isLoadingActions ? 'loading' : canDuplicateActions ? 'duplicate' : 'no-duplicate'}
    </div>
  ),
}));
jest.mock('@/components/app/view-actions/MoreSpaceActions', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/view-actions/AddPageActions', () => ({ __esModule: true, default: () => null }));

function objectPermission(objectId: string, canWrite: boolean) {
  return {
    object_id: objectId, collab_type: Types.Document, governing_view_id: objectId,
    access_level: canWrite ? AccessLevel.ReadAndWrite : AccessLevel.ReadOnly,
    can_read: true, can_write: canWrite, can_comment: true, can_share: false,
  };
}

let writable: Record<string, boolean>;
let sidebarEditors: Record<string, boolean>;

beforeEach(() => {
  jest.clearAllMocks();
  mockEventEmitter.removeAllListeners();
  // Carol edits everything she can see; HR's sidebar is owners only.
  writable = { onboarding: true, hr: true, general: true, handbook: true, nested: true };
  sidebarEditors = { hr: false, general: true };
  mockGetObjectPermission.mockImplementation(async (_workspaceId: string, objectId: string) =>
    objectPermission(objectId, writable[objectId] ?? false));
  mockGetSpacePermission.mockImplementation(async (_workspaceId: string, spaceId: string) => ({
    can_manage_space: false, can_edit_sidebar: sidebarEditors[spaceId] ?? false,
  }));
  mockMovePage.mockResolvedValue(undefined);
});

function openPageMenu(target: View) {
  return render(
    <ViewActionsPopover view={target} popoverType={{ category: 'page', type: 'more' }} open onOpenChange={jest.fn()}>
      <button type='button'>trigger</button>
    </ViewActionsPopover>
  );
}

test('does not offer Duplicate for a page directly under a space whose sidebar is owners only', async () => {
  openPageMenu(page);

  await waitFor(() => expect(screen.getByTestId('more-page-actions').textContent).toBe('no-duplicate'));
  expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', 'hr');
});

test('offers Duplicate once the parent space accepts new pages from this editor', async () => {
  sidebarEditors.hr = true;
  openPageMenu(page);

  await waitFor(() => expect(screen.getByTestId('more-page-actions').textContent).toBe('duplicate'));
});

test('a nested page duplicates under its parent page only with Write on that parent', async () => {
  writable.handbook = false;
  openPageMenu(nested);

  await waitFor(() => expect(screen.getByTestId('more-page-actions').textContent).toBe('no-duplicate'));
  expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-1', 'handbook', Types.Document);
});

test('Move explains and blocks a space root that only its owners can add pages to', async () => {
  render(<MovePagePopover viewId='nested'><button type='button'>move</button></MovePagePopover>);

  const move = screen.getByRole('button', { name: 'disclosureAction.move' });

  expect(move.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByTestId('destination-hr'));
  await waitFor(() =>
    expect(screen.getByTestId('move-page-destination-status').textContent).toBe('spaceCreation.pageDestination.ownersOnly'));
  expect(move.hasAttribute('disabled')).toBe(true);
  fireEvent.click(move);
  expect(mockMovePage).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('destination-general'));
  await waitFor(() => expect(move.hasAttribute('disabled')).toBe(false));
  fireEvent.click(move);
  await waitFor(() => expect(mockMovePage).toHaveBeenCalledWith('nested', 'general'));
});

test('Move blocks a page destination without Write', async () => {
  writable.handbook = false;
  render(<MovePagePopover viewId='onboarding'><button type='button'>move</button></MovePagePopover>);

  fireEvent.click(screen.getByTestId('destination-handbook'));
  await waitFor(() =>
    expect(screen.getByTestId('move-page-destination-status').textContent).toBe('spaceCreation.pageDestination.noEdit'));
  expect(screen.getByRole('button', { name: 'disclosureAction.move' }).hasAttribute('disabled')).toBe(true);
});
