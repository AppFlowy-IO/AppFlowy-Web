import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
  Droppable,
  DropResult,
} from 'react-beautiful-dnd';
import { createPortal } from 'react-dom';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
  useFormWriter,
} from '@/application/database-yjs';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useAddSelectOptionDispatch } from '@/application/database-yjs/dispatch';
import { isFormQuestionFieldType } from '@/application/database-yjs/form-field-types';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import type { YDatabaseField } from '@/application/types';

import { FormAccessBanner } from './FormAccessBanner';
import { FormAutoCreate } from './FormAutoCreate';
import { FormFormDescription } from './FormFormDescription';
import { FormPreviewButton } from './FormPreviewButton';
import { FormQuestionCard } from './FormQuestionCard';
import { FormQuestionCardReadOnly } from './FormQuestionCardReadOnly';
import { FormQuestionTypePicker } from './FormQuestionTypePicker';
import { FormRespondentTitle } from './FormRespondentTitle';
import { FormShareButton } from './FormShareButton';
import { FormShareProvider } from './FormShareContext';

import type { AddFormSelectOption } from './FormSelectOptionsEditor';

/**
 * Top-level form-builder view. Mirrors the desktop's `FormBuilderPage`:
 *
 *   ┌─ toolbar ──────────────────── Preview · Share form ┐
 *   │  Form title                                        │
 *   │  Description                                       │
 *   │  ┌─ access banner ────────────────────── Change ─┐ │
 *   │  │ 🔒 Only members at <ws> can fill out this form │
 *   │  └────────────────────────────────────────────────┘ │
 *   │  ┌─ question 1 ───────────────────────────── ⋮ ─┐  │
 *   │  ┌─ question 2 ──────────────────────────────────┐ │
 *   │             + Add question                        │
 *   └────────────────────────────────────────────────────┘
 *
 * The auto-create helper is mounted for every unresolved Form, including a
 * fresh view whose legacy projection temporarily exposes existing fields. It
 * removes its hydration subscription as soon as that one-time branch resolves.
 */
export function FormBuilderView() {
  const ctx = useDatabaseContextOptional();
  const readOnly = ctx?.readOnly ?? false;

  return (
    <FormShareProvider canUpdateSettings={ctx?.canShare === true}>
      <FormBuilderBody readOnly={readOnly} />
    </FormShareProvider>
  );
}

