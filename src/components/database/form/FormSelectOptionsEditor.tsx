import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  parseSelectOptionTypeOptions,
  useAddSelectOption,
  useDatabaseFields,
  useDatabaseFieldsVersion,
} from '@/application/database-yjs';
import {
  generateOptionId,
  getColorByOption,
} from '@/application/database-yjs/fields/select-option/utils';
import { Tag } from '@/components/_shared/tag';
import {
  SelectOptionColorMap,
  SelectOptionFgColorMap,
} from '@/components/database/components/cell/cell.const';

/**
 * Editable option list shown inside the form-builder card for
 * Single-/Multi-select questions. Mirror of the desktop's
 * `_MultiChoiceBody` widget (`form_question_body.dart`): the creator
 * sees existing options as chips and a "+ Add option" affordance that
 * expands inline into a text input.
 *
 * Persistence goes through `useAddSelectOption`, the same path the
 * grid header's type-option editor uses — so chip colors / IDs stay
 * consistent across the form-builder and Grid view, and a desktop
 * client editing the same field sees the new option immediately.
 *
 * F1 scope: add only. Rename / reorder / delete still happen via the
 * Grid header's option editor (the desktop's inline 3-dot per chip is
 * a follow-up).
 */
export function FormSelectOptionsEditor({ fieldId }: { fieldId: string }) {
  const fields = useDatabaseFields();
  // `fieldsVersion` invalidates the option list when any field mutates —
  // including the type-option blob we're about to read. Y.Map identity
  // alone is stable across mutations.
  const fieldsVersion = useDatabaseFieldsVersion();
  const addOption = useAddSelectOption(fieldId);

  const options = useMemo(() => {
    if (!fields) return [];
    const field = fields.get(fieldId);

    if (!field) return [];
    return parseSelectOptionTypeOptions(field).options ?? [];
    // `fieldsVersion` is an invalidation token (see useDatabaseFieldsVersion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldId, fieldsVersion]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const submit = () => {
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
    const exists = options.some(
      (o) => o.name.toLowerCase() === value.toLowerCase(),
    );

    if (exists) {
      setDraft('');
      // Stay in editing mode so the creator can correct the name.
      inputRef.current?.focus();
      return;
    }

    addOption({
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
    <div className='flex flex-col items-start gap-1.5'>
      {options.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {options.map((opt) => (
            <Tag
              key={opt.id}
              label={opt.name}
              bgColor={SelectOptionColorMap[opt.color]}
              textColor={SelectOptionFgColorMap[opt.color]}
            />
          ))}
        </div>
      )}
      {editing ? (
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
          placeholder='Option name'
          className='w-full rounded border border-line-divider bg-transparent px-2 py-1 text-sm outline-none focus:border-fill-default'
        />
      ) : (
        <button
          type='button'
          onClick={() => setEditing(true)}
          className='inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-text-tertiary hover:text-text-primary'
        >
          <Plus size={12} />
          Add option
        </button>
      )}
    </div>
  );
}
