import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import type { WorkspaceSpaceCreationCapabilities } from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import {
  clearSpaceCreationCapabilityCache,
  useSpaceCreationCapability,
} from '@/components/app/hooks/useSpaceCreationCapability';
import {
  canStartSpaceCreation,
  refreshSpaceCreationAdmission,
  SpaceCreationNotice,
  spaceCreationUnavailableReason,
} from '@/components/app/view-actions/SpaceCreationNotice';

const mockRead = jest.fn();
const emitter = new EventEmitter();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'user-a' }));

type Status = 'loading' | 'ready' | 'unsupported' | 'error';

const refused = { code: 1012, message: 'active workspace membership required' };

function permission(status: Status, canCreateSpace: boolean, retained?: boolean, error?: unknown) {
  return {
    status,
    canCreateSpace,
    capability:
      retained === undefined ? undefined : ({ can_create_space: retained } as WorkspaceSpaceCreationCapabilities),
    error,
  };
}

describe('space creation entry points', () => {
  it.each([
    ['a fresh allowed answer', permission('ready', true, true), true, undefined],
    ['a fresh denial', permission('ready', false, false), false, 'denied'],
    ['a denial reported without a capability object', permission('ready', false), false, 'denied'],
    ['the first check', permission('loading', false), false, 'loading'],
    ['a failed first check', permission('error', false), false, 'loadError'],
    ['a server without the capability route', permission('unsupported', false), true, undefined],
    // Background rechecks keep the last confirmed answer on screen; sending re-reads it fresh.
    ['a recheck of an allowed answer', permission('loading', false, true), true, undefined],
    ['a recheck of a denial', permission('loading', false, false), false, 'denied'],
    ['a failed recheck of an allowed answer', permission('error', false, true), false, 'loadError'],
    ['a failed recheck of a denial', permission('error', false, false), false, 'denied'],
    // A refused read is the server's answer, not a check that could not run.
    ['a refused first check', permission('error', false, undefined, refused), false, 'denied'],
    ['a refused recheck of an allowed answer', permission('error', false, true, { httpStatus: 403 }), false, 'denied'],
    ['an offline check', permission('error', false, undefined, new Error('Offline')), false, 'loadError'],
  ] as const)('handles %s', (_case, value, startable, reason) => {
    expect(canStartSpaceCreation(value)).toBe(startable);
    expect(spaceCreationUnavailableReason(value)).toBe(reason);
  });
});

function capability(canCreate: boolean): WorkspaceSpaceCreationCapabilities {
  return {
    workspace_id: 'workspace-a',
    policy: 'owners_only',
    revision: { epoch: '1', counter: '1' },
    selected_creators_supported: true,
    group_selection_supported: true,
    can_create_space: canCreate,
    can_manage_space_creators: false,
    can_grant_creator_groups: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthInternalContext.Provider
      value={{ isAuthenticated: true, currentWorkspaceId: 'workspace-a', onChangeWorkspace: jest.fn() }}
    >
      <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
    </AuthInternalContext.Provider>
  );
}

// What Create Space shows: the notice plus whether Create may start.
function CreateSpaceEntry({ testId = 'startable', onState }: { testId?: string; onState?: (state: State) => void }) {
  const state = useSpaceCreationCapability('workspace-a');

  onState?.(state);
  return (
    <>
      <SpaceCreationNotice permission={state} />
      <span data-testid={testId}>{String(canStartSpaceCreation(state))}</span>
    </>
  );
}

type State = ReturnType<typeof useSpaceCreationCapability>;

function notice() {
  return screen.queryByTestId('space-creation-notice')?.textContent ?? null;
}

function startable() {
  return screen.getByTestId('startable').textContent;
}

async function recheckInBackground<T>() {
  const next = deferred<T>();

  mockRead.mockReturnValueOnce(next.promise);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
  return next;
}

