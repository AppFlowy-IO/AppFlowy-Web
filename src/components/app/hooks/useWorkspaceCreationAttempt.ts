import { useMemo, useState } from 'react';

import { WorkspaceService } from '@/application/services/domains';
import { WorkspaceCreationAttempt } from '@/application/services/js-services/workspace-creation-attempt';
import { getErrorMessage } from '@/utils/errors';

/** Share receipt recovery between the workspace switcher and empty-account landing. */
export function useWorkspaceCreationAttempt(scopeKey: string) {
  const attempt = useMemo(() => ({ scopeKey, value: new WorkspaceCreationAttempt(WorkspaceService.create) }), [scopeKey]).value;
  const [, render] = useState(0);
  let draft;
  let error;

  try { draft = attempt.snapshot(); }
  catch (cause) { error = getErrorMessage(cause); }

  return {
    draft,
    error,
    async create(name: string) {
      try { return await attempt.run(name); }
      finally { render((version) => version + 1); }
    },
    complete(id: string) { attempt.complete(id); render((version) => version + 1); },
  };
}
