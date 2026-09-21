import { useCallback, useEffect, useRef, useState } from 'react';

import { GitHubSyncStatus } from '@/application/integrations/github-sync';
import * as GitHubSyncService from '@/application/services/domains/github-sync';

export function isSyncRunning(status: GitHubSyncStatus): boolean {
  return (
    status.binding.enabled &&
    (['pending', 'running', 'retry'].includes(status.run?.status || '') ||
      ['pending', 'syncing'].includes(status.binding.status))
  );
}

/** Polls one durable binding serially; closing or switching workspaces cancels every request. */
export function useGitHubSyncStatus(workspaceId: string, bindingId?: string) {
  const key = `${workspaceId}:${bindingId || ''}`;
  const [snapshot, setSnapshot] = useState<{ key: string; status: GitHubSyncStatus }>();
  const [failure, setFailure] = useState<{ key: string; error: unknown }>();
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef<AbortController>();
  const reload = useCallback(
    (update?: Partial<Pick<GitHubSyncStatus, 'binding' | 'run'>>) => {
      // A read started before a mutation must not overwrite its confirmed result.
      activeRequest.current?.abort();
      if (update) {
        const updatedKey = `${workspaceId}:${update.binding?.id ?? bindingId ?? ''}`;

        setSnapshot((current) => {
          const previous = current?.key === updatedKey ? current.status : undefined;
          const binding = update.binding ?? previous?.binding;

          return binding
            ? {
                key: updatedKey,
                status: {
                  binding,
                  run: update.run === undefined ? previous?.run ?? null : update.run,
                  entries: previous?.entries ?? [],
                },
              }
            : current;
        });
      }

      setRevision((value) => value + 1);
    },
    [bindingId, workspaceId]
  );

  useEffect(() => {
    if (!bindingId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    activeRequest.current = controller;

    const poll = async () => {
      try {
        const status = await GitHubSyncService.getBinding(workspaceId, bindingId, controller.signal);

        if (controller.signal.aborted) return;
        setSnapshot({ key, status });
        setFailure(undefined);
        timer = setTimeout(() => void poll(), isSyncRunning(status) ? 2_000 : 15_000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setFailure({ key, error });
        const retryAfter = (error as { retryAfterSecs?: unknown })?.retryAfterSecs;
        const delay =
          typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.max(5_000, Math.min(2_147_483_647, Math.ceil(retryAfter * 1_000)))
            : 5_000;

        timer = setTimeout(() => void poll(), delay);
      }
    };

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (activeRequest.current === controller) activeRequest.current = undefined;
    };
  }, [bindingId, key, revision, workspaceId]);

  return {
    status: snapshot?.key === key ? snapshot.status : undefined,
    error: failure?.key === key ? failure.error : undefined,
    reload,
  };
}
