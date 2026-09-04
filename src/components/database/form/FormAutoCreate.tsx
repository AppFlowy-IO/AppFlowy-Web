import { Dialog } from '@mui/material';
import { ArrowRight, FileText, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import { isFormQuestionFieldType } from '@/application/database-yjs/form-field-types';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseFields } from '@/application/types';
import { Button } from '@/components/ui/button';

// Hoisted so MUI's Paper doesn't see a fresh props object every render.
const DIALOG_PAPER_PROPS = {
  className: 'max-w-md w-full',
  'aria-label': 'Auto-create form questions',
} as const;

type HydrationResult =
  | { request: () => Promise<void>; attempt: number; status: 'pending' }
  | { request: () => Promise<void>; attempt: number; status: 'ready' }
  | { request: () => Promise<void>; attempt: number; status: 'failed'; errorMessage: string };

function hydrationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The latest form settings could not be loaded.';
}

/**
 * Mirror of the desktop's `_evaluateAutoCreatePromptOnce`. Three landing
 * states gated by the decision sentinel plus the Form view's ordered fields:
 *
 *   1. `decided` → do nothing.
 *   2. unresolved and fieldCount === 0 → atomically decide an empty Form.
 *   3. unresolved and fieldCount > 0 → show the modal;
 *      Create-N populates, Start-from-scratch leaves empty. Both resolve in
 *      one history transaction.
 *
 * `FormBuilderView` mounts this only while the explicit Form decision is
 * unresolved, then this component resolves the hydration-dependent branch.
 */
