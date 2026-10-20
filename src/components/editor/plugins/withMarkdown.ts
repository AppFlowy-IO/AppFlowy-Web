import { TextInsertTextOptions } from 'slate/dist/interfaces/transforms/text';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { isCodeSelection } from '@/components/editor/components/blocks/code/code-keyboard';
import { allTriggerChars, applyMarkdown } from '@/components/editor/utils/markdown';

export const withMarkdown = (editor: ReactEditor) => {
  const { insertText } = editor;

  editor.insertText = (text: string, options?: TextInsertTextOptions) => {
    if (
      !isCodeSelection(editor) &&
      allTriggerChars.has(text) &&
      applyMarkdown(editor as ReactEditor & YjsEditor, text)
    ) {
      return;
    }

    insertText(text, options);
  };

  return editor;
};
