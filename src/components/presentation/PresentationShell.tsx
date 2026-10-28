import Dialog from '@mui/material/Dialog';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';

import type { ReactNode } from 'react';

/** A focused setup dialog expands to a slide preview window after generation. */
export default function PresentationShell({
  setup,
  preview = false,
  onClose,
  children,
}: {
  setup: boolean;
  preview?: boolean;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      fullScreen={!setup && !preview}
      onClose={onClose}
      maxWidth={false}
      PaperProps={
        setup
          ? {
              'aria-label': 'Create presentation',
              className: 'ps-ppt-popover',
              style: {
                margin: 16,
                width: 'min(720px, calc(100vw - 32px))',
                maxHeight: 'calc(100dvh - 32px)',
                borderRadius: 12,
              },
            }
          : preview
          ? {
              'aria-label': 'Presentation preview',
              className: 'ps-ppt-preview-popover',
              style: {
                margin: 16,
                width: 'min(1280px, calc(100vw - 32px))',
                maxWidth: 'calc(100vw - 32px)',
                height: 'min(900px, calc(100dvh - 32px))',
                maxHeight: 'calc(100dvh - 32px)',
                borderRadius: 12,
              },
            }
          : { 'aria-label': 'AI presentation' }
      }
      BackdropProps={setup || preview ? { style: { background: 'rgba(0,0,0,.12)' } } : undefined}
    >
      {(setup || preview) && (
        <Button
          variant='ghost'
          size='icon'
          aria-label={setup ? 'Close generation settings' : 'Close presentation preview'}
          onClick={onClose}
          className={setup ? 'ps-ppt-close' : 'ps-ppt-preview-close'}
        >
          <CloseIcon className='h-5 w-5' aria-hidden='true' />
        </Button>
      )}
      {children}
    </Dialog>
  );
}
