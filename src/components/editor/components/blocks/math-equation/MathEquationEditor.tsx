import { Dialog } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/math-equation/close.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/math-equation/expand.svg';
import { Button } from '@/components/ui/button';

import { MathEquationAIIcon } from './MathEquationAIIcon';

/** Both editor sizes share one draft; only Insert commits it. */
export function MathEquationEditor({
  initialValue,
  onSave,
  onCancel,
  onAskAI,
}: {
  initialValue: string;
  onSave: (formula: string) => void;
  onCancel: () => void;
  onAskAI?: (draft: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialValue);
  const [expanded, setExpanded] = useState(false);
  const title = t('document.plugins.mathEquation.addMathEquation');
  const input = (large: boolean) => (
    <textarea
      aria-label={title}
      data-testid='math-equation-input'
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder='E = MC^2'
      autoComplete='off'
      spellCheck={false}
      className={`w-full resize-none rounded-lg border border-border-primary bg-transparent px-2 py-1.5 text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick ${
        large ? 'min-h-0 flex-1' : 'h-28'
      }`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSave(draft);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (large) setExpanded(false);
          else onCancel();
        }
      }}
    />
  );
  const footer = (large: boolean) => (
    <div className='flex h-8 shrink-0 items-center justify-between gap-2'>
      <div className='flex gap-2'>
        {!large && (
          <Button
            variant='outline'
            size='icon-lg'
            className='p-1.5'
            aria-label={t('document.imageBlock.openFullScreen')}
            onClick={() => setExpanded(true)}
          >
            <ExpandIcon width={20} height={20} />
          </Button>
        )}
        {onAskAI && (
          <Button
            variant='outline'
            size='icon-lg'
            className='p-1.5'
            aria-label={t('document.plugins.mathEquation.askAI')}
            onClick={() => onAskAI(draft)}
          >
            <MathEquationAIIcon />
          </Button>
        )}
      </div>
      <div className='flex gap-2'>
        <Button variant='outline' className={large ? 'min-w-[76px]' : undefined} onClick={onCancel}>
          {t('button.cancel')}
        </Button>
        <Button className={large ? 'min-w-[76px]' : undefined} onClick={() => onSave(draft)}>
          {t('document.plugins.mathEquation.insert')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div
        className='flex w-[400px] max-w-full flex-col gap-3 p-3'
        data-testid='math-equation-editor'
        data-expanded={expanded}
        style={{ visibility: expanded ? 'hidden' : undefined }}
      >
        {!expanded && input(false)}
        {footer(false)}
      </div>
      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        aria-labelledby='math-equation-dialog-title'
        PaperProps={{
          className: '!m-4 !h-[360px] !w-[560px] !max-w-[calc(100vw-32px)] !rounded-2xl !bg-surface-primary !p-0',
        }}
      >
        <div className='flex min-h-0 flex-1 flex-col gap-3 px-5 py-4'>
          <div className='flex h-7 shrink-0 items-center justify-between'>
            <h2 id='math-equation-dialog-title' className='text-base font-bold text-text-primary'>
              {title}
            </h2>
            <Button variant='ghost' size='icon' aria-label={t('button.close')} onClick={() => setExpanded(false)}>
              <CloseIcon width={20} height={20} className='h-5 w-5' />
            </Button>
          </div>
          {expanded && input(true)}
          {footer(true)}
        </div>
      </Dialog>
    </>
  );
}
