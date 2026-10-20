import { useEffect } from 'react';
import { Node } from 'slate';

import { CodeNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Log } from '@/utils/log';

import { normalizeCodeLanguage } from './constants';

export function useCodeBlock(node: CodeNode) {
  const language = normalizeCodeLanguage(node.data.language);
  const { addCodeGrammars } = useEditorContext();
  // Detection follows content only in Auto mode. Explicit languages never reload on typing.
  const sample = language === 'auto' ? Node.string(node).slice(0, 5000) : '';
  const blockId = node.blockId;

  useEffect(() => {
    if (language === 'plaintext' || (language === 'auto' && !sample.trim())) {
      addCodeGrammars?.(blockId, 'plaintext');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void (async () => {
          const { default: highlighter } = await import('./code-grammars');

          // The import may finish after another keystroke or after the block unmounts.
          if (cancelled) return;
          let detected = language;

          if (language === 'auto') {
            detected = highlighter.highlightAuto(sample).language ?? 'plaintext';
          }

          const grammar = normalizeCodeLanguage(detected);

          if (!cancelled) addCodeGrammars?.(blockId, highlighter.getLanguage(grammar) ? grammar : 'plaintext');
        })().catch((error: unknown) => {
          if (!cancelled) Log.warn('Unable to load code highlighting', language, error);
          if (!cancelled) addCodeGrammars?.(blockId, 'plaintext');
        });
      },
      language === 'auto' ? 150 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addCodeGrammars, blockId, language, sample]);

  return { language };
}
