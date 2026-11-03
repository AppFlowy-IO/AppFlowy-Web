import { Maximize, Minimize } from 'lucide-react';

import { Action } from './ui';

import type { usePresentationFullscreen } from './usePresentationFullscreen';

export default function FullscreenControl({
  fullscreen,
  enterLabel = 'Enter fullscreen',
}: {
  fullscreen: ReturnType<typeof usePresentationFullscreen>;
  enterLabel?: string;
}) {
  const label = fullscreen.active ? 'Exit fullscreen' : enterLabel;

  return (
    <div className='ps-fullscreen-control'>
      {fullscreen.error && (
        <span className='ps-fullscreen-error' role='alert'>
          {fullscreen.error}
        </span>
      )}
      <Action
        aria-label={label}
        title={label}
        aria-pressed={fullscreen.active}
        disabled={fullscreen.pending}
        onClick={() => void fullscreen.toggle()}
      >
        {fullscreen.active ? <Minimize size={17} /> : <Maximize size={17} />}
      </Action>
    </div>
  );
}
