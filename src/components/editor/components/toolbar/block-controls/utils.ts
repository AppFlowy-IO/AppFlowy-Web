import { Element } from 'slate';
import { ReactEditor } from 'slate-react';

import { isDatabaseBlockType } from '@/application/database-block';
import { BlockType } from '@/application/types';
import { HeadingNode } from '@/components/editor/editor.type';

function getCalloutBodyText(blockElement: HTMLElement) {
  if (
    blockElement.getAttribute('data-block-type') === BlockType.CalloutBlock ||
    !blockElement.closest('.callout-content')
  ) return null;

  return Array.from(blockElement.querySelectorAll<HTMLElement>('.text-content')).find(
    (element) => element.closest('[data-block-type]') === blockElement
  ) ?? null;
}

export function getBlockActionsPosition(editor: ReactEditor, blockElement: HTMLElement) {
  const editorDom = ReactEditor.toDOMNode(editor, editor);
  const editorDomRect = editorDom.getBoundingClientRect();
  const blockDomRect = blockElement.getBoundingClientRect();
  const parentBlockDom = blockElement.parentElement?.closest('[data-block-type]');

  let relativeTop = blockDomRect.top - editorDomRect.top;
  let relativeLeft = blockDomRect.left - editorDomRect.left;

  if (blockElement.getAttribute('data-block-type') === BlockType.CalloutBlock) {
    // Anchor the outer handle to the title icon, including headings and toggles.
    // Ignore icons belonging to callouts nested in the body.
    const icon = Array.from(blockElement.querySelectorAll('[data-testid="callout-icon-button"]')).find(
      (element) => element.closest('[data-block-type="callout"]') === blockElement
    );
    const iconRect = icon?.getBoundingClientRect();
    const title = blockElement.querySelector<HTMLElement>('.text-content');
    const content = blockElement.querySelector<HTMLElement>('.callout-content');

    if (iconRect) {
      relativeTop = iconRect.top + iconRect.height / 2 - editorDomRect.top - 14;
    } else if (title) {
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || 28;

      relativeTop = title.getBoundingClientRect().top + lineHeight / 2 - editorDomRect.top - 14;
    } else if (content) {
      relativeTop = content.getBoundingClientRect().top + 8 - editorDomRect.top;
    }
  } else {
    const text = getCalloutBodyText(blockElement);

    if (text) {
      // Body rows have their own padding and line heights, especially in toggles.
      // Anchor to the first text line rather than the block's outer edge.
      const style = getComputedStyle(text);
      const lineHeight = parseFloat(style.lineHeight) || text.getBoundingClientRect().height;
      const paddingTop = parseFloat(style.paddingTop) || 0;

      relativeTop = text.getBoundingClientRect().top + paddingTop + lineHeight / 2 - editorDomRect.top - 14;
    }
  }

  if (parentBlockDom?.getAttribute('data-block-type') === BlockType.QuoteBlock) {
    relativeLeft -= 16;
  }

  return {
    top: relativeTop,
    left: relativeLeft,
    height: blockDomRect.height,
  };
}

export function getBlockCssProperty(node: Element, blockElement: HTMLElement) {
  if (getCalloutBodyText(blockElement)) return 'callout-body-controls';

  if ((node as HeadingNode).data.level) {
    return `level-${(node as HeadingNode).data.level} mt-[3px]`;
  }

  if (isDatabaseBlockType(node.type)) {
    return 'my-1.5';
  }

  switch (node.type) {
    case BlockType.Paragraph:
    case BlockType.NumberedListBlock:
    case BlockType.BulletedListBlock:
    case BlockType.TodoListBlock:
    case BlockType.ToggleListBlock:
    case BlockType.QuoteBlock:
    case BlockType.SubpageBlock:
    case BlockType.LinkedPageBlock:
      return 'leading-[1.85em]';
    case BlockType.CalloutBlock:
      return 'callout-controls';
    case BlockType.OutlineBlock:
      return 'py-[7px]';
    case BlockType.TableBlock:
      return 'my-3';
    case BlockType.GalleryBlock:
      return 'my-4';
    case BlockType.DividerBlock:
      return 'my-[-4px]';
    default:
      return 'my-2';
  }
}

export function findEventNode(
  editor: ReactEditor,
  {
    x,
    y,
  }: {
    x: number;
    y: number;
  }
): Element | null {
  const element = document.elementFromPoint(x, y);
  const nodeDom = element?.closest('[data-block-type]');

  if (nodeDom) {
    const type = nodeDom.getAttribute('data-block-type') as BlockType;

    if ([BlockType.ColumnBlock, BlockType.ColumnsBlock].includes(type)) {
      const firstDom = element?.closest(
        `[data-block-type]:not([data-block-type="${BlockType.ColumnBlock}"]):not([data-block-type="${BlockType.ColumnsBlock}"])`
      );

      if (firstDom) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return ReactEditor.toSlateNode(editor, firstDom);
      } else {
        return null;
      }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return ReactEditor.toSlateNode(editor, nodeDom);
  }

  return null;
}
