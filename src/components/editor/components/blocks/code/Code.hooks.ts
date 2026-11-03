import { useEffect } from 'react';
import { Editor, Element, Node, Range, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { CodeNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Log } from '@/utils/log';

import { normalizeCodeLanguage } from './constants';

export function useCodeBlock(node: CodeNode) {
  const editor = useSlateStatic();
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
    const publishGrammar = (grammar: string) => {
      if (cancelled) return;
      const selection = window.getSelection();

      // Native selectionchange is throttled by Slate. A delayed grammar can
      // replace the clicked leaf before that event updates the model, restoring
      // the previous caret. Capture the current code selection first.
      if (selection?.rangeCount && ReactEditor.isFocused(editor)) {
        const range = ReactEditor.toSlateRange(editor, selection, { exactMatch: false, suppressThrow: true });

        if (
          range &&
          Editor.above(editor, {
            at: range,
            match: (element) => Element.isElement(element) && element.blockId === blockId,
          }) &&
          (!editor.selection || !Range.equals(editor.selection, range))
        ) {
          Transforms.select(editor, range);
        }
      }

      addCodeGrammars?.(blockId, grammar);
    };

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

          publishGrammar(highlighter.getLanguage(grammar) ? grammar : 'plaintext');
        })().catch((error: unknown) => {
          if (!cancelled) Log.warn('Unable to load code highlighting', language, error);
          publishGrammar('plaintext');
        });
      },
      language === 'auto' ? 150 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addCodeGrammars, blockId, editor, language, sample]);

  return { language };
}
