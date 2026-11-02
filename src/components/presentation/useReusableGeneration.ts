import { useEffect, useState } from 'react';

import { generationRequest, type GenerateInput } from './server-adapter';
import { findReusableResult } from './server-client';

import type { JobStatus } from './server-contract';

/** A changed input hides the old match immediately; late replies cannot enable Open. */
export function useReusableGeneration(input: GenerateInput, enabled: boolean, userId: string) {
  const request = enabled && input.source.serverSource?.sources?.length ? generationRequest(input, '') : undefined;
  const key = JSON.stringify([input.scope.workspaceId, userId, input.source.revision, request]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; job: JobStatus | null; error?: string }>();

  useEffect(() => {
    if (!enabled || !request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findReusableResult(input.scope, { ...request, requestId: crypto.randomUUID() }, controller.signal)
        .then((job) => {
          if (!controller.signal.aborted) setResult({ key, job });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              key,
              job: null,
              error: error instanceof Error ? error.message : 'Unable to check saved results.',
            });
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The key includes every source and request field; object recreation must not restart reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, attempt]);

  const current = result?.key === key ? result : undefined;

  return {
    job: current?.job,
    checking: enabled && !!request && !current,
    error: current?.error,
    refresh: () => {
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}
