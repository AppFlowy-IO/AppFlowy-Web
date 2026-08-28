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
const DIALOG_PAPER_PROPS = { className: 'max-w-md w-full' } as const;

/**
 * Mirror of the desktop's `_evaluateAutoCreatePromptOnce`. Three landing
 * states gated by `(snapshot.decided, snapshot.questions.length, fields)`:
 *
 *   1. `decided` OR `questions.length > 0` → do nothing.
 *   2. `!decided && questions.empty && fieldCount <= 2` → silent sidebar-
 *      create seed: populate from the supported subset, mark decided.
 *   3. `!decided && questions.empty && fieldCount > 2` → show the modal;
 *      Create-N populates, Start-from-scratch leaves empty. Both mark
 *      decided.
 *
 * `FormBuilderView` mounts this only while the form is undecided and empty,
 * then this component resolves the hydration-dependent field-count branch.
 */
export function FormAutoCreate({
  snapshot,
  fields,
  fieldsVersion,
  writer,
  ensureHydrated,
}: {
  snapshot: FormLayoutSnapshot;
  fields: YDatabaseFields | undefined;
  fieldsVersion: number;
  writer: FormWriter;
  ensureHydrated: () => Promise<void>;
}) {
  // Refresh race guard. A database may render immediately from IndexedDB while
  // its server state is newer (for example another client already chose Start
  // from scratch). Wait for an authoritative metadata refresh before making
  // any one-time Yjs write; a passive-effect delay is not a hydration signal.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void ensureHydrated()
      .then(() => {
        if (!cancelled) setHydrated(true);
      })
      .catch((error) => {
        // Fail closed: manual question authoring remains available, but we do
        // not make an irreversible auto-create choice from potentially stale
        // local state.
        console.error('[FormAutoCreate] Failed to hydrate form settings', error);
      });

    return () => {
      cancelled = true;
    };
  }, [ensureHydrated]);

  const supportedFieldIds = useMemo(() => {
    if (!fields) return [];
    const out: string[] = [];

    fields.forEach((field, id) => {
      if (typeof id !== 'string') return;
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
  }, [fields, fieldsVersion]);

  const fieldCount = supportedFieldIds.length;

  // Silent-seed path. Self-gating on `snapshot.decided` — the second
  // call inside the effect (`markDecided`) flips that flag synchronously
  // via the YJS observer, so the next run bails on the guard. No
  // imperative latch needed.
  //
  // 0 supported → seed nothing + mark decided so a "Create 0 questions"
  // modal never fires for a database of only unsupported types.
  // 1-2 supported → adopt silently. 3+ → fall through to the modal
  // surfaced by `showDialog` below.
  useEffect(() => {
    if (!hydrated) return;
    if (snapshot.decided || snapshot.questions.length > 0) return;
    if (!fields) return;
    if (fieldCount > 2) return;
    if (fieldCount > 0) writer.populateFromFields(supportedFieldIds);
    writer.markDecided();
  }, [hydrated, snapshot.decided, snapshot.questions.length, fields, fieldCount, supportedFieldIds, writer]);

  // Modal visibility is derived, not imperative. When the user picks
  // Create-N / Start-from-scratch (or a remote sync delivers a
  // previously-persisted decision), `writer.markDecided()` flips
  // `snapshot.decided` and this expression evaluates false on the
  // same render — no auto-dismiss effect, no flash.
  const showDialog = hydrated && !snapshot.decided && snapshot.questions.length === 0 && fieldCount > 2;

  if (!showDialog) return null;

  // Tap-outside or Esc → treat as Start-from-scratch (cleanest default;
  // the user explicitly didn't pick Create-N). Matches the desktop's
  // `FormAutoCreateDialog.show` barrier policy.
  const dismissAsScratch = () => {
    writer.clearQuestions();
    writer.markDecided();
  };

  return (
    <Dialog open={true} onClose={dismissAsScratch} PaperProps={DIALOG_PAPER_PROPS}>
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
            writer.populateFromFields(supportedFieldIds);
            writer.markDecided();
          }}
        >
          {fieldCount === 1 ? 'Create 1 question' : `Create ${fieldCount} questions`}
        </Button>
        <button
          data-testid='form-auto-create-start-from-scratch'
          type='button'
          onClick={dismissAsScratch}
          className='text-sm text-text-caption hover:underline'
        >
          Start from scratch
        </button>
      </div>
    </Dialog>
  );
}
