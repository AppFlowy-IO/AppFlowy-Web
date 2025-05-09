import { Element, Node, Text } from 'slate';
import { TextCount } from '@/application/types';

export function getTextCount(nodes: Node[]): TextCount {
  let text = '';

  const getAllText = (node: Node): void => {
    if(Text.isText(node)) {
      if(node.formula) {
        text += node.formula;
      } else {
        text += node.text;
      }
    } else if(Element.isElement(node)) {
      text += '\n';
      node.children.forEach(getAllText);
    }
  };

  nodes.forEach(getAllText);

  return {
    characters: getCharacters(text),
    words: getWords(text),
  };
}

export function getCharacters(text: string) {
  return text.replace(/\s/g, '').length;
}

export function getWords(text: string) {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}
