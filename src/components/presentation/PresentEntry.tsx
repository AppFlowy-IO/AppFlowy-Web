import { lazy, Suspense, useRef, useState } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { Button } from '@/components/ui/button';

import PresentationMenu from './PresentationMenu';
import { Mode } from './types';

import type { PresentationSourceProps } from './PresentationDialog';

const PresentationDialog = lazy(() => import('./PresentationDialog'));

export default function PresentEntry({
  slidesOnly = false,
  ...source
}: PresentationSourceProps & { slidesOnly?: boolean }) {
  const [mode, setMode] = useState<Mode>();
  const deck = source.deck;
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      {slidesOnly ? (
        <Button ref={trigger} size='sm' variant={deck ? 'outline' : 'default'} onClick={() => setMode('slides')}>
          <AIIcon className='h-4 w-4' aria-hidden='true' />
          {deck ? 'Open preview' : 'Generate AI ppt'}
        </Button>
      ) : (
        <PresentationMenu ref={trigger} onSelect={setMode} />
      )}
      {mode && (
        <Suspense fallback={null}>
          <PresentationDialog {...source} anchorEl={trigger.current} mode={mode} onClose={() => setMode(undefined)} />
        </Suspense>
      )}
    </>
  );
}
