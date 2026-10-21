import { useMemo } from 'react';

import { CodeBlockData } from '@/application/types';

import highlighter from './code-grammars';
import { normalizeCodeLanguage } from './constants';

/** Highlight.js escapes source before adding its own token spans. */
export default function HighlightedCode({ text, data }: { text: string; data: CodeBlockData }) {
  const language = normalizeCodeLanguage(data.language);
  const html = useMemo(() => {
    if (language === 'plaintext' || !highlighter.getLanguage(language)) return;
    return highlighter.highlight(text, { language, ignoreIllegals: true }).value;
  }, [language, text]);

  return (
    <pre>
      <code
        className='code-response-source'
        {...(html ? { dangerouslySetInnerHTML: { __html: html } } : { children: text })}
      />
    </pre>
  );
}
