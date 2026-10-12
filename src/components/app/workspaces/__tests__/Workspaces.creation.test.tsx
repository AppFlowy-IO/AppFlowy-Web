import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { Workspaces } from '../Workspaces';

const mockCreate = jest.fn();
const mockChange = jest.fn();
const mockCreation = { canCreate: true, status: 'ready', scopeKey: 'server:user', isCurrent: () => true, refresh: jest.fn() };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: { create: (...args: unknown[]) => mockCreate(...args) } }));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({ useWorkspaceCreationCapability: () => mockCreation }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ uid: 'user', name: 'User' }) }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'existing',
  useUserWorkspaceInfo: () => ({ workspaces: [] }),
  useIsOfficialHosted: () => false,
  useRefreshUserWorkspaceInfo: () => undefined,
  useAppOperations: () => ({ onChangeWorkspace: mockChange }),
}));
jest.mock('@/components/ui/dropdown-menu', () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;

  return {
    DropdownMenu: Container, DropdownMenuContent: Container, DropdownMenuGroup: Container,
    DropdownMenuLabel: Container, DropdownMenuSeparator: () => null, DropdownMenuSub: Container,
    DropdownMenuSubContent: Container, DropdownMenuTrigger: Container,
    DropdownMenuItem: ({ children, disabled, onSelect }: { children: ReactNode; disabled?: boolean; onSelect: () => void }) =>
      <button disabled={disabled} onClick={onSelect}>{children}</button>,
    DropdownMenuSubTrigger: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) =>
      <button disabled={disabled}>{children}</button>,
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

function mount() {
  return render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><Workspaces /></MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockCreate.mockResolvedValue('new-workspace');
  mockChange.mockResolvedValue(undefined);
  mockCreation.canCreate = true;
});

test('denied creation disables both entry points while opening an existing workspace still works', async () => {
  mockCreation.canCreate = false;
  mount();
  expect((screen.getByRole('button', { name: 'workspace.create' })).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'web.importWorkspace' })).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Open existing' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('existing'));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('navigation retry reuses the created workspace instead of POSTing a duplicate', async () => {
  mockChange.mockRejectedValueOnce(new Error('Navigation failed'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspace.create' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retained draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() => expect(mockCreation.refresh).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'workspaceCreation.resume' }).at(-1)?.disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: 'workspaceCreation.resume' }).at(-1)!);
  await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(2));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockChange.mock.calls).toEqual([['new-workspace'], ['new-workspace']]);
});
