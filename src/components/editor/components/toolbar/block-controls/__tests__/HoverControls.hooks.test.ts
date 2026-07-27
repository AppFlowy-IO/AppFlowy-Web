import { Element } from 'slate';

import { BlockType } from '@/application/types';
import {
  getTableHoverControlsRoot,
  shouldShowHoverControlsForBlock,
} from '@/components/editor/components/toolbar/block-controls/HoverControls.hooks';

describe('shouldShowHoverControlsForBlock', () => {
  const createBlockElement = (type: BlockType, parent?: HTMLElement) => {
    const element = document.createElement('div');

    element.setAttribute('data-block-type', type);
    parent?.appendChild(element);

    return element;
  };

  const createNode = (type: BlockType): Element => ({
    type,
    blockId: `${type}-block`,
    data: {},
    children: [{ text: '' }],
  } as Element);

  it('shows controls for the simple table root block', () => {
    const tableElement = createBlockElement(BlockType.SimpleTableBlock);

    expect(shouldShowHoverControlsForBlock(createNode(BlockType.SimpleTableBlock), tableElement)).toBe(true);
  });

  it('hides controls for blocks inside a simple table', () => {
    const tableElement = createBlockElement(BlockType.SimpleTableBlock);
    const paragraphElement = createBlockElement(BlockType.Paragraph, tableElement);

    expect(shouldShowHoverControlsForBlock(createNode(BlockType.Paragraph), paragraphElement)).toBe(false);
  });

  it('uses the simple table root as the controls target for nested blocks', () => {
    const tableElement = createBlockElement(BlockType.SimpleTableBlock);
    const cellElement = createBlockElement(BlockType.SimpleTableCellBlock, tableElement);
    const paragraphElement = createBlockElement(BlockType.Paragraph, cellElement);

    expect(getTableHoverControlsRoot(paragraphElement)).toBe(tableElement);
  });
});
