import { Element, Node, Text } from 'slate';

import { BlockType, YjsEditorKey } from '@/application/types';

/** Preserve TeX when equations leave AppFlowy's rich clipboard format. */
export function mathFragmentText(nodes: Node[]): string | null {
  const hasMath = (node: Node): boolean =>
    Text.isText(node)
      ? node.formula !== undefined
      : Element.isElement(node) && (node.type === BlockType.EquationBlock || node.children.some(hasMath));
  const serialize = (node: Node): string => {
    if (Text.isText(node)) return node.formula !== undefined ? `$${node.formula}$` : node.text;
    if (Element.isElement(node) && node.type === BlockType.EquationBlock) {
      return `$$\n${(node.data as { formula?: string })?.formula || ''}\n$$`;
    }

    const inline = Element.isElement(node) && (node.type === YjsEditorKey.text || node.children.every(Text.isText));

    return node.children.map(serialize).join(inline ? '' : '\n');
  };

  return nodes.some(hasMath) ? nodes.map(serialize).join('\n') : null;
}
