import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from 'react-beautiful-dnd';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
  useFormWriter,
} from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { YjsDatabaseKey } from '@/application/types';

import { FormAutoCreate } from './FormAutoCreate';
import { FormAccessBanner } from './FormAccessBanner';
import { FormFormDescription } from './FormFormDescription';
import { FormPreviewButton } from './FormPreviewButton';
import { FormQuestionCard } from './FormQuestionCard';
import { FormQuestionCardReadOnly } from './FormQuestionCardReadOnly';
import { FormQuestionTypePicker } from './FormQuestionTypePicker';
import { FormShareButton } from './FormShareButton';
import { FormShareProvider } from './FormShareContext';
import { FormTitle } from './FormTitle';

/**
 * Top-level form-builder view. Mirrors the desktop's `FormBuilderPage`:
 *
 *   ┌─ toolbar ──────────────────── Preview · Share form ┐
 *   │  Form                                              │
 *   │  Description (optional)                            │
 *   │  ┌─ access banner ────────────────────── Change ─┐ │
 *   │  │ 🔒 Only members at <ws> can fill out this form │
 *   │  └────────────────────────────────────────────────┘ │
 *   │  ┌─ question 1 ───────────────────────────── ⋮ ─┐  │
 *   │  ┌─ question 2 ──────────────────────────────────┐ │
 *   │             + Add question                        │
 *   └────────────────────────────────────────────────────┘
 *
 * The auto-create modal (`FormAutoCreate`) is mounted unconditionally
 * — it self-evaluates on hydrate and renders nothing when the form's
 * already decided.
 */
export function FormBuilderView() {
  const ctx = useDatabaseContextOptional();
  const readOnly = ctx?.readOnly ?? false;

  // The share-state hook only matters when authoring chrome is mounted;
  // skip the bootstrap fetch in respondent / view-only mode by gating the
  // provider on `readOnly`.
  if (readOnly) {
    return <FormBuilderBody readOnly />;
  }

  return (
    <FormShareProvider>
      <FormBuilderBody readOnly={false} />
    </FormShareProvider>
  );
}

