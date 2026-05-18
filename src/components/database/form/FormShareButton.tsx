import { Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { FormSharePopover } from './FormSharePopover';
import { useFormShareContext } from './FormShareContext';

/**
 * Toolbar entry point for the share popover. Sits next to the
 * Preview button at the top-right of the form-builder view.
 */
export function FormShareButton() {
  const share = useFormShareContext();
  const url = share.resolveShareUrl();

  return (
    <FormSharePopover
      trigger={
        <Button size='sm' className='gap-1'>
          <Share2 size={14} />
          Share form
        </Button>
      }
      info={share.info}
      setTier={share.setTier}
      setAnonymous={share.setAnonymous}
      setSubmissionAccess={share.setSubmissionAccess}
      url={url}
    />
  );
}
