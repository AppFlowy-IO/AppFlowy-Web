import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { GroupSpaceAccessSettings } from '../GroupSpaceAccessSettings';

const groupId = '12345678-1234-4123-8123-123456789abc';
const mockRead = jest.fn();
const mockSave = jest.fn();
let mockActor = 'owner';
let mockServer = 'server';
const emitter = new EventEmitter();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
  }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => mockActor }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getWorkspaceGroups: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/application/services/js-services/http/group-space-coverage-api', () => ({
  isGroupSpaceCoverageLevel: (value: unknown) => value === null || value === 10 || value === 30,
  setGroupSpaceCoverage: (...args: unknown[]) => mockSave(...args),
}));

function group(overrides = {}) {
  return {
    group_id: groupId,
    name: 'Directory group',
    member_count: 12,
    source: 'scim',
    space_coverage_supported: true,
    can_manage_space_coverage: true,
    space_coverage_access_level: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthInternalContext.Provider
      value={{ isAuthenticated: true, currentWorkspaceId: 'workspace', onChangeWorkspace: jest.fn() }}
    >
      <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
    </AuthInternalContext.Provider>
  );
}

function mount() {
  return render(<GroupSpaceAccessSettings workspaceId='workspace' />, { wrapper: Wrapper });
}

async function control() {
  return screen.findByRole('combobox', { name: 'groupSpaceAccess.levelFor:Directory group' });
}

beforeEach(() => {
  jest.resetAllMocks();
  emitter.removeAllListeners();
  mockActor = 'owner';
  mockServer = 'server';
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  mockRead.mockResolvedValue({ groups: [group()] });
  mockSave.mockImplementation(async (_workspace, _group, level) => ({ access_level: level }));
});

test('opening stays inactive and saving a SCIM group is separate from editing directory ownership', async () => {
  mount();
  const selector = await control();

  expect((selector as HTMLSelectElement).value).toBe('off');
  expect(mockSave).not.toHaveBeenCalled();
  expect(screen.getByText('groupSpaceAccess.scope')).toBeTruthy();
  expect(screen.getByText('groupSpaceAccess.independent')).toBeTruthy();
  fireEvent.change(selector, { target: { value: '30' } });
  expect(mockSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith('workspace', groupId, 30, expect.any(Function)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'button.save' }).disabled).toBe(true));
});

test('disabling explicitly sends null and never erases other group properties', async () => {
  mockRead.mockResolvedValue({ groups: [group({ space_coverage_access_level: 10 })] });
  mount();
  fireEvent.change(await control(), { target: { value: 'off' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith('workspace', groupId, null, expect.any(Function)));
  expect(mockRead.mock.calls[0]).toEqual(['workspace']);
});

test.each([
  { space_coverage_supported: undefined },
  { can_manage_space_coverage: false },
  { space_coverage_access_level: undefined },
])('missing support, authority, or known state stays unavailable: %p', async (patch) => {
  mockRead.mockResolvedValue({ groups: [group(patch)] });
  mount();
  expect(((await control()) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'button.save' }).disabled).toBe(true);
  expect(mockSave).not.toHaveBeenCalled();
});

test('a denied save retains its draft while refreshed authority disables writes', async () => {
  mockSave.mockImplementation(async () => {
    mockRead.mockResolvedValue({ groups: [group({ can_manage_space_coverage: false })] });
    throw new Error('Owner required');
  });
  mount();
  fireEvent.change(await control(), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Owner required'));
  await waitFor(() => expect(screen.getByRole('combobox').disabled).toBe(true));
  expect(screen.getByRole('combobox').value).toBe('10');
});

test.each(['account', 'server'])('late prior-scope data and drafts do not cross a %s switch', async (change) => {
  let resolve!: (value: unknown) => void;

  mockRead
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
    .mockResolvedValue({ groups: [group({ can_manage_space_coverage: false })] });
  const { rerender } = mount();

  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  if (change === 'account') mockActor = 'member';
  else mockServer = 'different';
  rerender(<GroupSpaceAccessSettings workspaceId='workspace' />);
  await control();
  await act(async () => {
    resolve({ groups: [group({ space_coverage_access_level: 30 })] });
  });
  expect(screen.getByRole('combobox').value).toBe('off');
  expect(screen.getByRole('combobox').disabled).toBe(true);
});

test('a broad permission hint invalidates an in-flight save guard', async () => {
  let finish!: (value: unknown) => void;

  mockSave.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      })
  );
  mount();
  fireEvent.change(await control(), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'button.save' }));
  const isCurrent = mockSave.mock.calls[0][3];

  expect(isCurrent()).toBe(true);
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  expect(isCurrent()).toBe(false);
  await act(async () => {
    finish({ access_level: 10 });
  });
  expect(screen.getByRole('combobox').value).toBe('10');
  // An unconfirmed acknowledgement leaves the draft available for an explicit retry.
  expect(screen.getByRole('button', { name: 'button.save' }).disabled).toBe(false);
});

test('large directories render bounded rows and searching reaches a later group', async () => {
  mockRead.mockResolvedValue({
    groups: Array.from({ length: 120 }, (_, index) => group({ group_id: `group-${index}`, name: `Group ${index}` })),
  });
  mount();
  await screen.findByTestId('group-space-access-group-0');
  expect(screen.getAllByRole('combobox')).toHaveLength(25);
  fireEvent.change(screen.getByRole('textbox', { name: 'groupSpaceAccess.search' }), { target: { value: 'Group 119' } });
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(within(screen.getByTestId('group-space-access-group-119')).getByText('Group 119')).toBeTruthy();
});

test('a permission burst keeps one read active and one fresh follow-up, disabling stale authority', async () => {
  mount();
  const selector = await control();

  fireEvent.change(selector, { target: { value: '10' } });
  let finish!: (value: unknown) => void;

  mockRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
  }

  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'button.save' }).disabled).toBe(true);
  mockRead.mockResolvedValue({ groups: [group({ can_manage_space_coverage: false })] });
  await act(async () => {
    finish({ groups: [group()] });
  });
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('combobox').disabled).toBe(true);
  expect(screen.getByRole('combobox').value).toBe('10');
  expect(mockSave).not.toHaveBeenCalled();
});

test('unmount discards a queued group read after the active one settles', async () => {
  let finish!: (value: unknown) => void;

  mockRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { unmount } = mount();

  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  await act(async () => {
    emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
  });
  unmount();
  await act(async () => {
    finish({ groups: [group()] });
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
});