function FormBuilderBody({ readOnly }: { readOnly: boolean }) {
  const snapshot = useFormLayoutSnapshot();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const writer = useFormWriter();

  // Resolve every `field_id` in the projection to its on-disk field.
  // Orphans (entries whose underlying field was deleted from a Grid
  // tab) are skipped in render; the next mutation prunes them via
  // the rust orphan-removal pass on the server side. We don't auto-
  // purge here because that would race with concurrent writes from
  // other clients.
  //
  // `fieldsVersion` is included in the deps because the `fields` Y.Map
  // identity is stable across mutations — without the version bump,
  // renaming or retyping an off-form field would never refresh the
  // resolved name surfaced on the question card.
  const resolved = useMemo(() => {
    if (!fields) return [];
    return snapshot.questions
      .map((q) => {
        const field = fields.get(q.fieldId);

        if (!field) return null;
        const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

        return {
          questionId: q.fieldId,
          name: field.get(YjsDatabaseKey.name) || 'Untitled question',
          fieldType,
          required: q.required,
          description: q.description,
          descriptionVisible: q.descriptionVisible,
          longAnswer: q.longAnswer,
          isRichText: fieldType === FieldType.RichText,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    // `fieldsVersion` is an invalidation token (see useDatabaseFieldsVersion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, fields, fieldsVersion]);

  // Drag-to-reorder hook. `react-beautiful-dnd` passes the source +
  // destination as zero-based indices into the visible item list; we
  // forward to `writer.reorderQuestion` which mutates the per-view
  // `form_field_settings.questions` order. Mirrors the desktop's
  // `FormQuestionOverridesService.reorderQuestion` semantics.
  //
  // `resolved` is in a `useRef` (not a `useCallback` dep) so the
  // callback identity is stable across snapshot mutations. Without
  // this, every keystroke into any question's title would recreate
  // the handler and rebind it on `<DragDropContext onDragEnd>`. The
  // ref pattern is the `advanced-use-latest` rule from the perf guide.
  const resolvedRef = useRef(resolved);

  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  const handleReorder = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const from = result.source.index;
      const to = result.destination.index;

      if (from === to) return;
      const questionId = resolvedRef.current[from]?.questionId;

      if (!questionId) return;
      writer.reorderQuestion(questionId, to);
    },
    // `writer` is memoized on view identity in `useFormWriter`, so
    // this callback only changes on a view swap — never on snapshot
    // updates.
    [writer],
  );

  return (
    <div className='mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10'>
      {/*
        Toolbar / banner / auto-create modal are authoring-only. A
        respondent / view-only member sees the same questions but none
        of the editor chrome — same posture as the desktop's
        `_FormToolbar` and `_FormAccessBanner` gating on read-only.
      */}
      {!readOnly && (
        <header className='flex items-center justify-end gap-2'>
          <FormPreviewButton />
          <FormShareButton />
        </header>
      )}
      <FormTitle readOnly={readOnly} />
      <FormFormDescription
        description={snapshot.description}
        readOnly={readOnly}
        onChange={writer.setFormDescription}
      />
      {!readOnly && <FormAccessBanner />}
      {!readOnly && <FormAutoCreate />}

      {resolved.length === 0 ? (
        <EmptyState decided={snapshot.decided} readOnly={readOnly} />
      ) : readOnly ? (
        <div className='flex flex-col gap-3'>
          {resolved.map((q) => (
            <FormQuestionCardReadOnly
              key={q.questionId}
              name={q.name}
              fieldType={q.fieldType}
              required={q.required}
              description={q.descriptionVisible ? q.description : ''}
              longAnswer={q.longAnswer}
            />
          ))}
        </div>
      ) : (
        <DraggableQuestionList
          questions={resolved}
          onReorder={handleReorder}
        />
      )}

      {!readOnly && <FormQuestionTypePicker />}
    </div>
  );
}

type ResolvedQuestion = {
  questionId: string;
  name: string;
  fieldType: FieldType;
  required: boolean;
  description: string;
  descriptionVisible: boolean;
  longAnswer: boolean;
  isRichText: boolean;
};

/**
 * Question stack wrapped in a `react-beautiful-dnd` drag context.
 * Mirrors the desktop's `ReorderableListView.builder`. The entire
 * card body is the drag activator (`dragHandleProps` spread on the
 * wrapper `<div>`, not on a separate grip glyph) — matches the
 * desktop's `LongPressDraggable` over the whole card.
 *
 * Interactive descendants inside the card (the description input,
 * the inline option-add input, the 3-dot menu trigger) stop
 * propagation on mouse-down so RBD's sensor doesn't see them and
 * start a drag instead of a click / text-selection. See
 * `FormQuestionCard.tsx` and `FormSelectOptionsEditor.tsx`.
 *
 * The container reuses the same `flex flex-col gap-3` rhythm as the
 * read-only branch so the layout doesn't shift when toggling between
 * editor and viewer modes.
 */
function DraggableQuestionList({
  questions,
  onReorder,
}: {
  questions: ResolvedQuestion[];
  onReorder: (result: DropResult) => void;
}) {
  return (
    <DragDropContext onDragEnd={onReorder}>
      <Droppable droppableId='form-question-stack'>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className='flex flex-col gap-3'
          >
            {questions.map((q, idx) => (
              <Draggable
                key={q.questionId}
                draggableId={q.questionId}
                index={idx}
              >
                {(draggable, snapshot) => (
                  <div
                    ref={draggable.innerRef}
                    {...draggable.draggableProps}
                    // Spread `dragHandleProps` here (not on a small
                    // grip glyph) so the ENTIRE card body is the drag
                    // activator — matches the desktop, which uses
                    // `LongPressDraggable` over the whole card. Users
                    // can grab any blank area of the card to reorder.
                    //
                    // Internal interactive widgets (toggles, the 3-dot
                    // menu, the description input) keep working because
                    // their click handlers run before the drag pan
                    // recognizer kicks in.
                    {...draggable.dragHandleProps}
                    className={snapshot.isDragging ? 'opacity-90' : ''}
                  >
                    <FormQuestionCard
                      questionId={q.questionId}
                      name={q.name}
                      fieldType={q.fieldType}
                      required={q.required}
                      description={q.description}
                      descriptionVisible={q.descriptionVisible}
                      longAnswer={q.longAnswer}
                      index={idx}
                      questionCount={questions.length}
                      isRichText={q.isRichText}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function EmptyState({
  decided,
  readOnly,
}: {
  decided: boolean;
  readOnly: boolean;
}) {
  // Three flavors of empty: decided + editor → invite to add; decided
  // + read-only → "no questions yet, ask the owner"; undecided →
  // "this form hasn't been set up yet".
  const copy = !decided
    ? 'This form hasn’t been set up yet.'
    : readOnly
      ? 'No questions yet.'
      : 'No questions yet. Use “+ Add question” to pick from existing properties.';

  return (
    <div className='rounded-md border border-dashed border-line-divider px-4 py-8 text-center text-sm text-text-caption'>
      {copy}
    </div>
  );
}
