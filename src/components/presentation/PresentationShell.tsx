import Dialog from '@mui/material/Dialog';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';

import type { ReactNode } from 'react';

/** One presentation window owns loading, settings and preview without changing dialog geometry. */
export default function PresentationShell({
  setup,
  preview = false,
  onClose,
  paperClassName,
  children,
}: {
  setup: boolean;
  preview?: boolean;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  /** Classes for the full-screen paper, such as a presentation that runs edge to edge. */
  paperClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      fullScreen={!setup && !preview}
      onClose={onClose}
      maxWidth={false}
      PaperProps={
        setup || preview
          ? {
              'aria-label': setup ? 'Create presentation' : 'Presentation preview',
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
          : { 'aria-label': 'AI presentation', className: paperClassName }
      }
      BackdropProps={setup || preview ? { style: { background: 'rgba(0,0,0,.12)' } } : undefined}
    >
      {(setup || preview) && (
        <Button
          variant='ghost'
          size='icon'
          aria-label={setup ? 'Close generation settings' : 'Close presentation preview'}
          onClick={onClose}
          className='ps-ppt-preview-close'
        >
          <CloseIcon className='h-5 w-5' aria-hidden='true' />
        </Button>
      )}
      {children}
    </Dialog>
  );
}
