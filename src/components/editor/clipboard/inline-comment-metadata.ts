import { Element, Node, Text } from 'slate';

import { INLINE_COMMENT_IDS_KEY } from '@/application/slate-yjs/types';

/**
 * Comment ids identify a thread in the source document and are never portable
 * content. Strip them from every rich fragment while preserving all ordinary
 * marks and block metadata.
 */
export function stripInlineCommentIds(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    if (Text.isText(node)) {
      if (!Object.prototype.hasOwnProperty.call(node, INLINE_COMMENT_IDS_KEY)) return node;

      const next = { ...node } as Record<string, unknown>;

      delete next[INLINE_COMMENT_IDS_KEY];
      return next as unknown as Text;
    }

    if (Element.isElement(node)) {
      const children = stripInlineCommentIds(node.children);

      if (children.every((child, index) => child === node.children[index])) return node;

      return { ...node, children } as Element;
    }

    return node;
  });
}
