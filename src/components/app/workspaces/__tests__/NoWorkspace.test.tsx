import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NoWorkspace } from '../NoWorkspace';

const mockCreate = jest.fn();
const mockChange = jest.fn();
const mockRefresh = jest.fn();
const mockCreation = { canCreate: false, status: 'ready', scopeKey: 'server:user', isCurrent: () => true, refresh: jest.fn() };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: { create: (...args: unknown[]) => mockCreate(...args) } }));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({ useWorkspaceCreationCapability: () => mockCreation }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ uid: 'user', name: 'User' }) }));
jest.mock('@/components/app/contexts/AuthInternalContext', () => ({ useAuthInternal: () => ({
  userWorkspaceInfo: { selectedWorkspace: null, workspaces: [] },
  onChangeWorkspace: mockChange, refreshUserWorkspaceInfo: mockRefresh,
}) }));
jest.mock('@/components/_shared/more-actions/importer/Import', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockCreate.mockResolvedValue('created-workspace');
  mockChange.mockResolvedValue(undefined);
  mockCreation.canCreate = false;
});

const mount = () => render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><NoWorkspace /></MemoryRouter>);

test('denied creators remain signed in with invitation guidance and a membership refresh', async () => {
  mount();
  expect(screen.getByRole('heading').textContent).toBe('workspaceCreation.noWorkspaceTitle');
  expect(screen.getByText('workspaceCreation.noWorkspaceDescription')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'workspace.create' })).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'web.importWorkspace' })).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.refreshWorkspaces' }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('an allowed account creates explicitly and retains the returned ID after navigation failure', async () => {
  mockCreation.canCreate = true;
  mockChange.mockRejectedValueOnce(new Error('Navigation failed'));
  mount();
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workspace.create' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My explicit workspace' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() => expect(mockCreation.refresh).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'workspaceCreation.resume' }).at(-1)?.disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: 'workspaceCreation.resume' }).at(-1)!);
  await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(2));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockChange.mock.calls).toEqual([['created-workspace'], ['created-workspace']]);
});