function FormBuilderBody({ readOnly }: { readOnly: boolean }) {
  const ctx = useDatabaseContextOptional();
  const snapshot = useFormLayoutSnapshot();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const writer = useFormWriter();
  const addSelectOption = useAddSelectOptionDispatch();
  const databaseId = ctx?.databaseDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database)
    ?.get(YjsDatabaseKey.id) as string | undefined;
  const activeViewId = ctx?.activeViewId;
  const loadView = ctx?.loadView;
  const [dismissedHydrationRequest, setDismissedHydrationRequest] = useState<(() => Promise<void>) | null>(null);
  const canWriteRef = useRef(!readOnly);

  // Commit before passive child cleanup runs. If a permission change replaces
  // the editable list, its unmount flush reads this value and cannot write
  // after access was revoked. A layout effect avoids leaking an abandoned
  // concurrent render into the currently committed cards.
  useLayoutEffect(() => {
    canWriteRef.current = !readOnly;
  }, [readOnly]);

  const ensureFormHydrated = useCallback(async () => {
    if (!loadView) {
      throw new Error('Form hydration is unavailable');
    }

    if (!activeViewId || !databaseId) {
      throw new Error('Database identity is unavailable for form hydration');
    }

    // An IndexedDB-backed database can render before realtime has reconciled
    // it with the server. Refresh the canonical metadata before the one-time
    // auto-create decision so a stale cache cannot overwrite a remote choice.
    await loadView(activeViewId, false, false, {
      databaseId,
      databaseMetadataOnly: true,
      forceFetch: true,
    });
  }, [activeViewId, databaseId, loadView]);
  const autoCreateDismissed = dismissedHydrationRequest === ensureFormHydrated;
  const autoCreatePending = !readOnly && !snapshot.decided && !autoCreateDismissed;

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

        // The legacy opt-out snapshot contains every field-order entry, while
        // the cloud exposes only respondent-editable field kinds. Apply the
        // shared cloud/desktop type allow-list before rendering authoring
        // cards so computed fields and the Form respondent field stay hidden.
        if (!isFormQuestionFieldType(fieldType)) return null;

        return {
          questionId: q.fieldId,
          name: field.get(YjsDatabaseKey.name) || 'Untitled question',
          fieldType,
          required: q.required,
          description: q.description,
          descriptionVisible: q.descriptionVisible,
          longAnswer: q.longAnswer,
          isRichText: fieldType === FieldType.RichText,
          selectField: fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect ? field : undefined,
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

  useLayoutEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  const handleReorder = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const visibleQuestionIds = resolvedRef.current.map((question) => question.questionId);
      const questionId = result.draggableId;
      const currentIndex = visibleQuestionIds.indexOf(questionId);
      const to = result.destination.index;

      // `source.index` belongs to the list snapshot where the drag began.
      // Another collaborator can insert, remove, or reorder questions before
      // drop, so resolve both identity and the no-op check against the latest
      // visible IDs instead.
      if (currentIndex === -1 || currentIndex === to) return;
      writer.reorderQuestion(questionId, to, visibleQuestionIds);
    },
    // `writer` is memoized on view identity in `useFormWriter`, so
    // this callback only changes on a view swap — never on snapshot
    // updates.
    [writer]
  );

  return (
    <div
      data-testid='form-builder-scroll-container'
      className='appflowy-scroller h-full min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden'
    >
      <div className='mx-auto flex min-h-full w-full max-w-2xl flex-col gap-4 px-6 py-10'>
        {/*
        Preview, share-link inspection, and the access banner remain visible
        to view-only members, matching Desktop. The provider and popovers use
        page permission to disable every mutation. Auto-create and question
        editing remain author-only.
      */}
        <header className='flex items-center justify-end gap-2'>
          <FormPreviewButton snapshot={snapshot} fieldsMap={fields} fieldsVersion={fieldsVersion} />
          <FormShareButton />
        </header>
        <section data-testid='form-respondent-copy' className='flex flex-col gap-1'>
          <FormRespondentTitle
            key={`respondent-title-${activeViewId ?? ''}`}
            title={snapshot.respondentTitle}
            readOnly={readOnly}
            onChange={writer.setRespondentTitle}
          />
          <FormFormDescription
            key={`form-description-${activeViewId ?? ''}`}
            description={snapshot.description}
            readOnly={readOnly}
            onChange={writer.setFormDescription}
          />
        </section>
        <FormAccessBanner />
        {autoCreatePending && (
          <FormAutoCreate
            snapshot={snapshot}
            fields={fields}
            fieldsVersion={fieldsVersion}
            writer={writer}
            ensureHydrated={ensureFormHydrated}
            onDismiss={() => setDismissedHydrationRequest(() => ensureFormHydrated)}
          />
        )}

        {autoCreatePending || resolved.length === 0 ? (
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
            writer={writer}
            addSelectOption={addSelectOption}
            canWriteRef={canWriteRef}
          />
        )}

        {!readOnly && !autoCreatePending && (
          <FormQuestionTypePicker fieldsMap={fields} fieldsVersion={fieldsVersion} snapshot={snapshot} writer={writer} />
        )}
      </div>
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
  selectField?: YDatabaseField;
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
  writer,
  addSelectOption,
  canWriteRef,
}: {
  questions: ResolvedQuestion[];
  onReorder: (result: DropResult) => void;
  writer: FormWriter;
  addSelectOption: AddFormSelectOption;
  canWriteRef: React.RefObject<boolean>;
}) {
  // Snapshot objects are rebuilt for any question setting mutation. Key the
  // shared ID array by its primitive sequence so toggling one card does not
  // invalidate the memoized props of every other card.
  const visibleQuestionIdsKey = questions.map((question) => question.questionId).join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleQuestionIds = useMemo(() => questions.map((question) => question.questionId), [visibleQuestionIdsKey]);

  return (
    <DragDropContext onDragEnd={onReorder}>
      <Droppable droppableId='form-question-stack'>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className='flex flex-col gap-3'>
            {questions.map((q, idx) => (
              <Draggable key={q.questionId} draggableId={q.questionId} index={idx}>
                {(draggable, snapshot) => (
                  <PortaledDraggable draggable={draggable} snapshot={snapshot}>
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
                      visibleQuestionIds={visibleQuestionIds}
                      isRichText={q.isRichText}
                      selectField={q.selectField}
                      addSelectOption={addSelectOption}
                      writer={writer}
                      canWriteRef={canWriteRef}
                    />
                  </PortaledDraggable>
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

function EmptyState({ decided, readOnly }: { decided: boolean; readOnly: boolean }) {
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

/**
 * Wraps each `<Draggable>` child so the dragging clone renders via a
 * portal to `document.body`.
 *
 * Why portal: `react-beautiful-dnd` positions the dragging item with
 * `position: fixed`. By CSS spec, `position: fixed` is relative to the
 * nearest ancestor that has `transform` / `filter` / `perspective` /
 * `will-change: transform` — NOT the viewport. AppFlowy's main layout
 * (`MainLayout.tsx`) applies the Tailwind `transform` class to its
 * scroll container, which establishes a transformed containing block
 * even when no translate is active. The dragging clone therefore
 * appears horizontally offset from the cursor (the bug from the
 * "Type" card screenshot).
 *
 * Portaling to `document.body` escapes that containing block, so the
 * `position: fixed` clone is computed against the viewport and tracks
 * the cursor correctly.
 *
 * Only the DRAGGING render uses the portal. In the static state the
 * draggable stays inside the column flow so the layout doesn't jump
 * on drag-end.
 */
function PortaledDraggable({
  draggable,
  snapshot,
  children,
}: {
  draggable: DraggableProvided;
  snapshot: DraggableStateSnapshot;
  children: React.ReactNode;
}) {
  const child = (
    <div
      ref={draggable.innerRef}
      {...draggable.draggableProps}
      // The whole card body is the drag activator. Internal interactive
      // widgets (toggles, 3-dot menu, description input) keep working
      // because their click handlers run before the drag pan recognizer
      // resolves.
      {...draggable.dragHandleProps}
      className={snapshot.isDragging ? 'opacity-90' : ''}
    >
      {children}
    </div>
  );

  if (!snapshot.isDragging) return child;
  return createPortal(child, document.body);
}
