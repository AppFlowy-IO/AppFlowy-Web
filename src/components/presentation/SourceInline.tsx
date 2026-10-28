import { useState } from 'react';
import { createEditor, type Descendant } from 'slate';
import { Editable, Slate, withReact, type RenderElementProps } from 'slate-react';

import { Leaf } from '@/components/editor/components/leaf/Leaf';

import type { SourceBlock } from './types';

const renderLine = ({ attributes, children }: RenderElementProps) => <span {...attributes}>{children}</span>;

/** The same leaves as the document editor, backed only by a detached read-only value. */
export default function SourceInline({ block }: { block: SourceBlock }) {
  const [editor] = useState(() => withReact(createEditor()));
  const [value] = useState<Descendant[]>(() => [
    {
      type: 'paragraph',
      children: structuredClone(block.richText ?? [{ text: block.text }]),
    } as Descendant,
  ]);

  return (
    <Slate editor={editor} initialValue={value}>
      <Editable
        as='span'
        readOnly
        tabIndex={-1}
        renderElement={renderLine}
        renderLeaf={Leaf}
        className='ps-source-inline outline-none'
      />
    </Slate>
  );
}
