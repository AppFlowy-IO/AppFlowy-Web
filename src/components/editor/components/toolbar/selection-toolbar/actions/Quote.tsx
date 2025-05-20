import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as QuoteSvg } from '@/assets/icons/quote.svg';

import ActionButton from './ActionButton';

export function Quote() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const isActivated = CustomEditor.isBlockActive(editor, BlockType.QuoteBlock);

  const onClick = useCallback(() => {
    try {
      const [node] = getBlockEntry(editor);

      if (!node) return;

      if (node.type === BlockType.QuoteBlock) {
        CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
        return;
      }

      CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.QuoteBlock, {});
    } catch (e) {
      return;
    }
  }, [editor]);

  return (
    <ActionButton active={isActivated} onClick={onClick} tooltip={t('editor.quote')}>
      <QuoteSvg className='h-5 w-5' />
    </ActionButton>
  );
}

export default Quote;
