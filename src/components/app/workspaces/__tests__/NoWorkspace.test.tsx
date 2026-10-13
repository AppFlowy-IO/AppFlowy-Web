import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { NoWorkspace } from '../NoWorkspace';

const mockCreate = jest.fn();
const mockAccept = jest.fn();
const mockChange = jest.fn();
const mockRefresh = jest.fn();
const mockListInvitations = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
const mockClearRedirect = jest.fn();
const mockInvalidToken = jest.fn();
const mockImportProps: { current?: { onSuccessfulImport?: () => void; successMessage?: unknown } } = {};
const mockCreation = {
  canCreate: false,
  status: 'ready',
  checking: false,
  legacy: false,
  scopeKey: 'server:user',
  isCurrent: () => true,
  refresh: jest.fn(),
};
let mockWorkspaces: Array<{ id: string; name: string; icon: string }> = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${Object.values(values).join(' ')}` : key),
  }),
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: (...args: unknown[]) => mockToastSuccess(...args) },
}));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { create: (...args: unknown[]) => mockCreate(...args) },
  AccessService: { acceptInvitation: (...args: unknown[]) => mockAccept(...args) },
}));
jest.mock('@/application/services/js-services/http/workspace-api', () => ({
  listPendingWorkspaceInvitations: () => mockListInvitations(),
}));
jest.mock('@/application/session/sign_in', () => ({ clearRedirectTo: () => mockClearRedirect() }));
jest.mock('@/application/session/token', () => ({
  getTokenParsed: () => ({ user: { id: 'user' } }),
  invalidToken: () => mockInvalidToken(),
}));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({
  useWorkspaceCreationCapability: () => mockCreation,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: 'user', name: 'Person', email: 'person@example.com' }),
  useCurrentUserOptional: () => ({ uid: 'user', name: 'Person', email: 'person@example.com' }),
}));
jest.mock('@/components/app/contexts/AuthInternalContext', () => ({
  useAuthInternal: () => ({
    userWorkspaceInfo: { selectedWorkspace: null, workspaces: mockWorkspaces },
    onChangeWorkspace: mockChange,
    refreshUserWorkspaceInfo: mockRefresh,
  }),
}));
jest.mock('@/components/_shared/more-actions/importer/Import', () => ({
  __esModule: true,
  default: (props: { onSuccessfulImport?: () => void; successMessage?: unknown }) => {
    mockImportProps.current = props;
    return null;
  },
}));

const draftKey = 'workspace-creation:v1:' + JSON.stringify(['https://test.appflowy.cloud', 'user']);
const invitation = {
  invite_id: 'invite-1',
  workspace_id: 'demo-workspace',
  workspace_name: 'Demo',
  inviter_name: 'Alice',
  inviter_email: 'alice@example.com',
  inviter_icon: '',
  workspace_icon: '',
  member_count: 3,
  status: 'Pending',
};

function LoginLocation() {
  const location = useLocation();

  return <output data-testid='login-location'>{location.pathname + location.search}</output>;
}

const page = () => (
  <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
    <Routes>
      <Route path='/app' element={<NoWorkspace />} />
      <Route path='/login' element={<LoginLocation />} />
    </Routes>
  </MemoryRouter>
);
const mount = () => render(page());

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockWorkspaces = [];
  mockImportProps.current = undefined;
  mockCreate.mockImplementation(async (_payload: unknown, options?: { reserve?: () => string }) => {
    options?.reserve?.();
    return 'created-workspace';
  });
  mockAccept.mockResolvedValue(undefined);
  mockChange.mockResolvedValue(undefined);
  mockRefresh.mockResolvedValue({ selectedWorkspace: null, workspaces: [] });
  mockListInvitations.mockResolvedValue([]);
  mockCreation.canCreate = false;
  mockCreation.status = 'ready';
});

test('a denied account sees who is signed in and why, without dead-end creation buttons', async () => {
  mount();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('workspaceCreation.noWorkspaceTitle');
  expect(screen.getByText('workspaceCreation.signedInAs person@example.com')).toBeTruthy();
  expect(screen.getByText('workspaceCreation.noWorkspaceDescription')).toBeTruthy();
  expect(screen.getByText('workspaceCreation.denied')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'workspace.create' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'workspaceCreation.importWorkspace' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'button.retry' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'workspaceCreation.checkAgain' })).toHaveLength(1);
  await waitFor(() => expect(mockListInvitations).toHaveBeenCalledTimes(1));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('a pending invitation can be joined without permission to create workspaces', async () => {
  mockListInvitations.mockResolvedValue([invitation]);
  mount();
  const join = await screen.findByRole('button', { name: 'workspaceCreation.joinNamed Demo' });

  expect(join.textContent).toBe('invitation.join');
  expect(screen.getByText('workspaceCreation.invitedBy Alice')).toBeTruthy();
  fireEvent.click(join);
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('demo-workspace'));
  expect(mockAccept).toHaveBeenCalledWith('invite-1');
  expect(mockToastSuccess).toHaveBeenCalledWith('invitation.success');
  expect(mockCreate).not.toHaveBeenCalled();
});

test.each([
  ['its inviter', { inviter_name: 'Alice' }, 'workspaceCreation.joinInvitedBy Alice'],
  ['no inviter either', { inviter_name: '', inviter_email: '' }, 'workspaceCreation.joinNamed workspaceCreation.unnamedWorkspace'],
])('an invitation without a workspace name is shown in words with %s, never by its ID', async (_label, inviter, label) => {
  mockListInvitations.mockResolvedValue([{ ...invitation, ...inviter, workspace_name: '' }]);
  mount();
  const join = await screen.findByRole('button', { name: label });

  expect(screen.getByText('workspaceCreation.unnamedWorkspace')).toBeTruthy();
  expect(document.body.textContent).not.toContain('demo-workspace');
  fireEvent.click(join);
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('demo-workspace'));
});

test('a failed join is reported and the lists are refreshed for another try', async () => {
  mockListInvitations.mockResolvedValue([invitation]);
  mockAccept.mockRejectedValueOnce({ code: 1068, message: 'This invitation is no longer valid' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'workspaceCreation.joinNamed Demo' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('This invitation is no longer valid'));
  expect(mockChange).not.toHaveBeenCalled();
  expect(mockListInvitations).toHaveBeenCalledTimes(2);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('an existing workspace without a selection can be opened', async () => {
  mockWorkspaces = [{ id: 'existing', name: 'Existing', icon: '' }];
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.openNamed Existing' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('existing'));
});

test('Check again refreshes workspaces, invitations and creation access, and reports a failure', async () => {
  mount();
  await waitFor(() => expect(mockListInvitations).toHaveBeenCalledTimes(1));
  mockRefresh.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('workspaceCreation.checkFailed'));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockListInvitations).toHaveBeenCalledTimes(2);
  expect(mockCreation.refresh).toHaveBeenCalledTimes(1);
});

test('a creation access error explains itself and the page offers a single Check again', async () => {
  mockCreation.status = 'error';
  mount();
  expect(screen.getByText('workspaceCreation.unavailable')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'workspaceCreation.checkAgain' })).toHaveLength(1);
  expect((screen.getByRole('button', { name: 'workspace.create' })).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'workspaceCreation.importWorkspace' })).disabled).toBe(true);
  await waitFor(() => expect(mockListInvitations).toHaveBeenCalled());
});

test('an allowed account creates with a suggested name; a created workspace that fails to open is not created again', async () => {
  mockCreation.canCreate = true;
  mockChange.mockRejectedValueOnce(new Error('Navigation failed'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspace.create' }));
  expect((screen.getByRole('textbox')).value).toBe("Person's Workspace");
  expect(screen.getByText('workspaceCreation.ownership')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'button.create' }));
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'workspaceCreation.openWorkspace' }).at(-1)?.hasAttribute('disabled')).toBe(
      false
    )
  );
  expect(screen.getAllByText('workspaceCreation.createdNotOpened').length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'workspaceCreation.openWorkspace' }).at(-1)!);
  await waitFor(() => expect(mockChange).toHaveBeenCalledTimes(2));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockChange.mock.calls).toEqual([['created-workspace'], ['created-workspace']]);
  await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
});

test('an unconfirmed request is settled from the page: Check again replays it and Discard forgets it', async () => {
  sessionStorage.setItem(draftKey, JSON.stringify({ requestId: 'request-1', name: 'Pending name' }));
  mockCreate.mockRejectedValueOnce({ code: -1, message: 'Network Error' });
  mount();
  expect(screen.getByText('workspaceCreation.notConfirmed')).toBeTruthy();
  expect(screen.getByText('workspaceCreation.notConfirmedHint')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'workspace.create' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('workspaceCreation.notConfirmed'));
  expect(mockCreate).toHaveBeenCalledWith({ workspace_name: 'Pending name' }, { replay: 'request-1' });
  expect(screen.getByText('workspaceCreation.notConfirmed')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'workspaceCreation.discard' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.discard' }));
  expect(screen.queryByText('workspaceCreation.notConfirmed')).toBeNull();
  expect(sessionStorage.getItem(draftKey)).toBeNull();
  expect(mockRefresh).toHaveBeenCalled();
});

test('Check again keeps an unconfirmed request when sign-in rejects the replay', async () => {
  sessionStorage.setItem(draftKey, JSON.stringify({ requestId: 'request-1', name: 'Pending name' }));
  mockCreation.canCreate = true;
  mockCreate.mockRejectedValueOnce({ code: 401, httpStatus: 401, message: 'Request failed with status code 401' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('workspaceCreation.notConfirmed'));
  expect(mockCreate).toHaveBeenCalledWith({ workspace_name: 'Pending name' }, { replay: 'request-1' });
  // The original request may have committed, so a new creation is not offered.
  expect(screen.getByText('workspaceCreation.notConfirmed')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'workspace.create' })).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(draftKey) ?? 'null')).toEqual({ requestId: 'request-1', name: 'Pending name' });
});

test('Check again finishes an unconfirmed request and opens its workspace', async () => {
  sessionStorage.setItem(draftKey, JSON.stringify({ requestId: 'request-1', name: 'Pending name' }));
  mockCreate.mockResolvedValueOnce('recovered-workspace');
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  await waitFor(() => expect(mockChange).toHaveBeenCalledWith('recovered-workspace'));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(draftKey)).toBeNull();
});

test('an unreadable saved request is explained and can be discarded', async () => {
  mockCreation.canCreate = true;
  sessionStorage.setItem(draftKey, '{broken');
  mount();
  expect(screen.getByText('workspaceCreation.invalidDraft')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'workspace.create' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.discard' }));
  expect(screen.queryByText('workspaceCreation.invalidDraft')).toBeNull();
  expect((screen.getByRole('button', { name: 'workspace.create' })).disabled).toBe(false);
  await waitFor(() => expect(mockListInvitations).toHaveBeenCalled());
});

test('Sign out uses the standard sign-out, so an earlier redirect cannot follow the next sign-in', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.signOut' }));
  expect(mockClearRedirect).toHaveBeenCalledTimes(1);
  expect(mockInvalidToken).toHaveBeenCalledTimes(1);
  expect((await screen.findByTestId('login-location')).textContent).toBe('/login?force=true');
});

test('a received import explains that the new workspace is still being processed', async () => {
  mockCreation.canCreate = true;
  mount();
  await waitFor(() => expect(mockListInvitations).toHaveBeenCalled());
  expect(mockImportProps.current?.successMessage).toBe('workspaceCreation.importProcessing');
  act(() => mockImportProps.current?.onSuccessfulImport?.());
  expect(screen.getByText('workspaceCreation.importProcessing')).toBeTruthy();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

/** Each turn schedules the next one only after its refresh settles, so fake time moves in steps. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

test('after an import the page looks for the new workspace with growing gaps until it is listed', async () => {
  jest.useFakeTimers();
  try {
    mockCreation.canCreate = true;
    mockWorkspaces = [{ id: 'existing', name: 'Existing', icon: '' }];
    const view = mount();

    act(() => mockImportProps.current?.onSuccessfulImport?.());
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await advance(9_999);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(mockRefresh).toHaveBeenCalledTimes(3);
    // The gap grows but never beyond a minute.
    for (const [gap, calls] of [
      [20_000, 4],
      [40_000, 5],
      [60_000, 6],
      [60_000, 7],
    ]) {
      await advance(gap - 1);
      expect(mockRefresh).toHaveBeenCalledTimes(calls - 1);
      await advance(1);
      expect(mockRefresh).toHaveBeenCalledTimes(calls);
    }

    expect(screen.getByText('workspaceCreation.importProcessing')).toBeTruthy();

    // Once the imported workspace is listed, it replaces the notice and the page stops asking.
    mockWorkspaces = [...mockWorkspaces, { id: 'imported', name: 'Imported', icon: '' }];
    view.rerender(page());
    expect(screen.queryByText('workspaceCreation.importProcessing')).toBeNull();
    expect(screen.getByRole('button', { name: 'workspaceCreation.openNamed Imported' })).toBeTruthy();
    for (let minute = 0; minute < 10; minute += 1) await advance(60_000);
    expect(mockRefresh).toHaveBeenCalledTimes(7);
  } finally {
    jest.useRealTimers();
  }
});

test('the search for an imported workspace stops when the page closes', async () => {
  jest.useFakeTimers();
  try {
    mockCreation.canCreate = true;
    const view = mount();

    act(() => mockImportProps.current?.onSuccessfulImport?.());
    await advance(5_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    view.unmount();
    for (let minute = 0; minute < 10; minute += 1) await advance(60_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
