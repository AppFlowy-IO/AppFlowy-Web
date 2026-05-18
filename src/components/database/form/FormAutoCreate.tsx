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
import { Dialog, DialogContent } from '@/components/ui/dialog';

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
    if (snapshot.decided) {
      evaluated.current = true;
      return;
    }

    if (snapshot.questions.length > 0) {
      evaluated.current = true;
      return;
    }

    // Wait for fields to hydrate. Until at least one field surfaces we
    // can't tell sidebar-create (≤ 2 fields) from linked-view (> 2).
    if (!fields || fieldCount === 0) return;
    evaluated.current = true;

    if (fieldCount <= 2) {
      // Sidebar-create silent seed.
      writer.populateFromFields(supportedFieldIds);
      writer.markDecided();
      return;
    }

    setShowModal(true);
  }, [
    readOnly,
    snapshot.decided,
    snapshot.questions.length,
    fields,
    fieldCount,
    supportedFieldIds,
    writer,
  ]);

  if (!showModal) return null;
  return (
    <Dialog
      open={showModal}
      onOpenChange={(open) => {
        if (open) return;
        // Tap-outside or Esc → treat as Start-from-scratch (cleanest
        // default; the user explicitly didn't pick Create-N). Matches
        // the desktop's `FormAutoCreateDialog.show` barrier policy.
        writer.clearQuestions();
        writer.markDecided();
        setShowModal(false);
      }}
    >
      <DialogContent className='max-w-md'>
        <div className='flex flex-col items-center gap-4 px-2 py-4 text-center'>
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
            onClick={() => {
              writer.clearQuestions();
              writer.markDecided();
              setShowModal(false);
            }}
            className='text-sm text-text-caption hover:underline'
          >
            Start from scratch
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
