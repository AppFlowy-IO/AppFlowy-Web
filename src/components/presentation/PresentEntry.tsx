import { lazy, Suspense, useRef, useState } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { Button } from '@/components/ui/button';

import { loadPresentationDialog, preloadPresentation } from './presentation-preload';
import PresentationMenu from './PresentationMenu';
import { Mode } from './types';

import type { PresentationSourceProps } from './PresentationDialog';

const PresentationDialog = lazy(loadPresentationDialog);

export default function PresentEntry({
  slidesOnly = false,
  ...source
}: PresentationSourceProps & { slidesOnly?: boolean }) {
  const [mode, setMode] = useState<Mode>();
  const deck = source.deck;
  const trigger = useRef<HTMLButtonElement>(null);
  const open = (next: Mode) => {
    // Fetch the dialog and the chosen mode's chunk together instead of one after the other.
    preloadPresentation(next);
    setMode(next);
  };

  return (
    <>
      {slidesOnly ? (
        <Button ref={trigger} size='sm' variant={deck ? 'outline' : 'default'} onClick={() => open('slides')}>
          <AIIcon className='h-4 w-4' aria-hidden='true' />
          {deck ? 'Open preview' : 'Generate AI ppt'}
        </Button>
      ) : (
        <PresentationMenu ref={trigger} onSelect={open} />
      )}
      {mode && (
        <Suspense fallback={null}>
          <PresentationDialog {...source} anchorEl={trigger.current} mode={mode} onClose={() => setMode(undefined)} />
        </Suspense>
      )}
    </>
  );
}
