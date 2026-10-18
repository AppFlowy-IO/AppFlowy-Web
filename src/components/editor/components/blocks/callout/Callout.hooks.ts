import { Editor, Element } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { BlockType } from '@/application/types';

/** Whether the block sits inside a callout body, which restyles toggles. */
export function useInsideCallout(node: Element) {
  const editor = useSlateStatic();

  return !!Editor.above(editor, {
    at: ReactEditor.findPath(editor, node),
    match: (ancestor) => Element.isElement(ancestor) && ancestor.type === BlockType.CalloutBlock,
  });
}
