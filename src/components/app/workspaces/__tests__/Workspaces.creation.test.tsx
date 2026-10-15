import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { Workspaces } from '../Workspaces';

const mockCreate = jest.fn();
const mockChange = jest.fn();
const mockRefreshWorkspaces = jest.fn();
const mockToastError = jest.fn();
const mockNotifyError = jest.fn();
const mockCreation = {
  canCreate: true,
  status: 'ready',
  checking: false,
  scopeKey: 'server:user',
  isCurrent: () => true,
  refresh: jest.fn(),
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: (...args: unknown[]) => mockNotifyError(...args) } }));
jest.mock('@/application/session/token', () => ({
  ...jest.requireActual('@/application/session/token'),
  getTokenParsed: () => ({ user: { id: 'user' } }),
}));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: { create: (...args: unknown[]) => mockCreate(...args) } }));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({ useWorkspaceCreationCapability: () => mockCreation }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ uid: 'user', name: 'User', email: 'user@example.com' }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'existing',
  useUserWorkspaceInfo: () => ({ workspaces: [] }),
  useIsOfficialHosted: () => false,
  useRefreshUserWorkspaceInfo: () => mockRefreshWorkspaces,
  useAppOperations: () => ({ onChangeWorkspace: mockChange }),
}));
jest.mock('@/components/ui/dropdown-menu', () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;

  return {
    DropdownMenu: Container, DropdownMenuContent: Container, DropdownMenuGroup: Container,
    DropdownMenuLabel: Container, DropdownMenuSeparator: () => null, DropdownMenuSub: Container,
    DropdownMenuSubContent: Container, DropdownMenuTrigger: Container,
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
      ...props
    }: {
      children: ReactNode;
      disabled?: boolean;
      onSelect?: (event: Event) => void;
    }) => (
      <button role='menuitem' disabled={disabled} onClick={(event) => onSelect?.(event.nativeEvent)} {...props}>
        {children}
      </button>
    ),
    DropdownMenuSubTrigger: ({ children, ...props }: { children: ReactNode }) => (
      <button role='menuitem' {...props}>
        {children}
      </button>
    ),
    dropdownMenuItemVariants: () => '',
  };
});
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/_shared/more-actions/importer/Import', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/CurrentWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/WorkspaceList', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange('existing')}>Open existing</button>,
}));
jest.mock('@/components/app/workspaces/DeleteWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/workspaces/LeaveWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/app/settings', () => ({ SettingsDialog: () => null }));
jest.mock('@/components/billing/UpgradePlan', () => ({ __esModule: true, default: () => null }));

const draftKey = 'workspace-creation:v1:' + JSON.stringify(['https://test.appflowy.cloud', 'user']);

function mount() {
  return render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Workspaces /></MemoryRouter>);
}

function describedBy(element: HTMLElement) {
  const id = element.getAttribute('aria-describedby');

  return id ? document.getElementById(id)?.textContent : undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockCreate.mockImplementation(async (_payload: unknown, options?: { reserve?: () => string }) => {
    options?.reserve?.();
    return 'new-workspace';
  });
  mockChange.mockResolvedValue(undefined);
  mockCreation.canCreate = true;
  mockCreation.status = 'ready';
});

test('denied entries stay keyboard reachable with their reason, and opening an existing workspace still works', async () => {
  mockCreation.canCreate = false;
  mount();
  const create = screen.getByRole('menuitem', { name: 'workspace.create' });
  const importEntry = screen.getByRole('menuitem', { name: 'workspaceCreation.importWorkspace' });

  for (const entry of [create, importEntry]) {
    // A disabled Radix item is skipped by arrow keys, so these stay focusable and say why.
    expect(entry.hasAttribute('disabled')).toBe(false);
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(entry)).toBe('workspaceCreation.denied');
  }

  fireEvent.click(create);
  expect(screen.queryByRole('textbox')).toBeNull();
  // A denial is a decision: no retry control and no non-item text inside the menu.
  expect(screen.queryByRole('menuitem', { name: 'workspaceCreation.checkAgain' })).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open existing' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('existing'));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('an unreadable answer offers Check again as a real menu item', () => {
  mockCreation.canCreate = false;
  mockCreation.status = 'error';
  mount();
  expect(describedBy(screen.getByRole('menuitem', { name: 'workspace.create' }))).toBe('workspaceCreation.unavailable');
  fireEvent.click(screen.getByRole('menuitem', { name: 'workspaceCreation.checkAgain' }));
  expect(mockCreation.refresh).toHaveBeenCalledTimes(1);
});

