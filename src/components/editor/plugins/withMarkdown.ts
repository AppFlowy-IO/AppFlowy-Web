import { TextInsertTextOptions } from 'slate/dist/interfaces/transforms/text';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { isCodeSelection } from '@/components/editor/components/blocks/code/code-keyboard';
import { allTriggerChars, applyMarkdown } from '@/components/editor/utils/markdown';
import { applyMathShortcut } from '@/components/editor/utils/math-equation';

export const withMarkdown = (editor: ReactEditor) => {
  const { insertText } = editor;

  editor.insertText = (text: string, options?: TextInsertTextOptions) => {
    // Code stays literal for both single keystrokes and whole-string IME input.
    if (isCodeSelection(editor)) {
      insertText(text, options);
      return;
    }

    // IMEs and accessibility input can deliver an entire equation in one event.
    // Delay the empty $$ shortcut when the same event contains its formula.
    if (text.length > 1 && text.includes('$') && !options?.at) {
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const opensDisplay = character === '$' && text[index - 1] === '$' && text[index - 2] !== '$' && /^([^$\n]+)\$\$/.test(text.slice(index + 1));

        if (character === '$' && !opensDisplay && applyMathShortcut(editor as ReactEditor & YjsEditor)) continue;
        insertText(character, options);
      }

      return;
    }

    if (allTriggerChars.has(text) && applyMarkdown(editor as ReactEditor & YjsEditor, text)) {
      return;
    }

    insertText(text, options);
  };

  return editor;
};