describe('the space creation notice during background rechecks', () => {
  beforeEach(() => {
    clearSpaceCreationCapabilityCache();
    mockRead.mockReset();
    emitter.removeAllListeners();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('keeps an older server usable while it is asked again, without a checking message', async () => {
    mockRead.mockRejectedValueOnce({ httpStatus: 404, code: 404 });
    render(<CreateSpaceEntry />, { wrapper: Wrapper });
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startable()).toBe('true'));
    expect(notice()).toBeNull();

    const next = await recheckInBackground<WorkspaceSpaceCreationCapabilities>();

    expect(notice()).toBeNull();
    expect(startable()).toBe('true');
    await act(async () => next.reject({ httpStatus: 404, code: 404 }));
    expect(notice()).toBeNull();
    expect(startable()).toBe('true');
  });

  it.each([
    ['an allowed answer', true, null],
    ['a denial', false, 'workspacePermissions.denied'],
  ])('keeps %s on screen while it is rechecked', async (_case, canCreate, shown) => {
    mockRead.mockResolvedValueOnce(capability(canCreate));
    render(<CreateSpaceEntry />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(notice()).toBe(shown);
      expect(startable()).toBe(String(canCreate));
    });

    const next = await recheckInBackground<WorkspaceSpaceCreationCapabilities>();

    expect(notice()).toBe(shown);
    expect(startable()).toBe(String(canCreate));
    await act(async () => next.resolve(capability(canCreate)));
    expect(notice()).toBe(shown);
  });

  it('says a refused check is a denial, offers no retry, and keeps it while rechecking', async () => {
    mockRead.mockRejectedValueOnce(refused);
    render(<CreateSpaceEntry />, { wrapper: Wrapper });
    await waitFor(() => expect(notice()).toBe('workspacePermissions.denied'));
    expect(screen.queryByRole('button', { name: 'spaceCreation.tryAgain' })).toBeNull();
    expect(startable()).toBe('false');

    const next = await recheckInBackground<WorkspaceSpaceCreationCapabilities>();

    expect(notice()).toBe('workspacePermissions.denied');
    // Access given back while the dialog is open is picked up by the recheck.
    await act(async () => next.resolve(capability(true)));
    expect(notice()).toBeNull();
    expect(startable()).toBe('true');
  });

  it('offers Try again after a check that could not run, and shows the check it starts', async () => {
    mockRead.mockRejectedValueOnce({ code: 500, httpStatus: 500, message: 'Server error' });
    render(<CreateSpaceEntry />, { wrapper: Wrapper });
    await waitFor(() => expect(notice()).toContain('workspacePermissions.loadError'));
    const next = deferred<WorkspaceSpaceCreationCapabilities>();

    mockRead.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'spaceCreation.tryAgain' }));
    await waitFor(() => expect(notice()).toBe('workspacePermissions.loading'));
    await act(async () => next.resolve(capability(true)));
    expect(notice()).toBeNull();
    expect(startable()).toBe('true');
  });
});

describe('the answer shared by the entry points', () => {
  beforeEach(() => {
    clearSpaceCreationCapabilityCache();
    mockRead.mockReset();
    emitter.removeAllListeners();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('opens Create Space from New Page with the answer New Page already has', async () => {
    mockRead.mockResolvedValue(capability(true));
    render(<CreateSpaceEntry />, { wrapper: Wrapper });
    await waitFor(() => expect(startable()).toBe('true'));
    render(<CreateSpaceEntry testId='dialog-startable' />, { wrapper: Wrapper });

    // No "Checking permissions…" and Create is usable at once; sending re-reads admission anyway.
    expect(screen.queryAllByTestId('space-creation-notice')).toHaveLength(0);
    expect(screen.getByTestId('dialog-startable').textContent).toBe('true');
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server without the capability route', { httpStatus: 404, code: 404 }, 'unsupported'],
    ['a refused read', { httpStatus: 403 }, 'denied'],
  ])('settles admission on %s with the read it already made', async (_case, failure, admission) => {
    let state!: State;

    mockRead.mockResolvedValueOnce(capability(true)).mockRejectedValueOnce(failure);
    render(<CreateSpaceEntry onState={(next) => (state = next)} />, { wrapper: Wrapper });
    await waitFor(() => expect(startable()).toBe('true'));
    let result: unknown;

    await act(async () => {
      result = await refreshSpaceCreationAdmission(state, 'workspace-a');
    });
    expect(result).toBe(admission);
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('asks once more directly when the live read could not run', async () => {
    let state!: State;

    mockRead
      .mockResolvedValueOnce(capability(true))
      .mockRejectedValueOnce({ code: 500, httpStatus: 500, message: 'Server error' })
      .mockResolvedValueOnce(capability(true));
    render(<CreateSpaceEntry onState={(next) => (state = next)} />, { wrapper: Wrapper });
    await waitFor(() => expect(startable()).toBe('true'));
    let result: unknown;

    await act(async () => {
      result = await refreshSpaceCreationAdmission(state, 'workspace-a');
    });
    expect(result).toBe('allowed');
    expect(mockRead).toHaveBeenCalledTimes(3);
  });
});
