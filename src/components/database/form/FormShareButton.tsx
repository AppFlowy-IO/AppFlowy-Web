import { Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useFormShareContext } from './FormShareContext';
import { FormSharePopover } from './FormSharePopover';

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
        <Button data-testid='form-share-button' size='sm' className='gap-1'>
          <Share2 size={14} />
          Share form
        </Button>
      }
      info={share.info}
      isLoading={share.isLoading}
      errorMessage={share.error}
      onRetry={share.retryBootstrap}
      onRetryMutation={share.retryMutation}
      canUpdateSettings={share.canUpdateSettings}
      setTier={share.setTier}
      setAnonymous={share.setAnonymous}
      url={url}
    />
  );
}
