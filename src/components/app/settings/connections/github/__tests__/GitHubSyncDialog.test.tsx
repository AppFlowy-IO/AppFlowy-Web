import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

import { GitHubSyncBinding, GitHubSyncConfiguration, GitHubSyncStatus } from '@/application/integrations/github-sync';
import { authorizeIntegration } from '@/application/integrations/oauth';
import * as GitHubSyncService from '@/application/services/domains/github-sync';
import * as IntegrationService from '@/application/services/domains/integration';
import { ConnectionsPanel } from '@/components/app/settings/ConnectionsPanel';

import { GitHubSyncDialog } from '../GitHubSyncDialog';
import { GitHubSyncSection } from '../GitHubSyncSection';
import { useGitHubSyncStatus } from '../useGitHubSyncStatus';
import { useSyncAction } from '../useSyncAction';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let result = String(options?.defaultValue || key);

      for (const [name, value] of Object.entries(options || {})) result = result.replace(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));
jest.mock('@/components/_shared/modal/NormalModal', () => ({
  NormalModal: ({
    open,
    title,
    children,
    onClose,
  }: {
    open: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <div role='dialog'>
        {title}
        <button aria-label='Dismiss dialog' onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    ) : null,
}));
jest.mock('@/application/services/domains/github-sync', () => ({
  getConfiguration: jest.fn(),
  probeRepository: jest.fn(),
  listBindings: jest.fn(),
  createBinding: jest.fn(),
  getBinding: jest.fn(),
  updateBinding: jest.fn(),
  syncBinding: jest.fn(),
}));
jest.mock('@/application/integrations/oauth', () => ({
  authorizeIntegration: jest.fn(),
  IntegrationOAuthError: class extends Error {},
}));
jest.mock('@/application/services/domains/integration', () => ({
  getConfiguredProviders: jest.fn(),
  listConnections: jest.fn(),
  confirmConnection: jest.fn(),
  getConnectionEmail: jest.fn(),
}));

const api = jest.mocked(GitHubSyncService);
const integrations = jest.mocked(IntegrationService);
const authorize = jest.mocked(authorizeIntegration);
const configuration: GitHubSyncConfiguration = {
  available: true,
  can_manage: true,
  repository: 'example/docs',
  branch: 'main',
  root_path: 'docs',
  space_id: 'space',
  space_name: 'Self-hosted Guide',
  existing_page_count: 42,
  oauth_configured: true,
};
const binding: GitHubSyncBinding = {
  id: 'binding',
  workspace_id: 'workspace',
  space_id: 'space',
  connection_id: null,
  authentication_mode: 'public',
  repository_id: 123,
  repository_owner: 'example',
  repository_name: 'docs',
  branch: 'main',
  root_path: 'docs',
  enabled: true,
  generation: 5,
  status: 'synced',
  last_error: null,
  last_applied_commit: '123456789abcdef',
  last_synced_at: '2026-09-20T12:00:00Z',
};
const complete: GitHubSyncStatus = {
  binding,
  run: { id: 'run', status: 'completed', progress: { stage: 'complete', completed: 1, total: 1 } },
  entries: [
    {
      view_id: 'page',
      path: 'docs/a.md',
      kind: 'file',
      lifecycle: 'active',
      last_error: null,
      source_commit_sha: '123456789abcdef',
      updated_at: '2026-09-20T12:00:00Z',
    },
  ],
};
const ready = {
  status: 'ready' as const,
  repository: { id: 123, full_name: 'example/docs', private: false, default_branch: 'main' },
};
const account = {
  id: 'github-account',
  provider: 'github',
  status: 'active',
  connected_at: '2026-09-20',
  account_identifier: '771',
  metadata: { github_login: 'annie', account_name: 'Annie' },
};

function props() {
  return { workspaceId: 'workspace', configuration, open: true, onOpenChange: jest.fn() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

async function reviewAndStart() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start sync' }));
}

describe('GitHub sync setup and management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.probeRepository.mockResolvedValue(ready);
    api.getBinding.mockResolvedValue(complete);
    api.listBindings.mockResolvedValue({ bindings: [] });
    api.createBinding.mockResolvedValue({ binding, run: { id: 'run', status: 'pending' } });
    api.updateBinding.mockResolvedValue({ binding });
    api.syncBinding.mockResolvedValue({ run: { id: 'next', status: 'pending' } });
    integrations.listConnections.mockResolvedValue([]);
    integrations.confirmConnection.mockResolvedValue({ success: true, connection: account });
    authorize.mockResolvedValue({ connectionId: 'pending-account', oauthQuery: 'code=code&state=state' });
  });

  afterEach(() => jest.useRealTimers());

  it('imports a public repository without OAuth or a credential in the create request', async () => {
    render(<GitHubSyncDialog {...props()} />);
    expect(await screen.findByText('Public repository · No GitHub sign-in required')).toBeTruthy();
    expect(api.probeRepository).toHaveBeenCalledWith('workspace', {}, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Connect GitHub account' })).toBeNull();
    expect(integrations.listConnections).not.toHaveBeenCalled();
    await reviewAndStart();
    expect(await screen.findByText('Sync completed')).toBeTruthy();
    expect(api.createBinding).toHaveBeenCalledWith(
      'workspace',
      {
        repository_id: 123,
        space_id: 'space',
        branch: 'main',
        root_path: 'docs',
      },
      expect.any(AbortSignal)
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(integrations.getConnectionEmail).not.toHaveBeenCalled();
    expect(screen.getByText('12345678')).toBeTruthy();
  });

  it('offers OAuth only after private access is required, then confirms and creates with that account', async () => {
    api.probeRepository
      .mockResolvedValueOnce({ status: 'authentication_required' })
      .mockResolvedValue({ ...ready, repository: { ...ready.repository, private: true } });
    render(<GitHubSyncDialog {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub account' }));
    expect(await screen.findByText('annie')).toBeTruthy();
    expect(authorize).toHaveBeenCalledWith('workspace', 'github', expect.any(AbortSignal));
    expect(integrations.confirmConnection).toHaveBeenCalledWith(
      'workspace',
      'github',
      'pending-account',
      'code=code&state=state',
      expect.any(AbortSignal)
    );
    expect(api.probeRepository).toHaveBeenLastCalledWith(
      'workspace',
      { connection_id: 'github-account' },
      expect.any(AbortSignal)
    );
    await reviewAndStart();
    await screen.findByText('Sync completed');
    expect(api.createBinding.mock.calls[0][1].connection_id).toBe('github-account');
    expect(integrations.getConnectionEmail).not.toHaveBeenCalled();
  });

  it('uses a selected existing GitHub login without starting another OAuth flow', async () => {
    api.probeRepository.mockResolvedValueOnce({ status: 'authentication_required' }).mockResolvedValue(ready);
    integrations.listConnections.mockResolvedValue([account]);
    render(<GitHubSyncDialog {...props()} />);
    const select = await screen.findByRole('combobox', { name: 'GitHub account' });

    expect(screen.getByRole('option', { name: 'annie' })).toBeTruthy();
    fireEvent.change(select, { target: { value: account.id } });
    await reviewAndStart();
    await screen.findByText('Sync completed');
    expect(authorize).not.toHaveBeenCalled();
    expect(api.createBinding.mock.calls[0][1].connection_id).toBe(account.id);
  });

  it('refreshes the Connections account list when closing the wizard after GitHub authorization', async () => {
    Element.prototype.scrollIntoView = jest.fn();
    api.getConfiguration.mockResolvedValue(configuration);
    integrations.getConfiguredProviders.mockResolvedValue([]);
    api.probeRepository.mockResolvedValueOnce({ status: 'authentication_required' }).mockResolvedValue(ready);
    render(<ConnectionsPanel workspaceId='workspace' />);
    await waitFor(() => expect(screen.getByTestId('add-connection').disabled).toBe(false));
    fireEvent.keyDown(screen.getByTestId('add-connection'), { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByTestId('add-github-sync'));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub account' }));
    await screen.findByText('annie');
    integrations.listConnections.mockResolvedValue([account]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByTestId('connection-github-account')).toHaveProperty(
      'textContent',
      expect.stringContaining('annie')
    );
    expect(api.createBinding).not.toHaveBeenCalled();
  });

  it('keeps ordinary repository errors retryable without treating them as an OAuth request', async () => {
    api.probeRepository.mockRejectedValueOnce(new Error('GitHub temporarily unavailable'));
    render(<GitHubSyncDialog {...props()} />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('GitHub temporarily unavailable')
    );
    expect(screen.queryByRole('button', { name: 'Connect GitHub account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Public repository · No GitHub sign-in required');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('reopens the existing durable run instead of creating or probing again', async () => {
    const initial = props();

    api.getBinding.mockResolvedValueOnce({
      ...complete,
      binding: { ...binding, status: 'syncing' },
      run: { id: 'run', status: 'running', progress: { stage: 'importing', completed: 2, total: 9 } },
    });
    const view = render(<GitHubSyncDialog {...initial} bindingId='binding' />);

    expect(await screen.findByText('2 / 9 changes applied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(initial.onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(<GitHubSyncDialog {...initial} bindingId='binding' open={false} />);
    view.rerender(<GitHubSyncDialog {...initial} bindingId='binding' />);
    expect(await screen.findByText('Sync completed')).toBeTruthy();
    expect(api.getBinding).toHaveBeenCalledTimes(2);
    expect(api.createBinding).not.toHaveBeenCalled();
    expect(api.probeRepository).not.toHaveBeenCalled();
  });

  it('pauses and resumes with the current server generation and preserves page counts', async () => {
    const paused = { ...binding, enabled: false, status: 'paused', generation: 6 };

    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    await screen.findByText('Sync completed');
    api.updateBinding.mockResolvedValueOnce({ binding: paused });
    api.getBinding.mockResolvedValueOnce({ ...complete, binding: paused });
    fireEvent.click(screen.getByRole('button', { name: 'Pause sync' }));
    await screen.findByText('Sync paused');
    expect(api.updateBinding).toHaveBeenLastCalledWith(
      'workspace',
      'binding',
      { expected_generation: 5, enabled: false },
      expect.any(AbortSignal)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume sync' }));
    await screen.findByText('Sync completed');
    expect(api.updateBinding).toHaveBeenLastCalledWith(
      'workspace',
      'binding',
      { expected_generation: 6, enabled: true },
      expect.any(AbortSignal)
    );
    expect(authorize).not.toHaveBeenCalled();
  });

  it('applies a confirmed pause and its generation before a slow status refresh finishes', async () => {
    const paused = { ...binding, enabled: false, status: 'paused', generation: 6 };

    api.getBinding.mockResolvedValueOnce(complete).mockReturnValue(deferred<GitHubSyncStatus>().promise);
    api.updateBinding.mockResolvedValueOnce({ binding: paused });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause sync' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume sync' }));
    await waitFor(() => expect(api.updateBinding).toHaveBeenCalledTimes(2));
    expect(api.updateBinding).toHaveBeenLastCalledWith(
      'workspace',
      'binding',
      { expected_generation: 6, enabled: true },
      expect.any(AbortSignal)
    );
  });

  it('retains a confirmed mutation when a status read from before it resolves late', async () => {
    jest.useFakeTimers();
    const staleRead = deferred<GitHubSyncStatus>();
    const paused = { ...binding, enabled: false, status: 'paused', generation: 6 };

    api.getBinding
      .mockResolvedValueOnce(complete)
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValue(deferred<GitHubSyncStatus>().promise);
    const hook = renderHook(() => useGitHubSyncStatus('workspace', 'binding'));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    const staleSignal = api.getBinding.mock.calls[1][2];

    act(() => hook.result.current.reload({ binding: paused }));
    await act(async () => staleRead.resolve(complete));
    expect(staleSignal?.aborted).toBe(true);
    expect(hook.result.current.status?.binding).toEqual(paused);
    expect(hook.result.current.status?.entries).toEqual(complete.entries);
  });

  it('disables duplicate sync requests as soon as the server returns a pending run', async () => {
    api.getBinding.mockResolvedValueOnce(complete).mockReturnValue(deferred<GitHubSyncStatus>().promise);
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(api.getBinding).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Sync now' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(api.syncBinding).toHaveBeenCalledTimes(1);
  });

  it('retries a failed sync mutation and clears its error after success', async () => {
    api.syncBinding.mockRejectedValueOnce(new Error('Temporary sync failure'));
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Temporary sync failure')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.syncBinding).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(api.syncBinding).toHaveBeenLastCalledWith('workspace', 'binding', expect.any(AbortSignal));
  });

  it('retries a failed pause using a generation refreshed since the first attempt', async () => {
    jest.useFakeTimers();
    const updated = { ...complete, binding: { ...binding, generation: 6 } };
    const paused = { ...binding, enabled: false, status: 'paused', generation: 7 };

    api.getBinding.mockResolvedValueOnce(complete).mockResolvedValueOnce(updated);
    api.updateBinding.mockRejectedValueOnce(new Error('Binding changed')).mockResolvedValueOnce({ binding: paused });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause sync' }));
    await screen.findByRole('alert');
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    api.getBinding.mockResolvedValue({ ...complete, binding: paused });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Sync paused');
    expect(api.updateBinding).toHaveBeenLastCalledWith(
      'workspace',
      'binding',
      { expected_generation: 6, enabled: false },
      expect.any(AbortSignal)
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switches an inaccessible OAuth binding to verified public access before resuming with the returned generation', async () => {
    const paused = {
      ...binding,
      authentication_mode: 'oauth' as const,
      enabled: false,
      status: 'paused',
      last_error: 'connection_issue',
    };

    api.getBinding.mockResolvedValueOnce({ ...complete, binding: paused });
    api.updateBinding.mockResolvedValueOnce({ binding: { ...binding, enabled: false, generation: 6 } });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check repository access' }));
    await screen.findByText('Public repository · No GitHub sign-in required');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume sync' }));
    await screen.findByText('Sync completed');
    expect(api.updateBinding).toHaveBeenNthCalledWith(
      1,
      'workspace',
      'binding',
      { expected_generation: 5, authentication_mode: 'public' },
      expect.any(AbortSignal)
    );
    expect(api.updateBinding).toHaveBeenNthCalledWith(
      2,
      'workspace',
      'binding',
      { expected_generation: 6, enabled: true },
      expect.any(AbortSignal)
    );
    expect(authorize).not.toHaveBeenCalled();
  });

  it('retains the changed access generation when resuming fails and the owner retries', async () => {
    const paused = {
      ...binding,
      authentication_mode: 'oauth' as const,
      enabled: false,
      status: 'paused',
      last_error: 'connection_issue',
    };
    const publicBinding = { ...binding, enabled: false, status: 'paused', generation: 6 };

    api.getBinding
      .mockResolvedValueOnce({ ...complete, binding: paused })
      .mockReturnValue(deferred<GitHubSyncStatus>().promise);
    api.updateBinding
      .mockResolvedValueOnce({ binding: publicBinding })
      .mockRejectedValueOnce(new Error('Resume temporarily unavailable'))
      .mockResolvedValueOnce({ binding: { ...publicBinding, generation: 7 } })
      .mockResolvedValueOnce({ binding: { ...binding, generation: 8 } });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check repository access' }));
    await screen.findByText('Public repository · No GitHub sign-in required');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume sync' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Sync completed');
    expect(api.updateBinding).toHaveBeenNthCalledWith(
      3,
      'workspace',
      'binding',
      { expected_generation: 6, authentication_mode: 'public' },
      expect.any(AbortSignal)
    );
    expect(api.updateBinding).toHaveBeenNthCalledWith(
      4,
      'workspace',
      'binding',
      { expected_generation: 7, enabled: true },
      expect.any(AbortSignal)
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts old workspace reads and ignores their late private-account response', async () => {
    const late = deferred<typeof ready | { status: 'authentication_required' }>();

    api.probeRepository.mockReturnValueOnce(late.promise);
    const view = render(<GitHubSyncDialog {...props()} />);

    await waitFor(() => expect(api.probeRepository).toHaveBeenCalledTimes(1));
    const signal = api.probeRepository.mock.calls[0][2];

    view.rerender(<GitHubSyncDialog {...props()} workspaceId='different-workspace' />);
    await screen.findByText('Public repository · No GitHub sign-in required');
    await act(async () => late.resolve({ status: 'authentication_required' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Connect GitHub account' })).toBeNull();
    expect(api.probeRepository).toHaveBeenLastCalledWith('different-workspace', {}, expect.any(AbortSignal));
  });

  it('polls serially and cancels its timer and in-flight read on close', async () => {
    jest.useFakeTimers();
    const pending = deferred<GitHubSyncStatus>();
    const running = { ...complete, binding: { ...binding, status: 'syncing' }, run: { id: 'run', status: 'running' } };

    api.getBinding.mockResolvedValueOnce(running).mockReturnValueOnce(pending.promise);
    const view = render(<GitHubSyncDialog {...props()} bindingId='binding' />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(api.getBinding).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(api.getBinding).toHaveBeenCalledTimes(2);
    const signal = api.getBinding.mock.calls[1][2];

    view.unmount();
    await act(async () => pending.resolve(running));
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(signal?.aborted).toBe(true);
    expect(api.getBinding).toHaveBeenCalledTimes(2);
  });

  it('does not offer binding management or make owner-only requests to a non-owner', () => {
    render(<GitHubSyncSection {...props()} configuration={{ ...configuration, can_manage: false }} />);
    expect(screen.getByText('A workspace owner can manage GitHub sync.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.listBindings).not.toHaveBeenCalled();
    expect(api.probeRepository).not.toHaveBeenCalled();
  });

  it('shows failed source paths and retry without presenting partial work as completed', async () => {
    api.getBinding.mockResolvedValue({
      ...complete,
      binding: { ...binding, status: 'error', last_error: 'unsupported_markdown' },
      run: { id: 'run', status: 'partial_failure', last_error: 'unsupported_markdown' },
      entries: [{ ...complete.entries[0], last_error: 'unsupported_markdown' }],
    });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    expect(await screen.findByText('Sync needs attention')).toBeTruthy();
    expect(screen.getByText('docs/a.md')).toBeTruthy();
    expect(screen.queryByText('Sync completed')).toBeNull();
    api.getBinding.mockResolvedValue(complete);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await screen.findByText('Sync completed');
    expect(api.syncBinding).toHaveBeenCalledWith('workspace', 'binding', expect.any(AbortSignal));
  });

  it('shows private-provider setup guidance instead of an unusable OAuth button', async () => {
    api.probeRepository.mockResolvedValue({ status: 'authentication_required' });
    render(<GitHubSyncDialog {...props()} configuration={{ ...configuration, oauth_configured: false }} />);
    expect(
      await screen.findByText('Ask your administrator to configure GitHub OAuth for private repository access.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect GitHub account' })).toBeNull();
  });

  it('refreshes idle bindings so a pause from another session appears without reopening', async () => {
    jest.useFakeTimers();
    api.getBinding.mockResolvedValueOnce(complete).mockResolvedValue({
      ...complete,
      binding: { ...binding, enabled: false, status: 'paused' },
    });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Sync completed')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(screen.getByText('Sync paused')).toBeTruthy();
    expect(api.getBinding).toHaveBeenCalledTimes(2);
  });

  it('honors a provider retry delay before polling status again', async () => {
    jest.useFakeTimers();
    api.getBinding.mockRejectedValueOnce({ message: 'Rate limited', retryAfterSecs: 9 });
    render(<GitHubSyncDialog {...props()} bindingId='binding' />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(8_999);
    });
    expect(api.getBinding).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(api.getBinding).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Sync completed')).toBeTruthy();
  });

  it('serializes same-tick mutation attempts instead of aborting and repeating a create', async () => {
    const pending = deferred<string>();
    const operation = jest.fn(() => pending.promise);
    const accept = jest.fn();
    const { result } = renderHook(() => useSyncAction());

    act(() => {
      void result.current.run(operation, accept);
      void result.current.run(operation, accept);
    });
    expect(operation).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve('created'));
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('restarts the initial probe after React StrictMode effect cleanup', async () => {
    render(
      <StrictMode>
        <GitHubSyncDialog {...props()} />
      </StrictMode>
    );
    expect(await screen.findByText('Public repository · No GitHub sign-in required')).toBeTruthy();
    expect(api.probeRepository).toHaveBeenCalledTimes(2);
    expect(api.probeRepository.mock.calls[0][2]?.aborted).toBe(true);
    expect(api.probeRepository.mock.calls[1][2]?.aborted).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('does not confirm an OAuth response that arrives after the dialog closes', async () => {
    const pending = deferred<{ connectionId: string; oauthQuery: string }>();

    api.probeRepository.mockResolvedValue({ status: 'authentication_required' });
    authorize.mockReturnValue(pending.promise);
    const view = render(<GitHubSyncDialog {...props()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect GitHub account' }));
    const signal = authorize.mock.calls[0][2];

    view.rerender(<GitHubSyncDialog {...props()} open={false} />);
    await act(async () => pending.resolve({ connectionId: 'late-account', oauthQuery: 'code=late' }));
    expect(signal.aborted).toBe(true);
    expect(integrations.confirmConnection).not.toHaveBeenCalled();
  });
});
