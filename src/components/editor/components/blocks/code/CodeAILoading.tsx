import { useTranslation } from 'react-i18next';

import { ReactComponent as StopIcon } from '@/assets/icons/code-block/stop.svg';
import { Button } from '@/components/ui/button';

import './code-ai.scss';

export function CodeAILoading({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex items-center justify-between gap-2 px-3.5 py-2' data-testid='code-ai-loading'>
      <div role='status' className='flex min-w-0 items-center gap-2 text-sm text-text-secondary'>
        <span className='code-ai-loading-label truncate'>{t('document.plugins.codeBlock.generating')}</span>
        <span className='code-ai-dots' aria-hidden='true'>
          <span />
          <span />
          <span />
        </span>
      </div>
      <Button
        autoFocus
        variant='ghost'
        size='icon-lg'
        className='p-1 text-fill-theme-thick hover:bg-transparent'
        aria-label={t('document.plugins.codeBlock.stop')}
        onClick={onStop}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onStop();
          }
        }}
      >
        <StopIcon width={24} height={24} />
      </Button>
    </div>
  );
}
