import { lazy, memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { notify } from '@/components/_shared/notify';
import { CodeBlockFrame } from '@/components/editor/components/blocks/code/CodeBlockFrame';
import { supportLanguages } from '@/components/editor/components/blocks/code/constants';
import { copyTextToClipboard } from '@/utils/copy';

import { codeLanguage, tokenizeCode } from './code-languages';
import './document-code.scss';
import '@/components/editor/components/blocks/code/code.scss';

import type { SourceBlock } from './types';
import type { Token } from 'prismjs';
import type { ReactNode } from 'react';

const MermaidPreview = lazy(() => import('@/components/editor/components/blocks/code/MermaidPreview'));
const closePreview = () => undefined;

function renderTokens(tokens: string | Token | Array<string | Token>): ReactNode {
  if (typeof tokens === 'string') return tokens;
  if (Array.isArray(tokens)) return tokens.map((token, index) => <span key={index}>{renderTokens(token)}</span>);
  return (
    <span className={`token ${tokens.type} ${[tokens.alias ?? []].flat().join(' ')}`}>
      {renderTokens(tokens.content)}
    </span>
  );
}

function DocumentCode({ block }: { block: SourceBlock }) {
  const { t } = useTranslation();
  const language = codeLanguage(block.language);
  const tokens = useMemo(() => renderTokens(tokenizeCode(block.text, language)), [block.text, language]);
  const label =
    supportLanguages.find((item) => item.id === block.language?.toLowerCase())?.title ?? block.language ?? 'Plain text';

  return (
    <div className='ps-document-code relative my-0.5 w-full' data-code-language={language}>
      <div className='ps-code-heading pointer-events-none absolute z-10 flex h-12 w-full items-center px-2 text-sm text-text-secondary'>
        <span className='px-4'>{label}</span>
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
          <code>{tokens}</code>
        )}
      </CodeBlockFrame>
    </div>
  );
}

export default memo(DocumentCode);
