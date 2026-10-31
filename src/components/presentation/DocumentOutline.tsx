import { createContext, useContext, useMemo } from 'react';

import { OutlineContent } from '@/components/editor/components/blocks/outline/OutlineContent';
import { nestHeadings, type OutlineHeading } from '@/components/editor/components/blocks/outline/utils';

import type { SourceBlock } from './types';

export const DocumentOutlineContext = createContext<{
  headings: OutlineHeading[];
  onNavigate: (id: string) => void;
}>({ headings: [], onNavigate: () => undefined });

export default function DocumentOutline({ block }: { block: SourceBlock }) {
  const { headings, onNavigate } = useContext(DocumentOutlineContext);
  const root = useMemo(
    () => nestHeadings(headings.filter((heading) => heading.data.level <= (block.outline?.depth || 6))),
    [headings, block.outline?.depth]
  );

  return (
    <OutlineContent
      root={root}
      hasHeadings={headings.length > 0}
      color={block.outline?.color ?? block.style?.backgroundColor}
      jumpToHeading={(heading) => onNavigate(heading.blockId)}
      contentEditable={false}
    />
  );
}
