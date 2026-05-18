import { Dialog } from '@mui/material';
import { ArrowRight, FileText, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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

  // Refresh race guard. On a refreshed page the YJS doc applies
  // asynchronously: the React tree mounts before the persisted
  // `__form_decided__` sentinel arrives over the wire. Desktop's
  // `form_page.dart:_evaluateAutoCreatePromptOnce` awaits an
  // explicit `_overrides.hydrated` future before deciding; our
  // analog is a one-render delay — `useEffect` with no deps fires
  // after the first commit, by which point an in-flight Y.applyUpdate
  // for the same tick has already flushed through the observer.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const supportedFieldIds = useMemo(() => {
    if (!fields) return [];
    const out: string[] = [];

    fields.forEach((field, id) => {
      if (typeof id !== 'string') return;
      const ty = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (SUPPORTED_TYPES.has(ty)) out.push(id);
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
    if (readOnly || !hydrated) return;
    if (snapshot.decided || snapshot.questions.length > 0) return;
    if (!fields) return;
    if (fieldCount > 2) return;
    if (fieldCount > 0) writer.populateFromFields(supportedFieldIds);
    writer.markDecided();
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

  // Modal visibility is derived, not imperative. When the user picks
  // Create-N / Start-from-scratch (or a remote sync delivers a
  // previously-persisted decision), `writer.markDecided()` flips
  // `snapshot.decided` and this expression evaluates false on the
  // same render — no auto-dismiss effect, no flash.
  const showDialog =
    !readOnly &&
    hydrated &&
    !snapshot.decided &&
    snapshot.questions.length === 0 &&
    fieldCount > 2;

  if (!showDialog) return null;

  // Tap-outside or Esc → treat as Start-from-scratch (cleanest default;
  // the user explicitly didn't pick Create-N). Matches the desktop's
  // `FormAutoCreateDialog.show` barrier policy.
  const dismissAsScratch = () => {
    writer.clearQuestions();
    writer.markDecided();
  };

  return (
    <Dialog
      open={true}
      onClose={dismissAsScratch}
      PaperProps={DIALOG_PAPER_PROPS}
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
