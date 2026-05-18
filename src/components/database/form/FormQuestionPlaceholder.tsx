import { ArrowUpCircle, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Per-FieldType placeholder body shared by the editable
 * `FormQuestionCard` and the read-only `FormQuestionCardReadOnly`.
 * Mirrors the desktop's placeholder visual language so the creator can
 * verify the question's shape without filling it out.
 *
 * FieldType is the rust numeric enum; the YJS value comes through as
 * either a string ("0") or a number (0). Normalize at the boundary.
 */
export function FormQuestionPlaceholder({
  fieldType,
  longAnswer,
}: {
  fieldType: string | number;
  longAnswer: boolean;
}) {
  const ty =
    typeof fieldType === 'number' ? fieldType : Number(fieldType);

  switch (ty) {
    case 0 /* RichText */:
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
    case 1 /* Number */:
      return <Placeholder>0</Placeholder>;
    case 2 /* DateTime */:
      return <Placeholder>Pick a date</Placeholder>;
    case 3 /* SingleSelect */:
      return <Placeholder>Respondents can select up to 1</Placeholder>;
    case 4 /* MultiSelect */:
      return <Placeholder>Respondents can select as many as they like</Placeholder>;
    case 5 /* Checkbox */:
      return (
        <div className='h-5 w-5 rounded border-2 border-line-divider' aria-hidden />
      );
    case 6 /* URL */:
      return <Placeholder>https://…</Placeholder>;
    case 14 /* Media */:
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
