import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceService } from '@/application/services/domains';
import {
  isUnreadableDraftError,
  WorkspaceCreationAttempt,
  WorkspaceCreationDraft,
} from '@/application/services/js-services/workspace-creation-attempt';
import { WorkspaceCreationCapabilityState } from '@/components/app/hooks/useWorkspaceCreationCapability';

/** Share request recovery between the workspace switcher and empty-account landing. */
export function useWorkspaceCreationAttempt(scopeKey: string) {
  const attempt = useMemo(
    () => ({ scopeKey, value: new WorkspaceCreationAttempt(WorkspaceService.create) }),
    [scopeKey]
  ).value;
  const [, render] = useState(0);
  let draft: WorkspaceCreationDraft | undefined;
  let unreadable = false;

  try {
    draft = attempt.snapshot();
  } catch (cause) {
    // A context change is not a saved request; the remount for the new account re-reads it.
    unreadable = isUnreadableDraftError(cause);
  }

  return {
    /** A request whose outcome is unknown (no `workspaceId`), or a created workspace not yet opened. */
    draft,
    /** Storage holds a saved request this version cannot read; only Discard clears it. */
    unreadable,
    async create(name: string) {
      try {
        return await attempt.run(name);
      } finally {
        render((version) => version + 1);
      }
    },
    complete(id: string) {
      attempt.complete(id);
      render((version) => version + 1);
    },
    discard() {
      attempt.discard();
      render((version) => version + 1);
    },
  };
}

/**
 * Create a workspace, or finish a saved request, then open the result. A created workspace that
 * fails to open keeps its ID, so trying again opens it instead of creating another.
 */
export function useWorkspaceCreationFlow(
  creation: WorkspaceCreationCapabilityState,
  openWorkspace: (workspaceId: string) => Promise<void>
) {
  const { t } = useTranslation();
  const attempt = useWorkspaceCreationAttempt(creation.scopeKey);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (name: string) => {
    if (!creation.isCurrent()) throw new Error(t('workspaceCreation.contextChanged'));
    setSubmitting(true);
    try {
      // A saved request may finish after a denial: the server resolves it before admission.
      if (!attempt.draft && !creation.canCreate) throw new Error(t('workspaceCreation.denied'));
      const workspaceId = await attempt.create(name);

      if (!creation.isCurrent()) throw new Error(t('workspaceCreation.contextChanged'));
      await openWorkspace(workspaceId);
      if (creation.isCurrent()) attempt.complete(workspaceId);
    } catch (error) {
      if (creation.isCurrent()) void creation.refresh();
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  return { ...attempt, submitting, submit };
}

export type WorkspaceCreationFlow = ReturnType<typeof useWorkspaceCreationFlow>;
