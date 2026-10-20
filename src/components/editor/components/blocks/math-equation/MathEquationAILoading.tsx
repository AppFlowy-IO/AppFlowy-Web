import { useTranslation } from 'react-i18next';

import { ReactComponent as StopIcon } from '@/assets/icons/math-equation/stop.svg';
import { Button } from '@/components/ui/button';

import './math-equation-ai.scss';

export function MathEquationAILoading({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex items-center justify-between gap-2 px-3.5 py-2' data-testid='math-equation-ai-loading'>
      <div role='status' className='flex min-w-0 items-center gap-2 text-sm text-text-secondary'>
        <span className='math-equation-ai-loading-label truncate'>{t('document.plugins.mathEquation.generating')}</span>
        <span className='math-equation-ai-dots' aria-hidden='true'>
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
        aria-label={t('document.plugins.mathEquation.stop')}
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
