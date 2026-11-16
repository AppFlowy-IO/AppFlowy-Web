import { ReactComponent as TypeIcon } from '@/assets/icons/long_text.svg';
import { ReactComponent as Trash2 } from '@/assets/icons/delete.svg';
import { ReactComponent as Star } from '@/assets/icons/star.svg';
import { ReactComponent as MoreHorizontal } from '@/assets/icons/more.svg';
import { ReactComponent as List } from '@/assets/icons/list.svg';
import { ReactComponent as ArrowUp } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as ArrowDown } from '@/assets/icons/arrow_down.svg';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import type { YDatabaseField } from '@/application/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { FormQuestionTitle } from './FormQuestionTitle';
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
  // Desktop visibility follows the pointer, independently of the popup.
  // Touch/pen users retain the mounted control after their first contact.
  const [usesTouchInput, setUsesTouchInput] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const descriptionDraftRef = useRef(description);
  const lastCommittedDescription = useRef(description);
  const descriptionFocusedRef = useRef(false);
  const descriptionDirtyRef = useRef(false);
  const deferredExternalDescriptionRef = useRef<string | null>(null);
  const descriptionVisibleRef = useRef(descriptionVisible);
  const descriptionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      onPointerDownCapture={(event) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') setUsesTouchInput(true);
      }}
      className='group relative rounded-xl border border-border-primary px-4 py-3 transition-colors hover:cursor-grab hover:border-border-theme-thick'
    >
      {/*
        Stop mouse-down here so clicking the 3-dot trigger doesn't
        race the RBD drag sensor (which is bound to this card's
        wrapper `<div>` — see `DraggableQuestionList`).
      */}
      <div className='absolute right-4 top-3' onMouseDownCapture={(e) => e.stopPropagation()}>
        <div
          className={cn(
            'transition-opacity [transition-duration:120ms] group-hover:opacity-100 has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100',
            usesTouchInput ? 'opacity-100' : 'opacity-0'
          )}
        >
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              data-testid='form-question-menu-trigger'
              aria-label='Question options'
              className='flex h-8 w-8 items-center justify-center rounded-md p-1.5 text-text-secondary hover:bg-fill-content-hover hover:text-icon-primary'
            >
              <MoreHorizontal className='h-5 w-5' />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side='bottom'
              align='end'
              sideOffset={0}
              className='max-h-[var(--radix-dropdown-menu-content-available-height)] w-60'
            >
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
                  <Star className='h-5 w-5 text-text-secondary' />
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
                  <List className='h-5 w-5 text-text-secondary' />
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
                    <TypeIcon className='h-5 w-5 text-text-secondary' />
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
                <ArrowUp className='h-5 w-5 text-text-secondary' />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === questionCount - 1}
                onSelect={() => writer.reorderQuestion(questionId, index + 1, visibleQuestionIds)}
              >
                <ArrowDown className='h-5 w-5 text-text-secondary' />
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                // Notion-parity copy. Removes only the projection entry —
                // the underlying database field stays in the Grid tab.
                onSelect={() => writer.removeQuestion(questionId)}
                variant='destructive'
              >
                <Trash2 className='h-5 w-5' />
                Remove from form
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <FormQuestionTitle name={name} fieldType={fieldType} required={required} reserveMenu />

      {descriptionVisible && (
        <TextareaAutosize
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
          className='mt-1 !px-0 !py-0 text-sm italic'
        />
      )}

      <div className='mt-4'>
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
