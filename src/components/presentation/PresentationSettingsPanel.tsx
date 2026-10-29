import { lazy, Suspense, useEffect, useState } from 'react';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import { listStyles } from './presentation-client';
import { templateUploadLimit } from './presentation-policy';
import { getPresentationStatus } from './server-client';
import StyleSettings from './StyleSettings';
import { Action, Notice } from './ui';
import { usePresentationAccess } from './usePresentationAccess';

import type { PresentationStyle } from './types';
import './presentation.css';

const PromptAdministration = lazy(() => import('./PromptAdministration'));

export default function PresentationSettingsPanel() {
  const workspaceId = useCurrentWorkspaceId();
  const user = useCurrentUserOptional();
  const userId = user?.uid;
  const identity = `${workspaceId}:${userId}`;
  const [result, setResult] = useState<{ identity: string; styles?: PresentationStyle[]; maxTemplateBytes?: number; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminIdentity, setAdminIdentity] = useState(identity);
  const { canManageStyles, isLoading, hasError } = usePresentationAccess();

  // Close prompt administration for another workspace or user before it renders for them. Retrying
  // the style request leaves it open, so its unsaved text and test inputs survive.
  if (adminIdentity !== identity) {
    setAdminIdentity(identity);
    setAdminOpen(false);
  }

  useEffect(() => {
    const controller = new AbortController();

    setResult(undefined);
    if (workspaceId && userId !== undefined)
      void Promise.all([
        listStyles({ workspaceId }, controller.signal),
        // Saved styles remain readable if billing is temporarily unavailable. Upload still checks
        // current policy on the server; the UI uses the conservative Free limit until a refresh.
        getPresentationStatus({ workspaceId }, controller.signal).catch(() => undefined),
      ])
        .then(([styles, status]) => {
          if (!controller.signal.aborted) setResult({ identity, styles, maxTemplateBytes: templateUploadLimit(status) });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({ identity, error: error instanceof Error ? error.message : 'Unable to load company styles.' });
        });
    return () => controller.abort();
  }, [workspaceId, identity, attempt, userId]);

  const current = result?.identity === identity ? result : undefined;

  return (
    <div className='ps-root h-full overflow-auto'>
      {!current && <Notice>Loading company styles…</Notice>}
      {current?.error && (
        <Notice>
          {current.error}
          <Action onClick={() => setAttempt((value) => value + 1)}>Try again</Action>
        </Notice>
      )}
      {!canManageStyles && (
        <Notice>
          {isLoading
            ? 'Checking workspace access…'
            : hasError
            ? 'Unable to verify workspace access.'
            : 'Only workspace owners can manage company styles.'}
        </Notice>
      )}
      {workspaceId && current?.styles && (
        <StyleSettings
          key={identity}
          scope={{ workspaceId }}
          styles={current.styles}
          maxTemplateBytes={current.maxTemplateBytes}
          editable={canManageStyles}
          onChange={(styles) => setResult({ ...current, identity, styles })}
        />
      )}
      {workspaceId && user && (
        <section className='ps-panel'>
          <Action onClick={() => setAdminOpen((open) => !open)}>
            {adminOpen ? 'Close prompt administration' : 'Prompt administration'}
          </Action>
          {adminOpen && (
            <Suspense fallback={<Notice>Checking administrator access…</Notice>}>
              <PromptAdministration key={identity} workspaceId={workspaceId} />
            </Suspense>
          )}
        </section>
      )}
    </div>
  );
}
