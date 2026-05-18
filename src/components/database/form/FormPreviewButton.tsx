import { Eye } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  useDatabaseFields,
  useDatabaseFieldsVersion,
  useFormLayoutSnapshot,
} from '@/application/database-yjs';
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
import { Dialog, DialogContent } from '@/components/ui/dialog';

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

  const schema = useMemo<PublicFormSchema | null>(() => {
    // Skip the JSON-parse-per-select-field cost when the preview is
    // closed. The dialog only renders the body when `open` is true, so
    // a stale value while closed is harmless.
    if (!open) return null;
    if (!fieldsMap) return null;
    const questions: PublicQuestion[] = [];

    for (const q of snapshot.questions) {
      const field = fieldsMap.get(q.fieldId);

      if (!field) continue;
      const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
      const kind = toPublicKind(fieldType);

      if (!kind) continue;
      questions.push({
        id: q.fieldId,
        label: field.get(YjsDatabaseKey.name) || 'Untitled question',
        description: q.descriptionVisible ? q.description : undefined,
        kind,
        required: q.required,
        long_answer: q.longAnswer,
        max_selections: undefined,
        options: kind === 'single_select' || kind === 'multi_select'
          ? extractOptions(field)
          : undefined,
        input_style: 'auto',
      });
    }

    return {
      form_id: 'preview',
      tier: 'workspace',
      anonymous: true,
      title: 'Form preview',
      description: snapshot.description || undefined,
      questions,
      submit_label: 'Submit',
      submit_color: 'primary',
      confirmation_title: 'Looks good — preview only, nothing was saved.',
      allow_another_response: false,
      hide_branding: true,
    };
    // `fieldsVersion` re-runs the memo when fields mutate; the Y.Map
    // identity alone is stable across mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot, fieldsMap, fieldsVersion]);

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        className='gap-1'
        onClick={() => setOpen(true)}
      >
        <Eye size={14} />
        Preview
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[85vh] w-[90vw] max-w-2xl overflow-auto p-0'>
          {schema && <FormBody token='preview' schema={schema} />}
        </DialogContent>
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
