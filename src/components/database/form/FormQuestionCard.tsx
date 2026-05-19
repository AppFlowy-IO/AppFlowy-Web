import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Star,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import { memo, useState } from 'react';

import { useFormWriter } from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
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
// stable-by-identity — the writer from `useFormWriter()` is memoized
// on view id — so default shallow equality is sufficient. Drag wiring
// lives one level up (on the wrapper `<div>` in
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
  isRichText,
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
  isRichText: boolean;
}) {
  const writer = useFormWriter();
  // Tracks ONLY the dropdown's open state — needed so the 3-dot
  // trigger stays visible while the menu is open even if the user
  // moves the cursor off the card. Border color and trigger visibility
  // for the *unopened* state are driven by Tailwind `group-hover:`
  // (no React state → no re-render per mouse-enter / leave on every
  // card in the list).
  const [menuOpen, setMenuOpen] = useState(false);
  const helper = helperText(fieldType);
  const isSelect =
    fieldType === FieldType.SingleSelect ||
    fieldType === FieldType.MultiSelect;

  return (
    <div data-testid='form-question-card' className='group relative rounded-md border border-line-divider px-5 py-4 transition-colors hover:cursor-grab hover:border-fill-default'>
      {/*
        Stop mouse-down here so clicking the 3-dot trigger doesn't
        race the RBD drag sensor (which is bound to this card's
        wrapper `<div>` — see `DraggableQuestionList`).
      */}
      <div
        className='absolute right-3 top-3'
        onMouseDownCapture={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'transition-opacity group-hover:opacity-100',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              aria-label='Question options'
              className='rounded p-1 hover:bg-fill-content'
            >
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
              <DropdownMenuItem
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
                <Switch checked={required} />
              </DropdownMenuItem>
              <DropdownMenuItem
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
                <Switch checked={descriptionVisible} />
              </DropdownMenuItem>
              {isRichText && (
                <DropdownMenuItem
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
                  <Switch checked={longAnswer} />
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => writer.reorderQuestion(questionId, index - 1)}
              >
                <ArrowUp size={14} />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === questionCount - 1}
                onSelect={() => writer.reorderQuestion(questionId, index + 1)}
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
        <FieldTypeIcon
          type={fieldType}
          className='h-4 w-4 shrink-0 text-text-tertiary'
        />
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
      {helper && (
        <p className='mt-1 text-xs text-text-caption'>{helper}</p>
      )}

      {descriptionVisible && (
        <Input
          variant='ghost'
          value={description}
          onChange={(e) => writer.setDescription(questionId, e.target.value)}
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
        {isSelect ? (
          <FormSelectOptionsEditor fieldId={questionId} />
        ) : (
          <FormQuestionPlaceholder fieldType={fieldType} longAnswer={longAnswer} />
        )}
      </div>
    </div>
  );
}

/// Helper subtitle shown between the question title and its body. Single-
/// select reads "up to 1"; multi-value pickers (multi-select, relation,
/// person) read "as many as they like". Returns `null` for types where
/// the affordance is self-evident (text/number/date/checkbox/url/files).
function helperText(fieldType: FieldType): string | null {
  if (fieldType === FieldType.SingleSelect) {
    return 'Respondents can select up to 1';
  }

  if (
    fieldType === FieldType.MultiSelect ||
    fieldType === FieldType.Relation ||
    fieldType === FieldType.Person
  ) {
    return 'Respondents can select as many as they like';
  }

  return null;
}
