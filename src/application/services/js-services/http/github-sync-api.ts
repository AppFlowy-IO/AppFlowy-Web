import {
  CreateGitHubSyncBinding,
  GitHubRepositoryProbe,
  GitHubSyncBinding,
  GitHubSyncConfiguration,
  GitHubSyncRun,
  GitHubSyncStatus,
  GithubPageSource,
  GithubSourceVersion,
  UpdateGitHubSyncBinding,
} from '@/application/integrations/github-sync';

import { executeAPIRequest, getAxios } from './core';

const REQUEST_TIMEOUT_MS = 45_000;
const requestOptions = (signal?: AbortSignal) => ({ signal, timeout: REQUEST_TIMEOUT_MS });
const privateResponse = { suppressResponseDataLogging: true };
const workspacePath = (workspaceId: string) => `/api/integrations/github/workspaces/${encodeURIComponent(workspaceId)}`;
const bindingPath = (workspaceId: string, bindingId: string) =>
  `${workspacePath(workspaceId)}/bindings/${encodeURIComponent(bindingId)}`;

export function getConfiguration(workspaceId: string, signal?: AbortSignal) {
  return executeAPIRequest<GitHubSyncConfiguration>(
    () => getAxios()?.get(`${workspacePath(workspaceId)}/configuration`, requestOptions(signal)),
    privateResponse
  );
}

/** An omitted connection explicitly probes public access without starting OAuth. */
export function probeRepository(workspaceId: string, input: { connection_id?: string } = {}, signal?: AbortSignal) {
  return executeAPIRequest<GitHubRepositoryProbe>(
    () => getAxios()?.post(`${workspacePath(workspaceId)}/repository`, input, requestOptions(signal)),
    privateResponse
  );
}

export function listBindings(workspaceId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ bindings: GitHubSyncBinding[] }>(
    () => getAxios()?.get(`${workspacePath(workspaceId)}/bindings`, requestOptions(signal)),
    privateResponse
  );
}

export function createBinding(workspaceId: string, input: CreateGitHubSyncBinding, signal?: AbortSignal) {
  return executeAPIRequest<{ binding: GitHubSyncBinding; run: GitHubSyncRun }>(
    () => getAxios()?.post(`${workspacePath(workspaceId)}/bindings`, input, requestOptions(signal)),
    privateResponse
  );
}

export function getBinding(workspaceId: string, bindingId: string, signal?: AbortSignal) {
  return executeAPIRequest<GitHubSyncStatus>(
    () => getAxios()?.get(bindingPath(workspaceId, bindingId), requestOptions(signal)),
    privateResponse
  );
}

export function updateBinding(
  workspaceId: string,
  bindingId: string,
  input: UpdateGitHubSyncBinding,
  signal?: AbortSignal
) {
  return executeAPIRequest<{ binding: GitHubSyncBinding }>(
    () => getAxios()?.patch(bindingPath(workspaceId, bindingId), input, requestOptions(signal)),
    privateResponse
  );
}

export function syncBinding(workspaceId: string, bindingId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ run: GitHubSyncRun }>(
    () => getAxios()?.post(`${bindingPath(workspaceId, bindingId)}/sync`, {}, requestOptions(signal)),
    privateResponse
  );
}

export function getPageSource(workspaceId: string, viewId: string, signal?: AbortSignal) {
  return executeAPIRequest<GithubPageSource | null>(
    () =>
      getAxios()?.get(
        `${workspacePath(workspaceId)}/pages/${encodeURIComponent(viewId)}/source`,
        requestOptions(signal)
      ),
    privateResponse
  );
}

export function getPageSourceHistory(workspaceId: string, viewId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ versions: GithubSourceVersion[] }>(
    () =>
      getAxios()?.get(
        `${workspacePath(workspaceId)}/pages/${encodeURIComponent(viewId)}/history`,
        requestOptions(signal)
      ),
    privateResponse
  );
}
