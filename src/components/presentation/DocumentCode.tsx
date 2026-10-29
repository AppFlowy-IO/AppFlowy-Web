import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { notify } from '@/components/_shared/notify';
import { CodeBlockFrame } from '@/components/editor/components/blocks/code/CodeBlockFrame';
import { codeLanguageLabel, normalizeCodeLanguage } from '@/components/editor/components/blocks/code/constants';
import { getCodeHighlighter } from '@/components/editor/components/blocks/code/syntax-highlighter';
import { copyTextToClipboard } from '@/utils/copy';
import { Log } from '@/utils/log';

import { codeGrammar, highlightsCode, tokenizeCode, type CodeToken } from './code-languages';
import './document-code.scss';
import '@/components/editor/components/blocks/code/code.scss';

import type { SourceBlock } from './types';

const MermaidPreview = lazy(() => import('@/components/editor/components/blocks/code/MermaidPreview'));
const closePreview = () => undefined;
// Snapshot blocks are immutable: the slide, its measuring copy and later visits share one highlight.
const highlighted = new WeakMap<SourceBlock, CodeToken[]>();

/** The editor's highlighter, loaded on first use as the editor's code blocks load it. */
function useCodeHighlighter(enabled: boolean) {
  const [highlighter, setHighlighter] = useState(getCodeHighlighter);

  useEffect(() => {
    if (!enabled || highlighter) return;
    let cancelled = false;

    void import('@/components/editor/components/blocks/code/code-grammars').then(
      ({ default: loaded }) => {
        if (!cancelled) setHighlighter(loaded);
      },
      (error: unknown) => {
        // The source stays readable as plain text, as in the editor.
        if (!cancelled) Log.warn('Unable to load code highlighting', error);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, highlighter]);

  return enabled ? highlighter : undefined;
}

function DocumentCode({ block }: { block: SourceBlock }) {
  const { t } = useTranslation();
  const language = normalizeCodeLanguage(block.language);
  const highlighter = useCodeHighlighter(highlightsCode(block.text, block.language));
  const tokens = useMemo(() => {
    if (!highlighter) return;
    let result = highlighted.get(block);

    if (!result) {
      result = tokenizeCode(block.text, codeGrammar(highlighter, block.text, block.language));
      highlighted.set(block, result);
    }

    return result;
  }, [highlighter, block]);

  return (
    <div className='ps-document-code relative my-0.5 w-full' data-code-language={language}>
      <div className='ps-code-heading pointer-events-none absolute z-10 flex h-12 w-full items-center px-2 text-sm text-text-secondary'>
        <span className='px-4'>{codeLanguageLabel(block.language)}</span>
        <button
          type='button'
          aria-label={t('editor.copy')}
          title={t('editor.copy')}
          className='ps-code-copy pointer-events-auto ml-auto rounded-[8px] border border-border-primary bg-fill-toolbar p-1 text-text-primary'
          onClick={() => {
            void copyTextToClipboard(block.text).then(() => notify.success(t('publish.copy.codeBlock')));
          }}
        >
          <CopyIcon />
        </button>
      </div>
      <CodeBlockFrame className='ps-code-content'>
        {language === 'mermaid' ? (
          <Suspense fallback={<code>{block.text}</code>}>
            <MermaidPreview source={block.text} expanded={false} showPreview onClose={closePreview} />
          </Suspense>
        ) : (
          <code>
            {tokens
              ? tokens.map(({ text, token }, index) => (
                  // The editor's `token <name>` classes, so the scoped Prism theme colours them.
                  <span key={index} className={token ? `token ${token}` : undefined}>
                    {text}
                  </span>
                ))
              : block.text}
          </code>
        )}
      </CodeBlockFrame>
    </div>
  );
}

export default memo(DocumentCode);
