import { ArrowDown, ArrowUp, MoreHorizontal, Star, Trash2, Type as TypeIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import type { YDatabaseField } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { FormQuestionPlaceholder } from './FormQuestionPlaceholder';
import { FormSelectOptionsEditor } from './FormSelectOptionsEditor';
import type { AddFormSelectOption } from './FormSelectOptionsEditor';

const DESCRIPTION_DEBOUNCE_MS = 500;

/**
 * Editable per-question card. Wraps the read-only visual scaffolding
 * (`FormQuestionCardReadOnly`) and layers on:
 *
 *   - Required asterisk on the title (driven by the `required` toggle)
 *   - Inline "Add description" row when `descriptionVisible` is ON
 *   - Hover-only 3-dot menu (Required / Description / Long answer / Move /
 *     Remove from form), mirroring the desktop's `FormQuestionMenu`
 *
 * Move-up / move-down call into the writer's `reorderQuestion` so the
 * `order` re-packing logic stays in one place.
 */
// Memoized so toggling Required / Description on one card doesn't
// re-render every other card. All props are primitives or
// stable-by-identity — the parent passes one writer and one select-option
// dispatcher for the active view — so default shallow equality is sufficient.
// Drag wiring lives one level up (on the wrapper `<div>` in
// `FormBuilderView.tsx::DraggableQuestionList`), so RBD's
// fresh-each-render props never reach this component.
export const FormQuestionCard = memo(_FormQuestionCard);

function _FormQuestionCard({
  questionId,
  name,
  fieldType,
  required,
  description,
  descriptionVisible,
  longAnswer,
  index,
  questionCount,
  visibleQuestionIds,
  isRichText,
  selectField,
  addSelectOption,
  writer,
  canWriteRef = ALWAYS_WRITABLE,
}: {
  questionId: string;
  name: string;
  fieldType: FieldType;
  required: boolean;
  description: string;
  descriptionVisible: boolean;
  longAnswer: boolean;
  index: number;
  questionCount: number;
  visibleQuestionIds?: readonly string[];
  isRichText: boolean;
  selectField?: YDatabaseField;
  addSelectOption: AddFormSelectOption;
  writer: FormWriter;
  /** Current page permission, shared by the parent across branch unmounts. */
  canWriteRef?: React.RefObject<boolean>;
}) {
  // Tracks ONLY the dropdown's open state — needed so the 3-dot
  // trigger stays visible while the menu is open even if the user
  // moves the cursor off the card. Border color and trigger visibility
  // for the *unopened* state are driven by Tailwind `group-hover:`
  // (no React state → no re-render per mouse-enter / leave on every
  // card in the list).
  const [menuOpen, setMenuOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const descriptionDraftRef = useRef(description);
  const lastCommittedDescription = useRef(description);
  const descriptionFocusedRef = useRef(false);
  const descriptionDirtyRef = useRef(false);
  const deferredExternalDescriptionRef = useRef<string | null>(null);
  const descriptionVisibleRef = useRef(descriptionVisible);
  const descriptionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helper = helperText(fieldType);
  const isSelect = fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect;

  const clearDescriptionTimer = useCallback(() => {
    if (!descriptionTimer.current) return;
    clearTimeout(descriptionTimer.current);
    descriptionTimer.current = null;
  }, []);

  const commitDescription = useCallback(
    (value: string) => {
      clearDescriptionTimer();
      deferredExternalDescriptionRef.current = null;
      descriptionDirtyRef.current = false;
      if (!canWriteRef.current) return;
      if (value === lastCommittedDescription.current) return;
      lastCommittedDescription.current = value;
      writer.setDescription(questionId, value);
    },
    [canWriteRef, clearDescriptionTimer, questionId, writer]
  );
  const commitDescriptionRef = useRef(commitDescription);

  // Cleanup must observe only committed props/callbacks. Assigning these refs
  // during render could leak an abandoned concurrent render into the mounted
  // card's navigation-time flush.
  useLayoutEffect(() => {
    commitDescriptionRef.current = commitDescription;
    descriptionVisibleRef.current = descriptionVisible;
  }, [commitDescription, descriptionVisible]);

  useEffect(() => {
    if (description === lastCommittedDescription.current) return;
    lastCommittedDescription.current = description;
    if (descriptionFocusedRef.current) {
      deferredExternalDescriptionRef.current = description;
      return;
    }

    clearDescriptionTimer();
    descriptionDirtyRef.current = false;
    deferredExternalDescriptionRef.current = null;
    descriptionDraftRef.current = description;
    setDescriptionDraft(description);
  }, [clearDescriptionTimer, description]);

  const flushDescriptionOnUnmount = useCallback(() => {
    // Desktop writes this field through on every keystroke. Web batches the
    // same Yjs mutation for 500ms, so navigation must flush the final draft
    // instead of cancelling it. The writer's membership guard makes this a
    // safe no-op when the card unmounted because the question was removed.
    if (canWriteRef.current && descriptionVisibleRef.current && descriptionDirtyRef.current) {
      commitDescriptionRef.current(descriptionDraftRef.current);
    } else {
      clearDescriptionTimer();
    }
  }, [canWriteRef, clearDescriptionTimer]);

  useEffect(() => flushDescriptionOnUnmount, [flushDescriptionOnUnmount]);

  // A remote visibility change can remove the input without unmounting the
  // card. Cancel its draft instead of letting a late timer call
  // `setDescription`, which would make the writer turn the description back
  // on. Blur still flushes ordinary local focus changes.
  useEffect(() => {
    if (!descriptionVisible) {
      clearDescriptionTimer();
      descriptionDirtyRef.current = false;
      deferredExternalDescriptionRef.current = null;
    }
  }, [clearDescriptionTimer, descriptionVisible]);

  return (
    <div
      data-testid='form-question-card'
      data-required={required ? 'true' : 'false'}
      data-description-visible={descriptionVisible ? 'true' : 'false'}
      data-long-answer={longAnswer ? 'true' : 'false'}
      className='group relative rounded-md border border-line-divider px-5 py-4 transition-colors hover:cursor-grab hover:border-fill-default'
    >
      {/*
        Stop mouse-down here so clicking the 3-dot trigger doesn't
        race the RBD drag sensor (which is bound to this card's
        wrapper `<div>` — see `DraggableQuestionList`).
      */}
      <div className='absolute right-3 top-3' onMouseDownCapture={(e) => e.stopPropagation()}>
        <div className={cn('transition-opacity group-hover:opacity-100', menuOpen ? 'opacity-100' : 'opacity-0')}>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              data-testid='form-question-menu-trigger'
              aria-label='Question options'
              className='rounded p-1 hover:bg-fill-content'
            >
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
              <DropdownMenuItem
                role='menuitemcheckbox'
                aria-checked={required}
                onSelect={(e) => {
                  e.preventDefault();
                  writer.setRequired(questionId, !required);
                }}
                className='flex items-center justify-between'
              >
                <span className='flex items-center gap-2'>
                  <Star size={14} />
                  Required
                </span>
                <Switch aria-hidden tabIndex={-1} className='pointer-events-none' checked={required} />
              </DropdownMenuItem>
              <DropdownMenuItem
                role='menuitemcheckbox'
                aria-checked={descriptionVisible}
                onSelect={(e) => {
                  e.preventDefault();
                  writer.setDescriptionVisible(questionId, !descriptionVisible);
                }}
                className='flex items-center justify-between'
              >
                <span className='flex items-center gap-2'>
                  <TypeIcon size={14} />
                  Description
                </span>
                <Switch aria-hidden tabIndex={-1} className='pointer-events-none' checked={descriptionVisible} />
              </DropdownMenuItem>
              {isRichText && (
                <DropdownMenuItem
                  role='menuitemcheckbox'
                  aria-checked={longAnswer}
                  onSelect={(e) => {
                    e.preventDefault();
                    writer.setLongAnswer(questionId, !longAnswer);
                  }}
                  className='flex items-center justify-between'
                >
                  <span className='flex items-center gap-2'>
                    <TypeIcon size={14} />
                    Long answer
                  </span>
                  <Switch aria-hidden tabIndex={-1} className='pointer-events-none' checked={longAnswer} />
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => writer.reorderQuestion(questionId, index - 1, visibleQuestionIds)}
              >
                <ArrowUp size={14} />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === questionCount - 1}
                onSelect={() => writer.reorderQuestion(questionId, index + 1, visibleQuestionIds)}
              >
                <ArrowDown size={14} />
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                // Notion-parity copy. Removes only the projection entry —
                // the underlying database field stays in the Grid tab.
                onSelect={() => writer.removeQuestion(questionId)}
                className='text-fill-default focus:text-fill-default'
              >
                <Trash2 size={14} />
                Remove from form
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className='flex items-center gap-1.5 pr-8'>
        <FieldTypeIcon type={fieldType} className='h-4 w-4 shrink-0 text-text-tertiary' />
        <h2 className='text-base font-semibold'>{name}</h2>
        {required && (
          <span className='ml-0.5 text-fill-default' aria-label='required'>
            *
          </span>
        )}
      </div>

      {/*
        Helper subtitle — matches the desktop's `_PreviewQuestionCard._helperText`
        and Notion's authoring card. Single-select reads
        "Respondents can select up to 1"; multi-select / relation /
        person read "Respondents can select as many as they like".
        Other types don't surface a helper because the affordance
        (e.g. single text input) is self-evident from the placeholder.
      */}
      {helper && <p className='mt-1 text-xs text-text-caption'>{helper}</p>}

      {descriptionVisible && (
        <Input
          variant='ghost'
          value={descriptionDraft}
          onChange={(e) => {
            const value = e.target.value;

            setDescriptionDraft(value);
            descriptionDraftRef.current = value;
            descriptionDirtyRef.current = true;
            clearDescriptionTimer();
            descriptionTimer.current = setTimeout(() => {
              descriptionTimer.current = null;
              commitDescription(value);
            }, DESCRIPTION_DEBOUNCE_MS);
          }}
          onFocus={() => {
            descriptionFocusedRef.current = true;
          }}
          onBlur={() => {
            descriptionFocusedRef.current = false;
            if (descriptionDirtyRef.current) {
              commitDescription(descriptionDraftRef.current);
              return;
            }

            const deferred = deferredExternalDescriptionRef.current;

            if (deferred === null) return;
            deferredExternalDescriptionRef.current = null;
            descriptionDraftRef.current = deferred;
            setDescriptionDraft(deferred);
          }}
          // The whole card is RBD's drag activator (see
          // `DraggableQuestionList`). Without stopping mouse-down on
          // the input, dragging across the description text starts
          // a card reorder instead of selecting characters. Capture
          // phase so the stop happens before RBD's sensor fires.
          onMouseDownCapture={(e) => e.stopPropagation()}
          placeholder='Add description'
          className='mt-1 italic'
        />
      )}

      <div className='mt-3'>
        {/*
          Single-/Multi-select questions render an editable option list
          (Notion / desktop parity). All other types stay as static
          placeholders since their value space isn't authorable from
          inside the form card — RichText needs the cell, Date is a
          calendar, etc.
        */}
        {isSelect && selectField ? (
          <FormSelectOptionsEditor fieldId={questionId} field={selectField} addOption={addSelectOption} />
        ) : (
          <FormQuestionPlaceholder fieldType={fieldType} longAnswer={longAnswer} />
        )}
      </div>
    </div>
  );
}

const ALWAYS_WRITABLE: React.RefObject<boolean> = { current: true };

/// Helper subtitle shown between the question title and its body. Single-
/// select reads "up to 1"; multi-value pickers (multi-select, relation,
/// person) read "as many as they like". Returns `null` for types where
/// the affordance is self-evident (text/number/date/checkbox/url/files).
function helperText(fieldType: FieldType): string | null {
  if (fieldType === FieldType.SingleSelect) {
    return 'Respondents can select up to 1';
  }

  if (fieldType === FieldType.MultiSelect || fieldType === FieldType.Relation || fieldType === FieldType.Person) {
    return 'Respondents can select as many as they like';
  }

  return null;
}