export function FormAutoCreate({
  snapshot,
  fields,
  fieldsVersion,
  writer,
  ensureHydrated,
  onDismiss,
}: {
  snapshot: FormLayoutSnapshot;
  fields: YDatabaseFields | undefined;
  fieldsVersion: number;
  writer: FormWriter;
  ensureHydrated: () => Promise<void>;
  onDismiss: () => void;
}) {
  // Refresh race guard. A database may render immediately from IndexedDB while
  // its server state is newer (for example another client already chose Start
  // from scratch). Wait for an authoritative metadata refresh before making
  // any one-time Yjs write; a passive-effect delay is not a hydration signal.
  const [attempt, setAttempt] = useState(0);
  const [hydrationResult, setHydrationResult] = useState<HydrationResult>(() => ({
    request: ensureHydrated,
    attempt: 0,
    status: 'pending',
  }));
  const [dismissedRequest, setDismissedRequest] = useState<(() => Promise<void>) | null>(null);

  // Associate a result with the exact request function and retry attempt that
  // produced it. If the active view changes, the new request is pending during
  // render immediately; a stale success can never unlock auto-create for it.
  const currentHydrationResult =
    hydrationResult.request === ensureHydrated && hydrationResult.attempt === attempt ? hydrationResult : null;
  const hydrationStatus = currentHydrationResult?.status ?? 'pending';

  useEffect(() => {
    let cancelled = false;
    const request = ensureHydrated;

    void request()
      .then(() => {
        if (!cancelled) {
          setHydrationResult({ request, attempt, status: 'ready' });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHydrationResult({
            request,
            attempt,
            status: 'failed',
            errorMessage: hydrationErrorMessage(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, ensureHydrated]);

  const supportedFieldIds = useMemo(() => {
    if (!fields || snapshot.fieldOrderIds === null) return [];
    const out: string[] = [];

    snapshot.fieldOrderIds.forEach((id) => {
      const field = fields.get(id);

      if (!field) return;
      const ty = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (isFormQuestionFieldType(ty)) out.push(id);
    });
    return out;
    // `fieldsVersion` invalidates the memo when the field map mutates;
    // the Y.Map identity in `fields` is stable across mutations so we
    // can't rely on it alone. eslint can't see this dependency because
    // `fieldsVersion` isn't referenced inside the closure — that's the
    // entire point of the invalidation-token pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldsVersion, snapshot.fieldOrderIds]);

  const explicitlyExcluded = useMemo(
    () => new Set(snapshot.explicitlyExcludedFieldIds),
    [snapshot.explicitlyExcludedFieldIds]
  );
  const projectedSupportedFieldIds = useMemo(
    () => supportedFieldIds.filter((fieldId) => !explicitlyExcluded.has(fieldId)),
    [explicitlyExcluded, supportedFieldIds]
  );
  const projectedFieldCount = projectedSupportedFieldIds.length;

  // Silent-seed path. Self-gating on `snapshot.decided` — the atomic writer
  // call flips that flag synchronously via the YJS observer, so the next run
  // bails on the guard. No imperative latch needed.
  //
  // A newly-created standalone Form already carries a decided default layout.
  // Any unresolved Form is therefore a linked or legacy view that still needs
  // the same Create-N / Start-from-scratch choice, even with one or two
  // questions. Resolve only the degenerate zero-question case silently so a
  // "Create 0 questions" modal never appears.
  useEffect(() => {
    if (hydrationStatus !== 'ready') return;
    if (snapshot.decided) return;
    if (!fields || snapshot.fieldOrderIds === null) return;
    if (projectedFieldCount !== 0) return;
    writer.resolveAutoCreate(projectedSupportedFieldIds);
  }, [
    hydrationStatus,
    snapshot.decided,
    snapshot.fieldOrderIds,
    fields,
    projectedFieldCount,
    projectedSupportedFieldIds,
    writer,
  ]);

  if (currentHydrationResult?.status === 'failed') {
    return (
      <div
        role='alert'
        data-testid='form-auto-create-hydration-error'
        className='flex items-center gap-3 rounded-md border border-line-divider px-4 py-3'
      >
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium text-text-primary'>Couldn&apos;t refresh form settings</p>
          <p className='text-xs text-text-caption'>
            Questions are temporarily hidden to prevent changes based on stale data. Check your connection and retry.
          </p>
          <p
            data-testid='form-auto-create-hydration-error-detail'
            className='mt-1 break-words text-xs text-text-tertiary'
          >
            {currentHydrationResult.errorMessage}
          </p>
        </div>
        <Button
          data-testid='form-auto-create-hydration-retry'
          size='sm'
          onClick={() => setAttempt((current) => current + 1)}
        >
          Retry
        </Button>
      </div>
    );
  }

  // Modal visibility is derived, not imperative. When the user picks
  // Create-N / Start-from-scratch (or a remote sync delivers a
  // previously-persisted decision), `writer.resolveAutoCreate()` flips
  // `snapshot.decided` and this expression evaluates false on the
  // same render — no auto-dismiss effect, no flash.
  const showDialog =
    hydrationStatus === 'ready' &&
    !snapshot.decided &&
    snapshot.fieldOrderIds !== null &&
    dismissedRequest !== ensureHydrated &&
    projectedFieldCount > 0;

  if (!showDialog) return null;

  // Clearing an existing legacy projection is destructive. Only the explicit
  // Start-from-scratch action may make that decision; Escape and backdrop
  // clicks dismiss this session's prompt without touching shared state.
  const startFromScratch = () => {
    writer.resolveAutoCreate([]);
  };

  return (
    <Dialog
      open={true}
      onClose={() => {
        setDismissedRequest(() => ensureHydrated);
        onDismiss();
      }}
      PaperProps={DIALOG_PAPER_PROPS}
    >
      <div data-testid='form-auto-create-dialog' className='flex flex-col items-center gap-4 px-6 py-6 text-center'>
        <div className='flex items-center gap-3 text-text-caption'>
          <Table2 size={24} />
          <ArrowRight size={16} />
          <FileText size={24} />
        </div>
        <h2 className='text-lg font-semibold'>Auto-create form questions based on existing properties?</h2>
        <p className='text-sm text-text-caption'>Only supported property types will create new questions.</p>
        <Button
          data-testid='form-auto-create-confirm'
          className='w-full'
          onClick={() => {
            writer.resolveAutoCreate(projectedSupportedFieldIds);
          }}
        >
          {projectedFieldCount === 1 ? 'Create 1 question' : `Create ${projectedFieldCount} questions`}
        </Button>
        <button
          data-testid='form-auto-create-start-from-scratch'
          type='button'
          onClick={startFromScratch}
          className='text-sm text-text-caption hover:underline'
        >
          Start from scratch
        </button>
      </div>
    </Dialog>
  );
}