test('a created workspace that fails to open is opened on the next try instead of created again', async () => {
  mockChange.mockRejectedValueOnce(new Error('Navigation failed'));
  mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'workspace.create' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retained draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() => expect(mockCreation.refresh).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'workspaceCreation.openWorkspace' }).hasAttribute('disabled')).toBe(false));
  expect(screen.getByText('workspaceCreation.createdNotOpened')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.openWorkspace' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(2));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockChange.mock.calls).toEqual([['new-workspace'], ['new-workspace']]);
});

test('a definitive rejection releases the request and leaves the typed name editable', async () => {
  mockCreate.mockImplementationOnce((_payload: unknown, options?: { reserve?: () => string }) => {
    options?.reserve?.();
    return Promise.reject({ code: 1008, message: 'Workspace name is too long' });
  });
  mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'workspace.create' }));
  const input = screen.getByRole('textbox');

  fireEvent.change(input, { target: { value: 'A'.repeat(120) } });
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Workspace name is too long'));
  expect(sessionStorage.getItem(draftKey)).toBeNull();
  expect(input.readOnly).toBe(false);
  fireEvent.change(input, { target: { value: 'Shorter' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'button.create' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('new-workspace'));
  expect(mockCreate.mock.calls[1][0]).toEqual({ workspace_name: 'Shorter' });
});

test('an unconfirmed request can be checked again or discarded, even after access is revoked', async () => {
  mockCreation.canCreate = false;
  sessionStorage.setItem(draftKey, JSON.stringify({ requestId: 'request-1', name: 'Pending name' }));
  mockCreate.mockRejectedValueOnce({ code: -1, message: 'Network Error' });
  mount();
  const create = screen.getByRole('menuitem', { name: 'workspace.create' });

  expect(create.getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(create);
  expect(screen.getByText('workspaceCreation.notConfirmed')).toBeTruthy();
  expect((screen.getByRole('textbox')).readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('workspaceCreation.notConfirmed'));
  expect(mockCreate).toHaveBeenCalledWith({ workspace_name: 'Pending name' }, { replay: 'request-1' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'workspaceCreation.discard' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.discard' }));
  expect(sessionStorage.getItem(draftKey)).toBeNull();
  expect(screen.queryByText('workspaceCreation.notConfirmed')).toBeNull();
  expect(mockRefreshWorkspaces).toHaveBeenCalledTimes(1);
  // Back to the ordinary dialog, which now explains the current denial.
  expect(within(screen.getByRole('dialog')).getByText('workspaceCreation.denied')).toBeTruthy();
});

test('an unreadable saved request is explained in the dialog and cleared by Discard', async () => {
  sessionStorage.setItem(draftKey, 'null');
  mount();
  fireEvent.click(screen.getByRole('menuitem', { name: 'workspace.create' }));
  expect(screen.getByRole('alert').textContent).toContain('workspaceCreation.invalidDraft');
  expect(screen.getByRole('button', { name: 'button.create' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.discard' }));
  expect(sessionStorage.getItem(draftKey)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'button.create' }).hasAttribute('disabled')).toBe(false));
});

test('a failed switch to another workspace is reported in the reader\'s language', async () => {
  mockChange.mockRejectedValueOnce(new Error('Network Error'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open existing' }));
  await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('workspace.openFailed'));
});
