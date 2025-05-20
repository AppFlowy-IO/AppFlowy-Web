import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as NumberedListSvg } from '@/assets/icons/numbered_list.svg';

import ActionButton from './ActionButton';

export function NumberedList() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const isActivated = CustomEditor.isBlockActive(editor, BlockType.NumberedListBlock);

  const onClick = useCallback(() => {
    try {
      const [node] = getBlockEntry(editor);

      if (!node) return;

      if (node.type === BlockType.NumberedListBlock) {
        CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
        return;
      }

      CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.NumberedListBlock, {});
    } catch (e) {
      return;
    }
  }, [editor]);

  return (
    <ActionButton active={isActivated} onClick={onClick} tooltip={t('document.plugins.numberedList')}>
      <NumberedListSvg className='h-5 w-5' />
    </ActionButton>
  );
}

export default NumberedList;
