import { FC, useCallback, useMemo } from 'react';
import { Editor, Element } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';

import { BlockType } from '@/application/types';
import { BulletedListIcon } from '@/components/editor/components/blocks/bulleted-list';
import {
  CALLOUT_FIRST_CHILD_TEXT_TYPES,
  getCalloutIcon,
} from '@/components/editor/components/blocks/callout/callout.utils';
import CalloutIcon from '@/components/editor/components/blocks/callout/CalloutIcon';
import { NumberListIcon } from '@/components/editor/components/blocks/numbered-list';
import CheckboxIcon from '@/components/editor/components/blocks/todo-list/CheckboxIcon';
import ToggleIcon from '@/components/editor/components/blocks/toggle-list/ToggleIcon';
import { CalloutNode, TextNode } from '@/components/editor/editor.type';

export function useStartIcon(node: TextNode) {
  const editor = useSlate();
  const path = ReactEditor.findPath(editor, node);
  const block = Editor.parent(editor, path)?.[0] as Element | null;
  const blockPath = path.slice(0, -1);
  const parent = blockPath.length > 1 ? Editor.parent(editor, blockPath)[0] : null;
  const callout =
    block &&
    CALLOUT_FIRST_CHILD_TEXT_TYPES.has(block.type as BlockType) &&
    blockPath[blockPath.length - 1] === 0 &&
    Element.isElement(parent) &&
    parent.type === BlockType.CalloutBlock
      ? (parent as CalloutNode)
      : null;

  const Component = useMemo(() => {
    if (!Element.isElement(block)) {
      return null;
    }

    switch (block.type) {
      case BlockType.TodoListBlock:
        return CheckboxIcon;
      case BlockType.ToggleListBlock:
        return ToggleIcon;
      case BlockType.NumberedListBlock:
        return NumberListIcon;
      case BlockType.BulletedListBlock:
        return BulletedListIcon;
      case BlockType.CalloutBlock:
        return getCalloutIcon((block as CalloutNode).data) ? CalloutIcon : null;
      default:
        return null;
    }
  }, [block]) as FC<{ block: Element; className: string }> | null;

  const renderIcon = useCallback(() => {
    if ((!Component && !callout) || !block) {
      return null;
    }

    const classList = ['text-block-icon relative select-none w-6 h-6'];

    return (
      <>
        {callout && (
          <span
            contentEditable={false}
            className='callout-title-icon absolute -left-9'
            style={{ top: 'max(0px, calc((1.5em - 28px) / 2 + 2px))' }}
          >
            <span className='text-base'>
              <CalloutIcon block={callout} />
            </span>
          </span>
        )}
        {Component && <Component className={classList.join(' ')} block={block} />}
      </>
    );
  }, [Component, block, callout]);

  return {
    hasStartIcon: !!Component,
    renderIcon,
  };
}
