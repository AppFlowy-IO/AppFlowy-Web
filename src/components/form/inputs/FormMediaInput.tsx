import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Files & Media respondent input — F1 stub matching the desktop's
 * `_MediaInput` (form_preview_inputs.dart). Renders a disabled Upload
 * button and the workspace's per-file / file-count caps. The respondent
 * surface intentionally drops the desktop's authoring "Upgrade to
 * increase limit" link — that prompt is for the form's creator, not the
 * person filling it out.
 *
 * The button is disabled (not hidden) so the question shape is visible
 * to respondents and the form layout doesn't shift between F1 and F2.
 * F2 will wire `onClick` to the same upload pipeline the public form
 * uses; the question wire type already routes here.
 */
export function FormMediaInput() {
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <Button variant='outline' size='sm' disabled className='gap-2'>
        <Upload size={14} />
        Upload
      </Button>
      <span className='text-xs text-text-caption'>
        Size limit: 5 MB. File limit: 10.
      </span>
    </div>
  );
}
