import { Dialog } from '@mui/material';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { lazy, Suspense, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBoundary } from 'react-error-boundary';

import { FieldType } from '@/application/database-yjs/database.type';
import type { FormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseField, YDatabaseFields } from '@/application/types';
import {
  resolveFormDisplayTitle,
  type PublicFormSchema,
  type PublicOption,
  type PublicQuestion,
  type PublicQuestionKind,
} from '@/application/types/form';
import { previewFieldType } from './form-preview-field-type';
import { FormQuestionTitle } from './FormQuestionTitle';
import { Button } from '@/components/ui/button';

const FormBody = lazy(() =>
  import('@/components/form/FormBody').then(({ FormBody: Component }) => ({
    default: Component,
  }))
);

// Hoisted so MUI's Paper doesn't see a fresh props object every render.
const DIALOG_PAPER_PROPS = {
  className: 'max-h-[85vh] w-[90vw] !max-w-[840px] overflow-auto !rounded-xl',
  'aria-label': 'Form preview',
} as const;

/**
 * Preview the form-builder draft in respondent mode. Reuses the
 * `FormBody` component the public `/form/:token` page renders, so question
 * rendering and validation stay aligned with the respondent surface. The
 * preview title and form description come from the same per-view collab
 * metadata projected to the public schema, so authored respondent copy stays
 * aligned with the shared URL.
 *
 * Building the synthetic schema from the local draft keeps the
 * preview live: every per-question edit ripples into the preview on
 * the next open without a fetch round-trip.
 */
export function FormPreviewButton({
  snapshot,
  fieldsMap,
}: {
  snapshot: FormLayoutSnapshot;
  fieldsMap: YDatabaseFields | undefined;
  fieldsVersion: number;
}) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState<PublicFormSchema | null>(null);

  // Desktop captures the projection on open. Collaborator changes must not
  // replace a question underneath an answer being tried in this preview.
  const handleOpen = useCallback(() => {
    if (!fieldsMap) return;
    setSchema(buildFormPreviewSchema(snapshot, fieldsMap));
    setOpen(true);
  }, [fieldsMap, snapshot]);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        data-testid='form-preview-button'
        variant='outline'
        size='sm'
        className='h-7 px-2 font-medium'
        onClick={handleOpen}
        disabled={!fieldsMap}
      >
        Preview
      </Button>
      <Dialog open={open} onClose={handleClose} PaperProps={DIALOG_PAPER_PROPS}>
        {open && schema && (
          <div data-testid='form-preview-dialog'>
            <div className='flex h-[52px] items-end justify-end pr-6 pt-4'>
              <Button
                variant='ghost'
                size='icon'
                className='h-9 w-9'
                aria-label='Close preview dialog'
                onClick={handleClose}
              >
                <CloseIcon className='h-5 w-5' />
              </Button>
            </div>
            <ErrorBoundary fallback={<PreviewLoadError onClose={handleClose} />}>
              <Suspense
                fallback={<div className='px-6 py-10 text-center text-sm text-text-caption'>Loading preview…</div>}
              >
                <FormBody
                  token='preview'
                  schema={schema}
                  previewMode
                  onPreviewSubmit={notifyPreviewValid}
                  renderQuestionTitle={renderPreviewQuestionTitle}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </Dialog>
    </>
  );
}

function PreviewLoadError({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid='form-preview-load-error' className='flex flex-col items-center gap-3 px-6 py-10 text-center'>
      <p className='text-sm text-text-caption'>Preview couldn’t load. Close it and refresh the page to try again.</p>
      <Button variant='outline' size='sm' onClick={onClose}>
        Close preview
      </Button>
    </div>
  );
}

/**
 * Build the respondent-shaped preview from the local question projection.
 *
 * Title and description come from this Form view's local collab projection so
 * Preview matches the respondent copy being authored.
 */
export function buildFormPreviewSchema(snapshot: FormLayoutSnapshot, fieldsMap: YDatabaseFields): PublicFormSchema {
  const questions: PublicQuestion[] = [];
  const normalizedDescription = snapshot.description.trim();

  for (const q of snapshot.questions) {
    const field = fieldsMap.get(q.fieldId);

    if (!field) continue;
    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
    const kind = toPublicKind(fieldType);

    if (!kind) continue;
    const realOptions = kind === 'single_select' || kind === 'multi_select' ? extractOptions(field) : undefined;
    const previewOptions = kind === 'single_select' || kind === 'multi_select' ? realOptions ?? [] : undefined;

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
    title: resolveFormDisplayTitle(snapshot.respondentTitle),
    description: normalizedDescription || undefined,
    questions,
    submit_label: 'Submit',
    submit_color: 'primary',
    confirmation_title: 'Looks good — preview only, nothing was saved.',
    allow_another_response: false,
    hide_branding: true,
  };
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
function extractOptions(field: YDatabaseField): PublicOption[] | undefined {
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

function renderPreviewQuestionTitle(question: PublicQuestion) {
  return (
    <FormQuestionTitle name={question.label} fieldType={previewFieldType(question.kind)} required={question.required} />
  );
}

function notifyPreviewValid() {
  toast.success('Submission valid — looks good!');
}
