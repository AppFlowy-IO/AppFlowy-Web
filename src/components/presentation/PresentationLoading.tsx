import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { Action } from './ui';

const spinner =
  'h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick motion-reduce:animate-none';

/** Fills a presentation surface while its content loads, so opening it shows nothing else first. */
export default function PresentationLoading({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-4'>
      <p role='status' className='flex items-center gap-2 text-sm text-text-primary'>
        <span aria-hidden='true' className={spinner} />
        {message}
      </p>
      <Button onClick={onClose}>Back to page</Button>
    </div>
  );
}

/** A mind map presentation before its map arrives: the map's surface and close button, with a spinner. */
export function MindMapLoading({ onClose }: { onClose: () => void }) {
  return (
    <div className='ps-root ps-map-loading'>
      <Action className='ps-map-close' aria-label='Back to page' title='Close (Esc)' onClick={onClose}>
        <X size={20} />
      </Action>
      <p role='status'>
        <span aria-hidden='true' className={spinner} />
        Loading mind map…
      </p>
    </div>
  );
}
