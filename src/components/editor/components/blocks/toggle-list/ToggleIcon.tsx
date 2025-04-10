import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ToggleListNode } from '@/components/editor/editor.type';
import React, { useCallback } from 'react';
import { ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { useSlateStatic } from 'slate-react';

function ToggleIcon({ block, className }: { block: ToggleListNode; className: string }) {
  const { collapsed } = block.data;
  const editor = useSlateStatic();

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    CustomEditor.toggleToggleList(editor as YjsEditor, block.blockId);
  }, [block.blockId, editor]);

  return (
    <span
      data-testid={'toggle-icon'}
      data-playwright-selected={false}
      contentEditable={false}
      draggable={false}
      onMouseDown={e => {
        e.preventDefault();
        handleClick(e);
      }}
      className={`${className} cursor-pointer hover:text-fill-default pr-1 toggle-icon`}
    >
      {collapsed ? <ToggleListIcon className='h-5 w-5' /> : <ToggleListIcon className={'h-w w-5 rotate-90 transform'}/>}
    </span>
  );
}

export default ToggleIcon;
