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
    unsupported?: boolean;
  }>();

  useEffect(() => {
    const controller = new AbortController();

    void getConfiguration(workspaceId, controller.signal)
      .then((configuration) => {
        if (controller.signal.aborted) return;
        // Older routes ignore the selected repository and only allow their fixed destination.
        // Do not open the editable wizard until Cloud supports explicit destination discovery.
        const unsupported = !Array.isArray(configuration.spaces);

        setResult({
          workspaceId,
          configuration: unsupported ? { ...configuration, available: false, spaces: [] } : configuration,
          unsupported: unsupported && configuration.available,
        });
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
    unsupported: result?.workspaceId === workspaceId && result.unsupported,
    reload,
  };
}
