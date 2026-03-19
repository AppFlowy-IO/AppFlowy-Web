import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as BulletedListSvg } from '@/assets/icons/bulleted_list.svg';

import ActionButton from './ActionButton';



export function BulletedList() {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const isActivated = CustomEditor.isBlockActive(editor, BlockType.BulletedListBlock);

  const onClick = useCallback(() => {
    try {
      const entry = getBlockEntry(editor);

      if (!entry) return;

      const [node] = entry;

      if (!node) return;

      if (node.type === BlockType.BulletedListBlock) {
        CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
        return;
      }

      CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.BulletedListBlock, {});
    } catch (e) {
      return;
    }
  }, [editor]);

  return (
    <ActionButton active={isActivated} onClick={onClick} tooltip={t('document.plugins.bulletedList')} data-testid="toolbar-bulleted-list-button">
      <BulletedListSvg className='h-4 w-4' />
    </ActionButton>
  );
}

export default BulletedList;
