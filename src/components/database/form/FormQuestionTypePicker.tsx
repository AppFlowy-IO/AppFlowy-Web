import { PlusCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
  useFormWriter,
} from '@/application/database-yjs';
import { useNewPropertyDispatch } from '@/application/database-yjs/dispatch';
import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * Field types the web form-builder ships custom rendering for. Mirrors
 * the desktop's `formQuestionFieldTypes` — same set so the two clients
 * never diverge on what counts as a "form-supported" type. Adding a
 * type here without also adding it on desktop (or vice versa) would let
 * one client author a question the other can't render.
 */
const FORM_QUESTION_FIELD_TYPES: FieldType[] = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.URL,
  FieldType.Media,
];

/// Notion's "Show N more" threshold (Image #8). Keeps the picker
/// compact for typical 5-7-field databases while still surfacing the
/// full list on demand for bigger ones.
const EXISTING_PREVIEW_LIMIT = 5;

/**
 * "+ Add question" button + two-section picker popover (Notion parity).
 *
 *   ┌─ Existing properties ─────────────────────────────────────┐
 *   │   ▸ Name (text)                                           │
 *   │   ▸ Type (single-select)                                  │
 *   │   ▸ Show 3 more                                           │
 *   ├─ New question ────────────────────────────────────────────┤
 *   │   ▸ Text                                                  │
 *   │   ▸ Multi-select                                          │
 *   │   …                                                       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Existing-property picks call `addQuestion` (no new field is created;
 * we just add a `FormQuestionPB` entry to this view's
 * `form_field_settings`). New-question picks must create a field on
 * the database first — but the web side doesn't have a "createField"
 * API today, so for M2 the New section opens a stub menu that
 * disables the option with a "Coming soon" tooltip. M3 wires the
 * field-create HTTP path.
 */
export function FormQuestionTypePicker() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const writer = useFormWriter();
  const fieldsMap = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const snapshot = useFormLayoutSnapshot();
  const createProperty = useNewPropertyDispatch();
  const { t } = useTranslation();

  // Build the "existing properties" candidate list. A field is a
  // candidate iff it's a supported type AND isn't already on the form.
  // `fieldsVersion` is included so the list refreshes when a field is
  // renamed, added, or retyped — Y.Map identity is stable so we can't
  // rely on `fieldsMap` alone for invalidation.
  const candidates = useMemo(() => {
    if (!fieldsMap) return [];
    const onFormIds = new Set(snapshot.questions.map((q) => q.fieldId));
    const out: { id: string; name: string; type: FieldType }[] = [];

    fieldsMap.forEach((field, fieldId) => {
      if (typeof fieldId !== 'string') return;
      if (onFormIds.has(fieldId)) return;
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

      if (!FORM_QUESTION_FIELD_TYPES.includes(fieldType)) return;
      out.push({
        id: fieldId,
        name: field.get(YjsDatabaseKey.name) || 'Untitled',
        type: fieldType,
      });
    });
    return out;
    // `fieldsVersion` is an invalidation token (see useDatabaseFieldsVersion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsMap, fieldsVersion, snapshot]);

  const showCollapse = candidates.length > EXISTING_PREVIEW_LIMIT;
  const visibleCandidates =
    showCollapse && !expanded
      ? candidates.slice(0, EXISTING_PREVIEW_LIMIT)
      : candidates;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid='form-add-question-button'
          type='button'
          className='mx-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-fill-default hover:bg-fill-content'
        >
          <PlusCircle size={16} />
          Add question
        </button>
      </PopoverTrigger>
      <PopoverContent align='center' className='w-72 p-1'>
        {candidates.length > 0 && (
          <>
            <SectionHeader label='Existing properties' />
            {visibleCandidates.map((c) => (
              <button
                key={c.id}
                type='button'
                onClick={() => {
                  writer.addQuestion(c.id);
                  setOpen(false);
                }}
                className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content'
              >
                <FieldTypeIcon
                  type={c.type}
                  className='h-4 w-4 shrink-0 text-text-tertiary'
                />
                <span className='flex-1 truncate'>{c.name}</span>
              </button>
            ))}
            {showCollapse && (
              <button
                type='button'
                onClick={() => setExpanded((v) => !v)}
                className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-text-caption hover:bg-fill-content'
              >
                {expanded
                  ? 'Show less'
                  : `Show ${candidates.length - EXISTING_PREVIEW_LIMIT} more`}
              </button>
            )}
            <div className='my-1 border-t border-line-divider' />
          </>
        )}
        <SectionHeader label='New question' />
        {/*
          Picking a New-question type creates a brand-new database field
          (via the existing `useNewPropertyDispatch` — direct YJS write
          to every linked view's `fields` / `field_orders` /
          `field_settings`) AND appends a `FormQuestionPB` entry to this
          form view's projection. The new property shows up in the Grid
          tab and every other form view, which is the same behavior the
          desktop's `_createAndAdd` ships.
        */}
        {FORM_QUESTION_FIELD_TYPES.map((ty) => (
          <button
            key={ty}
            data-testid={`form-question-type-option-${ty}`}
            type='button'
            onClick={() => {
              const newFieldId = createProperty(ty);

              writer.addQuestion(newFieldId);
              setOpen(false);
            }}
            className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content'
          >
            <FieldTypeIcon
              type={ty}
              className='h-4 w-4 shrink-0 text-text-tertiary'
            />
            <span className='flex-1'>{fieldTypeLabel(t, ty)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className='px-3 pb-1 pt-2 text-xs font-medium text-text-caption'>
      {label}
    </div>
  );
}

/**
 * Pull the i18n label for each supported field type from the existing
 * `grid.field.*FieldName` translation keys — same source the Grid
 * header's property-type menu uses, so the form picker stays in
 * lockstep with the rest of the app.
 */
function fieldTypeLabel(
  t: ReturnType<typeof useTranslation>['t'],
  ty: FieldType,
): string {
  switch (ty) {
    case FieldType.RichText:
      return t('grid.field.textFieldName');
    case FieldType.Number:
      return t('grid.field.numberFieldName');
    case FieldType.SingleSelect:
      return t('grid.field.singleSelectFieldName');
    case FieldType.MultiSelect:
      return t('grid.field.multiSelectFieldName');
    case FieldType.Checkbox:
      return t('grid.field.checkboxFieldName');
    case FieldType.DateTime:
      return t('grid.field.dateFieldName');
    case FieldType.URL:
      return t('grid.field.urlFieldName');
    case FieldType.Media:
      return t('grid.field.mediaFieldName');
    default:
      return 'Property';
  }
}
