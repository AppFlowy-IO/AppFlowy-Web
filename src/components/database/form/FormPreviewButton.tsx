import { Dialog } from '@mui/material';
import { Eye } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
} from '@/application/database-yjs';
import { useDatabaseView } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  PublicFormSchema,
  PublicOption,
  PublicQuestion,
  PublicQuestionKind,
} from '@/application/types/form';
import { YjsDatabaseKey } from '@/application/types';
import { FormBody } from '@/components/form/FormBody';
import { Button } from '@/components/ui/button';

// Synthetic placeholder options shown when a select question has none.
// Mirrors `_readSelectOptions`'s fallback in the desktop preview
// (`form_preview_inputs.dart`): a fresh question with no options yet
// still renders three "Option 1/2/3" rows so the creator can see the
// option-picker shape without first authoring real options.
const PREVIEW_PLACEHOLDER_OPTIONS: PublicOption[] = [
  { id: '__preview_opt_1', label: 'Option 1' },
  { id: '__preview_opt_2', label: 'Option 2' },
  { id: '__preview_opt_3', label: 'Option 3' },
];

// Hoisted so MUI's Paper doesn't see a fresh props object every render.
const DIALOG_PAPER_PROPS = {
  className: 'max-h-[85vh] w-[90vw] max-w-2xl overflow-auto',
} as const;

/**
 * Preview the form-builder draft in respondent mode. Reuses the
 * `FormBody` component the public `/form/:token` page renders, so
 * what the creator sees here is bit-for-bit what the respondent will
 * see — minus the actual submission (the preview's submit is
 * intercepted with a no-op; see `previewToken`).
 *
 * Building the synthetic schema from the local draft keeps the
 * preview live: every per-question edit ripples into the preview on
 * the next open without a fetch round-trip.
 */
export function FormPreviewButton() {
  const [open, setOpen] = useState(false);
  const snapshot = useFormLayoutSnapshot();
  const fieldsMap = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const view = useDatabaseView();
  // Use the actual form view name as the preview title (desktop:
  // `form_preview_page.dart` falls back to "Form title" when empty —
  // matching that here too).
  const viewName = view?.get(YjsDatabaseKey.name) ?? '';
  const previewTitle = viewName || 'Form title';

  // Gate the heavy compute (JSON.parse per select field, O(N) over the
  // question list) on `open`. The form builder updates the snapshot on
  // every keystroke in question titles / descriptions; without this
  // gate we'd compute a preview schema the user never sees on every
  // one of those updates. The one-time recompute when the user opens
  // the dialog is acceptable.
  const schema = useMemo<PublicFormSchema | null>(() => {
    if (!open) return null;
    if (!fieldsMap) return null;
    const questions: PublicQuestion[] = [];

    for (const q of snapshot.questions) {
      const field = fieldsMap.get(q.fieldId);

      if (!field) continue;
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      const kind = toPublicKind(fieldType);

      if (!kind) continue;
      // For select questions with no real options yet, fall back to
      // the synthetic placeholder list so the creator sees the row
      // shape (matches desktop `_readSelectOptions` fallback).
      const realOptions =
        kind === 'single_select' || kind === 'multi_select'
          ? extractOptions(field)
          : undefined;
      const previewOptions =
        kind === 'single_select' || kind === 'multi_select'
          ? realOptions && realOptions.length > 0
            ? realOptions
            : PREVIEW_PLACEHOLDER_OPTIONS
          : undefined;

      questions.push({
        id: q.fieldId,
        label: field.get(YjsDatabaseKey.name) || 'Untitled question',
        description: q.descriptionVisible ? q.description : undefined,
        kind,
        required: q.required,
        long_answer: q.longAnswer,
        max_selections: undefined,
        options: previewOptions,
        input_style: 'auto',
      });
    }

    return {
      form_id: 'preview',
      tier: 'workspace',
      anonymous: true,
      title: previewTitle,
      description: snapshot.description || undefined,
      questions,
      submit_label: 'Submit',
      submit_color: 'primary',
      confirmation_title: 'Looks good — preview only, nothing was saved.',
      allow_another_response: false,
      hide_branding: true,
    };
    // `fieldsVersion` is an invalidation token (see useDatabaseFieldsVersion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot, fieldsMap, fieldsVersion, previewTitle]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        data-testid='form-preview-button'
        variant='ghost'
        size='sm'
        className='gap-1'
        onClick={handleOpen}
      >
        <Eye size={14} />
        Preview
      </Button>
      <Dialog
        open={open}
        onClose={handleClose}
        PaperProps={DIALOG_PAPER_PROPS}
      >
        {open && schema && (
          <div data-testid='form-preview-dialog'>
            <FormBody token='preview' schema={schema} />
          </div>
        )}
      </Dialog>
    </>
  );
}

function toPublicKind(ty: FieldType): PublicQuestionKind | null {
  switch (ty) {
    case FieldType.RichText:
      return 'text';
    case FieldType.Number:
      return 'number';
    case FieldType.URL:
      return 'url';
    case FieldType.Checkbox:
      return 'checkbox';
    case FieldType.SingleSelect:
      return 'single_select';
    case FieldType.MultiSelect:
      return 'multi_select';
    case FieldType.DateTime:
      return 'date';
    case FieldType.Media:
      return 'files';
    default:
      return null;
  }
}

/**
 * Pull the type-option options for a select field. Single + multi
 * select share the same `options` shape in the YJS collab; the
 * `type_option` map is keyed by the field-type number-as-string.
 */
function extractOptions(field: ReturnType<NonNullable<ReturnType<typeof useDatabaseFields>>['get']>): PublicOption[] | undefined {
  if (!field) return undefined;
  const typeOption = field.get(YjsDatabaseKey.type_option);

  if (!typeOption) return undefined;
  const fieldType = Number(field.get(YjsDatabaseKey.type));
  const entry = typeOption.get(String(fieldType));

  if (!entry) return undefined;
  // The options blob is stored as a JSON-encoded string under `content`.
  // Try to parse — fall back to undefined on shape surprises so the
  // preview at least renders the question card even if option editing
  // never happened.
  const content = entry.get(YjsDatabaseKey.content);

  if (typeof content !== 'string') return undefined;
  try {
    const parsed = JSON.parse(content) as { options?: Array<{ id: string; name: string; color?: number | string }> };

    if (!parsed.options) return undefined;
    return parsed.options.map((o) => ({
      id: o.id,
      label: o.name,
      color: typeof o.color === 'string' ? o.color : undefined,
    }));
  } catch {
    return undefined;
  }
}
