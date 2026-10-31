import { BlockType } from '@/application/types';
import type { OutlineHeading } from '@/components/editor/components/blocks/outline/utils';

import { presentedChildren } from './document-content';
import { documentUnitKey } from './document-pagination';

import type { DocumentSlide } from './source';
import type { SourceBlock } from './types';

export function documentOutline(sections: DocumentSlide[]) {
  const headings: OutlineHeading[] = [];
  const targets = new Map<string, { key: string; toggles: string[] }>();

  function visit(block: SourceBlock, key: string, toggles: string[]) {
    if (
      ['heading', 'toggle_list'].includes(block.type) &&
      Number.isInteger(block.level) &&
      block.level! >= 1 &&
      block.level! <= 6
    ) {
      headings.push({
        blockId: block.id,
        type: BlockType.HeadingBlock,
        data: { level: block.level!, text: block.headingText ?? block.text.trim() },
        children: [],
      });
      targets.set(block.id, { key, toggles });
    }

    const ancestors = block.type === 'toggle_list' ? [...toggles, block.id] : toggles;

    presentedChildren(block).forEach((child) => visit(child, key, ancestors));
  }

  sections.forEach((section, sectionIndex) =>
    section.blocks.forEach((block, blockIndex) => visit(block, documentUnitKey(sectionIndex, blockIndex), []))
  );
  return { headings, targets };
}
