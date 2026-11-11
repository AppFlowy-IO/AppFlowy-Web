import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { Button } from '@/components/ui/button';
import { ArrowUpCircle } from 'lucide-react';

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
export function FormQuestionPlaceholder({ fieldType, longAnswer }: { fieldType: FieldType; longAnswer: boolean }) {
  switch (fieldType) {
    case FieldType.RichText:
      return (
        <div
          className={cn(
            'rounded-md border border-border-primary px-2 text-sm leading-5 text-text-tertiary',
            longAnswer ? 'min-h-[120px] py-1.5' : 'flex h-8 items-center'
          )}
        >
          Your answer
        </div>
      );
    case FieldType.Number:
      return <Placeholder>Your answer</Placeholder>;
    case FieldType.DateTime:
      return <Placeholder icon={<ExpandIcon className='h-5 w-5 text-text-secondary' />}>Your answer</Placeholder>;
    case FieldType.SingleSelect:
      return <Placeholder>Respondents can select up to 1</Placeholder>;
    case FieldType.MultiSelect:
      return <Placeholder>Respondents can select as many as they like</Placeholder>;
    case FieldType.Checkbox:
      return <CheckboxUncheckSvg className='h-5 w-5 text-border-primary' aria-hidden />;
    case FieldType.URL:
      return <Placeholder icon={<ArrowDownIcon className='h-5 w-5 text-text-secondary' />}>Your answer</Placeholder>;
    case FieldType.Media:
      // Mirror of desktop `_MediaBody` (form_question_body.dart): a
      // disabled Upload button, the workspace's per-file / file-count
      // caps, and static Upgrade guidance. F1 is authoring-only — the
      // button stays disabled until F2 wires the upload pipeline.
      // Authoring-side keeps the Upgrade copy (creator-facing); the
      // respondent-side mirror in FormMediaInput drops it.
      return (
        <div className='flex flex-wrap items-center gap-3'>
          <Button type='button' variant='outline' disabled>
            Upload
          </Button>
          <span className='text-sm text-text-tertiary'>Size limit: 5 MB. File limit: 10.</span>
          <span className='inline-flex items-center gap-1 text-xs font-medium text-fill-default'>
            <ArrowUpCircle size={12} aria-hidden />
            Upgrade
          </span>
          <span className='text-sm text-text-tertiary'>to increase limit</span>
        </div>
      );
    default:
      // Unsupported / Phase-2 types. Surface a neutral "unsupported"
      // tile so the creator sees there's a question here, just not one
      // the web form can render yet.
      return <Placeholder>This question type isn’t supported on the web yet.</Placeholder>;
  }
}

function Placeholder({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className='flex h-8 items-center justify-between gap-2 rounded-md border border-border-primary px-2 text-sm leading-5 text-text-tertiary'>
      {children}
      {icon}
    </div>
  );
}
