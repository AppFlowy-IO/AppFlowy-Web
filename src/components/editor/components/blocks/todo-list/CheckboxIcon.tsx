import React, { useCallback } from 'react';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ensureValidSelection } from '@/application/slate-yjs/utils/transformSelection';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { TodoListNode } from '@/components/editor/editor.type';

function CheckboxIcon({ block, className }: { block: TodoListNode; className: string }) {
  const { checked } = block.data;
  const editor = useSlateStatic();
  const readOnly = useReadOnly() || editor.isElementReadOnly(block as unknown as Element);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) {
        return;
      }

      e.stopPropagation();
      e.preventDefault();
      ensureValidSelection(editor);
      editor.collapse({
        edge: 'end',
      });

      CustomEditor.toggleTodoList(editor as YjsEditor, block.blockId, e.shiftKey);
    },
    [block, editor, readOnly]
  );

  return (
    <span
      onClick={handleClick}
      data-playwright-selected={false}
      contentEditable={false}
      draggable={false}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      className={`${className} ${readOnly ? '' : 'cursor-pointer hover:text-text-action'} pr-1 text-xl`}
    >
      {checked ? (
        <CheckboxCheckSvg />
      ) : (
        <CheckboxUncheckSvg className={'text-border-primary hover:text-border-primary-hover'} />
      )}
    </span>
  );
}

export default CheckboxIcon;
