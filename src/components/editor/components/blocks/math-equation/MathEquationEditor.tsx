import { Dialog } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/math-equation/close.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/math-equation/expand.svg';
import { unwrapMathMarkdown } from '@/components/editor/utils/math-markdown';
import { Button } from '@/components/ui/button';

const formulaHintText = String.raw`|x| = \begin{cases}
 x, &\quad x \geq 0 \\
-x, &\quad x < 0
\end{cases}`;

/** Both editor sizes share one draft; only Insert commits it. */
export function MathEquationEditor({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (formula: string) => void;
  onCancel: () => void;
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
      onPaste={(event) => {
        const source = event.clipboardData.getData('text/plain');
        const formula = unwrapMathMarkdown(source);

        if (formula === source) return;
        event.preventDefault();
        const { selectionStart, selectionEnd } = event.currentTarget;

        setDraft(draft.slice(0, selectionStart) + formula + draft.slice(selectionEnd));
      }}
      placeholder={formulaHintText}
      autoComplete='off'
      spellCheck={false}
      className='min-h-0 w-full flex-1 resize-none overflow-auto rounded-lg border border-border-primary bg-transparent px-2 py-1.5 font-mono text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
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
      <div className={large ? 'flex gap-3' : 'flex gap-2'}>
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
      </div>
      <div className={large ? 'flex gap-3' : 'flex gap-2'}>
        <Button variant='outline' className={large ? 'h-8 min-w-[76px]' : 'h-8'} onClick={onCancel}>
          {t('button.cancel')}
        </Button>
        <Button className={large ? 'h-8 min-w-[76px]' : 'h-8'} onClick={() => onSave(draft)}>
          {t('document.plugins.mathEquation.insert')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div
        className='math-equation-editor flex w-[400px] max-w-full flex-col gap-3 p-3'
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
          className: 'math-equation-dialog !m-4 !w-[560px] !max-w-[calc(100vw-32px)] !rounded-2xl !border-0 !bg-surface-layer-02 !p-0',
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
