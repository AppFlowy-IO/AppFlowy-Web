import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import type { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { generateOptionId, getColorByOption } from '@/application/database-yjs/fields/select-option/utils';
import type { YDatabaseField } from '@/application/types';

/**
 * Editable option list shown inside the form-builder card for
 * Single-/Multi-select questions. Mirror of the desktop's
 * `_MultiChoiceBody` widget (`form_question_body.dart`): the creator
 * sees existing options as radio/checkbox rows and a "+ Add option" affordance that
 * expands inline into a text input.
 *
 * Persistence goes through the parent's shared select-option dispatcher, the
 * same write path the grid header's type-option editor uses — so option IDs stay consistent across the form-builder and Grid view, and a desktop
 * client editing the same field sees the new option immediately.
 *
 * F1 scope: add only. Rename / reorder / delete still happen via the
 * Grid header's option editor (the desktop's inline 3-dot per chip is
 * a follow-up).
 */
type SelectOptionsStore = {
  getSnapshot: () => SelectOption[];
  subscribe: (onStoreChange: () => void) => () => void;
};

export type AddFormSelectOption = (fieldId: string, option: SelectOption) => void;

const stores = new WeakMap<YDatabaseField, SelectOptionsStore>();

function optionsEqual(a: readonly SelectOption[], b: readonly SelectOption[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((option, index) => {
    const other = b[index];

    return option.id === other.id && option.name === other.name && option.color === other.color;
  });
}

function createSelectOptionsStore(field: YDatabaseField): SelectOptionsStore {
  const subscribers = new Set<() => void>();
  let snapshot = parseSelectOptionTypeOptions(field).options ?? [];
  let observing = false;

  const refresh = () => {
    const next = parseSelectOptionTypeOptions(field).options ?? [];

    if (optionsEqual(snapshot, next)) return false;
    snapshot = next;
    return true;
  };

  const publish = () => {
    if (!refresh()) return;
    subscribers.forEach((subscriber) => subscriber());
  };

  return {
    getSnapshot: () => {
      // A render may be abandoned before subscribe() is installed. Always
      // refresh an unobserved store so that cached options cannot go stale.
      if (!observing) {
        refresh();
      }

      return snapshot;
    },
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      if (!observing) {
        observing = true;
        field.observeDeep(publish);
        if (refresh()) subscribers.forEach((subscriber) => subscriber());
      }

      return () => {
        subscribers.delete(onStoreChange);
        if (subscribers.size === 0 && observing) {
          observing = false;
          field.unobserveDeep(publish);
        }
      };
    },
  };
}

function useSelectOptions(field: YDatabaseField): SelectOption[] {
  let store = stores.get(field);

  if (!store) {
    store = createSelectOptionsStore(field);
    stores.set(field, store);
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function FormSelectOptionsEditor({
  fieldId,
  field,
  addOption,
  readOnly = false,
}: {
  fieldId: string;
  field: YDatabaseField;
  addOption: AddFormSelectOption;
  readOnly?: boolean;
}) {
  const options = useSelectOptions(field);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = () => {
    if (readOnly) return;
    const value = draft.trim();

    if (!value) {
      setEditing(false);
      setDraft('');
      return;
    }

    // De-dup by name (case-insensitive) matches Notion behaviour. The
    // YJS writer also bails on exact-name collisions but the local
    // case-insensitive check avoids a no-op round-trip and preserves
    // the input for the creator to edit.
    const exists = options.some((o) => o.name.toLowerCase() === value.toLowerCase());

    if (exists) {
      setDraft('');
      // Stay in editing mode so the creator can correct the name.
      inputRef.current?.focus();
      return;
    }

    addOption(fieldId, {
      id: generateOptionId(),
      name: value,
      color: getColorByOption(options),
    });
    setDraft('');
    // Stay open so the creator can add another option Notion-style.
    inputRef.current?.focus();
  };

  // No inner border — the parent `FormQuestionCard` already provides
  // the card border; nesting a second one read as a double-frame and
  // diverged from the desktop layout (see screenshot in the design
  // spec). Just stack the chip list (if any) and the affordance.
  return (
    <div className='flex w-full flex-col items-start gap-4'>
      {options.length > 0 && (
        <div className='flex w-full flex-col gap-2'>
          {options.map((opt) => (
            <div key={opt.id} className='flex min-h-6 items-center gap-1'>
              <span aria-hidden className='flex h-5 w-5 shrink-0 items-center justify-center'>
                <span
                  className={cn(
                    'h-3.5 w-3.5 border border-border-primary',
                    Number(field.get(YjsDatabaseKey.type)) === FieldType.MultiSelect ? 'rounded' : 'rounded-full'
                  )}
                />
              </span>
              <span className='min-w-0 break-words text-sm leading-5'>{opt.name}</span>
            </div>
          ))}
        </div>
      )}
      <div data-testid='form-add-option-row' className='flex w-full'>
        {editing && !readOnly ? (
          <div className='flex min-h-6 items-center gap-1 py-0.5'>
            <Plus size={20} className='shrink-0 text-text-tertiary' />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                  setDraft('');
                }
              }}
              onBlur={() => {
                // Commit on blur if there's pending text; otherwise close
                // the inline input. Matches the desktop affordance where
                // tabbing away saves any in-flight value.
                if (draft.trim()) {
                  submit();
                }

                setEditing(false);
              }}
              // Stop mouse-down so RBD's drag sensor (bound to the
              // enclosing card in `DraggableQuestionList`) doesn't start
              // a reorder when the creator clicks into the input or
              // selects text inside it.
              onMouseDownCapture={(e) => e.stopPropagation()}
              placeholder='Option name'
              className='h-5 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary'
            />
          </div>
        ) : (
          <button
            disabled={readOnly}
            type='button'
            onClick={() => setEditing(true)}
            className='inline-flex min-h-6 items-center gap-1 rounded py-0.5 text-sm text-text-tertiary hover:text-text-action disabled:pointer-events-none disabled:opacity-50'
          >
            <Plus size={20} />
            Add option
          </button>
        )}
      </div>
    </div>
  );
}
