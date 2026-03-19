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
      const entry = getBlockEntry(editor);

      if (!entry) return;

      const [node] = entry;

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
    <ActionButton active={isActivated} onClick={onClick} tooltip={t('document.plugins.numberedList')} data-testid="toolbar-numbered-list-button">
      <NumberedListSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default NumberedList;
