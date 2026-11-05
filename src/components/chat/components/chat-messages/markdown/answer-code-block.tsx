import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { CodeBlockData } from '@/application/types';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { codeLanguageLabel, normalizeCodeLanguage } from '@/components/editor/components/blocks/code/constants';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/utils/copy';

import '@/components/editor/components/blocks/code/code.scss';

const HighlightedCode = lazy(() => import('@/components/editor/components/blocks/code/HighlightedCode'));
const MermaidDiagram = lazy(() => import('@/components/editor/components/blocks/code/MermaidDiagram'));

type MermaidView = 'diagram' | 'code';

/**
 * A fenced code block from an answer: language label, copy button, the editor's
 * syntax colours, and the rendered diagram for Mermaid sources.
 */
export function AnswerCodeBlock({
  text,
  data,
  streaming = false,
}: {
  text: string;
  data: CodeBlockData;
  /** A half-streamed diagram only produces parse errors, so it stays code until the answer ends. */
  streaming?: boolean;
}) {
  const { t } = useTranslation();
  const language = normalizeCodeLanguage(data.language);
  const isMermaid = language === 'mermaid';
  const [chosenView, setChosenView] = useState<MermaidView>();
  const view: MermaidView = isMermaid ? chosenView ?? (streaming ? 'code' : 'diagram') : 'code';
  const copyLabel = t('document.plugins.codeBlock.copyCode');

  const copy = () => {
    void copyTextToClipboard(text)
      .then(() => toast.success(t('chat.success.copied')))
      .catch(() => toast.error(t('chat.errors.copied')));
  };

  const source = (
    <pre>
      <code>{text}</code>
    </pre>
  );

  return (
    <div className='code-block chat-code-block' data-language={language} data-testid='chat-code-block'>
      <div className='chat-code-header'>
        <span className='chat-code-language'>{codeLanguageLabel(data.language)}</span>
        <div className='chat-code-actions'>
          {isMermaid ? (
            <div className='chat-code-toggle' role='group' aria-label={t('chat.code.view')}>
              {(['diagram', 'code'] as const).map((option) => (
                <button
                  key={option}
                  type='button'
                  aria-pressed={view === option}
                  onClick={() => setChosenView(option)}
                >
                  {t(`chat.code.${option}`)}
                </button>
              ))}
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={'ghost'}
                size={'icon'}
                className='h-6 w-6'
                aria-label={copyLabel}
                onClick={copy}
                data-testid='chat-code-copy'
              >
                <CopyIcon className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copyLabel}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {view === 'diagram' ? (
        <div className='chat-code-diagram'>
          <Suspense fallback={source}>
            <MermaidDiagram source={text} />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={source}>
          <HighlightedCode text={text} data={data} />
        </Suspense>
      )}
    </div>
  );
}
