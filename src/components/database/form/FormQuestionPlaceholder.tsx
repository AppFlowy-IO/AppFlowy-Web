import { ArrowUpCircle, Upload } from 'lucide-react';

import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { cn } from '@/lib/utils';

/**
 * Per-FieldType placeholder body shared by the editable
 * `FormQuestionCard` and the read-only `FormQuestionCardReadOnly`.
 * Mirrors the desktop's placeholder visual language so the creator can
 * verify the question's shape without filling it out.
 *
 * `fieldType` is the typed `FieldType` enum (numeric under the hood);
 * callers convert at the database-yjs boundary so the rest of the
 * form-builder tree stays type-safe.
 */
export function FormQuestionPlaceholder({
  fieldType,
  longAnswer,
}: {
  fieldType: FieldType;
  longAnswer: boolean;
}) {
  switch (fieldType) {
    case FieldType.RichText:
      return (
        <div
          className={cn(
            'rounded-md border border-line-divider px-3 text-sm text-text-tertiary',
            longAnswer ? 'h-20 py-3' : 'h-9 py-2',
          )}
        >
          Respondent’s answer
        </div>
      );
    case FieldType.Number:
      return <Placeholder>0</Placeholder>;
    case FieldType.DateTime:
      return <Placeholder>Pick a date</Placeholder>;
    case FieldType.SingleSelect:
      return <Placeholder>Respondents can select up to 1</Placeholder>;
    case FieldType.MultiSelect:
      return <Placeholder>Respondents can select as many as they like</Placeholder>;
    case FieldType.Checkbox:
      return (
        <CheckboxUncheckSvg
          className='h-5 w-5 text-border-primary'
          aria-hidden
        />
      );
    case FieldType.URL:
      return <Placeholder>https://…</Placeholder>;
    case FieldType.Media:
      // Mirror of desktop `_MediaBody` (form_question_body.dart): a
      // disabled Upload button, the workspace's per-file / file-count
      // caps, and an Upgrade affordance. F1 is authoring-only — the
      // button stays disabled until F2 wires the upload pipeline.
      // Authoring-side keeps the Upgrade link (creator-facing); the
      // respondent-side mirror in FormMediaInput drops it.
      return (
        <div className='flex flex-wrap items-center gap-3 rounded-md border border-line-divider px-3 py-2'>
          <button
            type='button'
            disabled
            className='inline-flex items-center gap-1.5 rounded-md border border-line-divider px-2.5 py-1 text-xs font-medium text-text-tertiary'
          >
            <Upload size={12} />
            Upload
          </button>
          <span className='text-xs text-text-tertiary'>
            Size limit: 5 MB. File limit: 10.
          </span>
          <button
            type='button'
            className='inline-flex items-center gap-1 text-xs font-medium text-fill-default'
          >
            <ArrowUpCircle size={12} />
            Upgrade
          </button>
          <span className='text-xs text-text-tertiary'>to increase limit</span>
        </div>
      );
    default:
      // Unsupported / Phase-2 types. Surface a neutral "unsupported"
      // tile so the creator sees there's a question here, just not one
      // the web form can render yet.
      return (
        <Placeholder>This question type isn’t supported on the web yet.</Placeholder>
      );
  }
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className='rounded-md border border-line-divider px-3 py-2 text-sm text-text-tertiary'>
      {children}
    </div>
  );
}
