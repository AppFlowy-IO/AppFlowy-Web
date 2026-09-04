import type { TFunction } from 'i18next';
import { PlusCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNewFormQuestionDispatch } from '@/application/database-yjs/dispatch';
import { FieldType } from '@/application/database-yjs/database.type';
import { FORM_QUESTION_FIELD_TYPES, isFormQuestionFieldType } from '@/application/database-yjs/form-field-types';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { FormWriter } from '@/application/database-yjs/form-writer';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseFields } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/// Notion's "Show N more" threshold (Image #8). Keeps the picker
/// compact for typical 5-7-field databases while still surfacing the
/// full list on demand for bigger ones.
const EXISTING_PREVIEW_LIMIT = 5;

export interface ExistingQuestionCandidate {
  id: string;
  name: string;
  type: FieldType;
}

export function buildExistingQuestionCandidates(
  fieldsMap: YDatabaseFields | undefined,
  fieldOrderIds: readonly string[] | null,
  onFormIds: ReadonlySet<string>
): ExistingQuestionCandidate[] {
  if (!fieldsMap || fieldOrderIds === null) return [];
  const out: ExistingQuestionCandidate[] = [];

  fieldOrderIds.forEach((fieldId) => {
    if (onFormIds.has(fieldId)) return;
    const field = fieldsMap.get(fieldId);

    if (!field) return;
    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

    if (!isFormQuestionFieldType(fieldType)) return;
    out.push({
      id: fieldId,
      name: field.get(YjsDatabaseKey.name) || 'Untitled',
      type: fieldType,
    });
  });
  return out;
}

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
 * only this view's Form projection changes). New-question picks use one
 * database-history transaction to create the field in every linked view and
 * attach it to this Form, matching Desktop's atomic command.
 */
export function FormQuestionTypePicker({
  fieldsMap,
  fieldsVersion,
  snapshot,
  writer,
}: {
  fieldsMap: YDatabaseFields | undefined;
  fieldsVersion: number;
  snapshot: FormLayoutSnapshot;
  writer: FormWriter;
}) {
  const [open, setOpen] = useState(false);

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
        {open && (
          <QuestionPickerContent
            fieldsMap={fieldsMap}
            fieldsVersion={fieldsVersion}
            snapshot={snapshot}
            writer={writer}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function QuestionPickerContent({
  fieldsMap,
  fieldsVersion,
  snapshot,
  writer,
  onClose,
}: {
  fieldsMap: YDatabaseFields | undefined;
  fieldsVersion: number;
  snapshot: FormLayoutSnapshot;
  writer: FormWriter;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const createQuestion = useNewFormQuestionDispatch();
  const { t } = useTranslation();

  // The content component exists only while the popover is open, so a hidden
  // picker neither scans the fields map nor subscribes through dispatch hooks.
  const candidates = useMemo(() => {
    const onFormIds = new Set(snapshot.questions.map((q) => q.fieldId));

    return buildExistingQuestionCandidates(fieldsMap, snapshot.fieldOrderIds, onFormIds);
    // `fieldsVersion` is an invalidation token (see useDatabaseFieldsVersion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsMap, fieldsVersion, snapshot]);

  const showCollapse = candidates.length > EXISTING_PREVIEW_LIMIT;
  const visibleCandidates = showCollapse && !expanded ? candidates.slice(0, EXISTING_PREVIEW_LIMIT) : candidates;

  return (
    <>
      {candidates.length > 0 && (
        <>
          <SectionHeader label='Existing properties' />
          {visibleCandidates.map((c) => (
            <button
              key={c.id}
              type='button'
              onClick={() => {
                writer.addQuestion(c.id);
                onClose();
              }}
              className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content'
            >
              <FieldTypeIcon type={c.type} className='h-4 w-4 shrink-0 text-text-tertiary' />
              <span className='flex-1 truncate'>{c.name}</span>
            </button>
          ))}
          {showCollapse && (
            <button
              type='button'
              onClick={() => setExpanded((v) => !v)}
              className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-text-caption hover:bg-fill-content'
            >
              {expanded ? 'Show less' : `Show ${candidates.length - EXISTING_PREVIEW_LIMIT} more`}
            </button>
          )}
          <div className='my-1 border-t border-line-divider' />
        </>
      )}
      <SectionHeader label='New question' />
      {/*
        Picking a New-question type creates a brand-new database field and
        attaches it to this Form in one Yjs/history transaction. The new
        property shows up in every linked view's schema; decided Form views
        still control membership through their own projections.
      */}
      {FORM_QUESTION_FIELD_TYPES.map((ty) => (
        <button
          key={ty}
          data-testid={`form-question-type-option-${ty}`}
          type='button'
          onClick={() => {
            createQuestion(ty);
            onClose();
          }}
          className='flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-fill-content'
        >
          <FieldTypeIcon type={ty} className='h-4 w-4 shrink-0 text-text-tertiary' />
          <span className='flex-1'>{fieldTypeLabel(t, ty)}</span>
        </button>
      ))}
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return <div className='px-3 pb-1 pt-2 text-xs font-medium text-text-caption'>{label}</div>;
}

/**
 * Pull the i18n label for each supported field type from the existing
 * `grid.field.*FieldName` translation keys — same source the Grid
 * header's property-type menu uses, so the form picker stays in
 * lockstep with the rest of the app.
 */
function fieldTypeLabel(
  // Plain `TFunction` instead of `ReturnType<typeof useTranslation>['t']`
  // — the latter forces TypeScript 4.9 to fully expand the typed
  // i18next key union and `pnpm type-check` aborts with
  // `RangeError: Map maximum size exceeded`. Same call-signature at the
  // use site, but with a tractable type.
  t: TFunction,
  ty: FieldType
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
