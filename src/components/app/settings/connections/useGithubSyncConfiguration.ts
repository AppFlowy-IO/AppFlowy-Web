import { useCallback, useEffect, useState } from 'react';

import { GitHubSyncConfiguration } from '@/application/integrations/github-sync';
import { getConfiguration } from '@/application/services/domains/github-sync';

/** Keep public-repository availability independent of OAuth provider configuration. */
export function useGithubSyncConfiguration(workspaceId: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    workspaceId: string;
    configuration?: GitHubSyncConfiguration;
    failed?: boolean;
  }>();

  useEffect(() => {
    const controller = new AbortController();

    void getConfiguration(workspaceId, controller.signal)
      .then((configuration) => {
        if (!controller.signal.aborted) setResult({ workspaceId, configuration });
      })
      .catch((error: { httpStatus?: number }) => {
        if (!controller.signal.aborted) {
          // Older servers have no GitHub sync routes. Other failures remain retryable.
          setResult({ workspaceId, failed: error?.httpStatus !== 404 });
        }
      });
    return () => controller.abort();
  }, [workspaceId, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  return {
    configuration: result?.workspaceId === workspaceId ? result.configuration : undefined,
    failed: result?.workspaceId === workspaceId && result.failed,
    reload,
  };
}
