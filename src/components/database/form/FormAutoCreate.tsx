import { Dialog } from '@mui/material';
import { ArrowRight, FileText, Table2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
  useFormWriter,
} from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';

/**
 * Same field-type filter as the desktop's `formQuestionFieldTypes`.
 * Kept inline to avoid coupling the auto-create lifecycle to the
 * picker's import.
 */
const SUPPORTED_TYPES: Set<FieldType> = new Set([
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.URL,
  FieldType.Media,
]);

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
 * The component renders nothing in the non-prompt branches — it's safe
 * to mount unconditionally in `FormBuilderView`.
 */
export function FormAutoCreate() {
  const snapshot = useFormLayoutSnapshot();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const writer = useFormWriter();
  const ctx = useDatabaseContextOptional();
  const readOnly = ctx?.readOnly ?? false;

  // Latch so the evaluator runs once per mount even if the snapshot
  // observer re-emits. Mirrors `_firstFieldsEvaluated` on desktop.
  const evaluated = useRef(false);
  const [showModal, setShowModal] = useState(false);

  // Refresh race guard. On a refreshed page, the YJS doc loads
  // asynchronously: the React tree mounts before the persisted
  // `__form_decided__` sentinel arrives over the wire. Without a
  // hydration await (desktop has `_overrides.hydrated.then(...)` —
  // `form_page.dart:_evaluateAutoCreatePromptOnce`), the effect
  // below can see `decided=false` for a brief moment, commit to
  // showing the modal, and then never reverse course when sync
  // finally delivers `decided=true`.
  //
  // We address it from two sides:
  //   - Defer the *initial* evaluation by one paint, so a same-tick
  //     YJS apply has a chance to land before we decide.
  //   - Watch `snapshot.decided` after the modal is open and
  //     auto-dismiss when sync confirms a prior decision (covers
  //     slower remote-sync arrivals).
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // One animation frame is enough for the YJS provider to flush
    // its initial doc apply into React state. A timer (rather than
    // `requestAnimationFrame`) makes the gate testable and survives
    // tabs that are momentarily backgrounded.
    const timer = setTimeout(() => setHydrated(true), 0);

    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss when a remotely-delivered decision catches up after
  // we already showed the modal. Keeps the latch (`evaluated.current`)
  // intact so we don't re-fire elsewhere.
  useEffect(() => {
    if (showModal && snapshot.decided) {
      setShowModal(false);
    }
  }, [showModal, snapshot.decided]);

  // `fieldsVersion` re-runs the memo when fields mutate; without it the
  // count would freeze at the first-hydrate value and Create-N would
  // miss any field added between hydrate and the modal opening.
  const supportedFieldIds = useMemo(() => {
    if (!fields) return [];
    const out: string[] = [];

    fields.forEach((field, id) => {
      if (typeof id !== 'string') return;
      const ty = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (SUPPORTED_TYPES.has(ty)) out.push(id);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldsVersion]);

  const fieldCount = supportedFieldIds.length;

  useEffect(() => {
    if (readOnly) return;
    if (evaluated.current) return;
    // Wait one tick after mount to let an in-flight YJS apply land
    // before we commit a decision. See `hydrated` definition above.
    if (!hydrated) return;
    if (snapshot.decided) {
      evaluated.current = true;
      return;
    }

    if (snapshot.questions.length > 0) {
      evaluated.current = true;
      return;
    }

    // Wait for the fields Y.Map to surface at all. Until then we can't
    // count anything. `fields == null` happens during the database YJS
    // doc's initial sync; the effect will re-fire on the next field
    // change so we don't need a retry loop.
    if (!fields) return;
    evaluated.current = true;

    // Silent-seed branch — gated on **supported** field count, not the
    // total. 0 supported → seed nothing + mark decided so a "Create 0
    // questions" modal never fires for a database of only unsupported
    // types (Rollup-only, etc.). 1-2 supported → adopt them silently.
    // 3+ → fall through to the modal so the user picks.
    //
    // Mirrors the desktop `_evaluateAutoCreatePromptAfterHydration`
    // rule. Keeping the two in lockstep.
    if (fieldCount <= 2) {
      if (fieldCount > 0) {
        writer.populateFromFields(supportedFieldIds);
      }
      writer.markDecided();
      return;
    }

    setShowModal(true);
  }, [
    readOnly,
    hydrated,
    snapshot.decided,
    snapshot.questions.length,
    fields,
    fieldCount,
    supportedFieldIds,
    writer,
  ]);

  if (!showModal) return null;
  // Tap-outside or Esc → treat as Start-from-scratch (cleanest default;
  // the user explicitly didn't pick Create-N). Matches the desktop's
  // `FormAutoCreateDialog.show` barrier policy.
  const dismissAsScratch = () => {
    writer.clearQuestions();
    writer.markDecided();
    setShowModal(false);
  };

  return (
    <Dialog
      open={showModal}
      onClose={dismissAsScratch}
      PaperProps={{ className: 'max-w-md w-full' }}
    >
      <div className='flex flex-col items-center gap-4 px-6 py-6 text-center'>
        <div className='flex items-center gap-3 text-text-caption'>
          <Table2 size={24} />
          <ArrowRight size={16} />
          <FileText size={24} />
        </div>
        <h2 className='text-lg font-semibold'>
          Auto-create form questions based on existing properties?
        </h2>
        <p className='text-sm text-text-caption'>
          Only supported property types will create new questions.
        </p>
        <Button
          className='w-full'
          onClick={() => {
            writer.populateFromFields(supportedFieldIds);
            writer.markDecided();
            setShowModal(false);
          }}
        >
          {fieldCount === 1
            ? 'Create 1 question'
            : `Create ${fieldCount} questions`}
        </Button>
        <button
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
