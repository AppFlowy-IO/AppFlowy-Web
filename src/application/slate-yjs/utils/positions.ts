import { CONTAINER_BLOCK_TYPES, SOFT_BREAK_TYPES } from '@/application/slate-yjs/command/const';
import { slateNodeToDeltaInsert } from '@/application/slate-yjs/utils/convert';
import { BlockType, YSharedRoot } from '@/application/types';
import { BasePoint, BaseRange, Node, Element, Editor, NodeEntry, Text } from 'slate';
import { RelativeRange } from '../types';
import * as Y from 'yjs';
import { getText, getTextMap } from '@/application/slate-yjs/utils/yjs';

export function slateRangeToRelativeRange(
  sharedRoot: YSharedRoot,
  editor: Editor,
  range: BaseRange,
): RelativeRange {

  const { point: anchor, entry: anchorEntry } = slatePointToRelativePosition(sharedRoot, editor, range.anchor);
  const { point: focus, entry: focusEntry } = slatePointToRelativePosition(sharedRoot, editor, range.focus);

  return { anchor, focus, anchorEntry, focusEntry };
}

export function relativeRangeToSlateRange(
  sharedRoot: YSharedRoot,
  range: RelativeRange,
): BaseRange | null {
  const anchor = relativePositionToSlatePoint(sharedRoot, range.anchor, range.anchorEntry);
  const focus = relativePositionToSlatePoint(sharedRoot, range.focus, range.focusEntry);

  if (!anchor || !focus) {
    return null;
  }

  return { anchor, focus };
}

export function slatePointToRelativePosition(
  sharedRoot: YSharedRoot,
  editor: Editor,
  point: BasePoint,
): {
  point: Y.RelativePosition;
  entry: NodeEntry<Element>;
} {
  if (!Editor.hasPath(editor, point.path)) {
    throw new Error('Point is not in the editor');
  }

  const [textEntry] = editor.nodes({
    at: point,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.textId !== undefined,
  });

  if (!textEntry) {
    const [entry] = editor.nodes({
      at: point,
      match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined,
    });

    return {
      point: Y.createRelativePositionFromTypeIndex(sharedRoot, 0),
      entry: entry as NodeEntry<Element>,
    };

  }

  const [node] = textEntry as NodeEntry<Element>;

  if (!node) {
    throw new Error('Node not found');
  }

  const textId = node.textId as string;
  let ytext = getText(textId, sharedRoot);

  if (!ytext && [
    ...CONTAINER_BLOCK_TYPES,
    ...SOFT_BREAK_TYPES,
    BlockType.HeadingBlock,
  ].includes(node.type as BlockType)) {
    const newYText = new Y.Text();
    const textMap = getTextMap(sharedRoot);
    const ops = (node.children as Text[]).map(slateNodeToDeltaInsert);

    newYText.applyDelta(ops);
    textMap.set(textId, newYText);
    ytext = newYText;
  }

  if (ytext) {
    const offset = Math.min(calculateOffsetRelativeToParent(node, point), ytext.length);

    const relPos = Y.createRelativePositionFromTypeIndex(ytext, offset);

    return {
      point: relPos,
      entry: textEntry as NodeEntry<Element>,
    };
  }

  return {
    point: Y.createRelativePositionFromTypeIndex(sharedRoot, 0),
    entry: textEntry as NodeEntry<Element>,
  };

}

export function calculateOffsetRelativeToParent(slateNode: Element, point: BasePoint): number {
  const { path, offset } = point;

  if (path.length <= 1) {
    return offset;
  }

  let actualOffset = offset;

  const childIndex = path[path.length - 1];

  for (let i = 0; i < childIndex; i++) {
    const childNode = slateNode.children[i];

    actualOffset += Node.string(childNode).length;
  }

  return actualOffset;
}

export function relativePositionToSlatePoint(
  sharedRoot: YSharedRoot,
  position: Y.RelativePosition,
  entry: NodeEntry<Element>,
): BasePoint | null {
  if (!sharedRoot.doc) {
    throw new Error('sharedRoot isn\'t attach to a yDoc');
  }

  const absPos = Y.createAbsolutePositionFromRelativePosition(
    position,
    sharedRoot.doc,
  );

  if (!absPos) {
    return null;
  }

  const [node, path] = entry;

  if (!node) {
    return null;
  }

  const absIndex = absPos.index;

  return calculatePointFromParentOffset(node, path, absIndex);
}

export function calculatePointFromParentOffset(slateNode: Element, path: number[], parentOffset: number): BasePoint {
  let remainingOffset = parentOffset;
  let childIndex = 0;

  for (childIndex = 0; childIndex < slateNode.children.length; childIndex++) {
    const childNode = slateNode.children[childIndex];

    if (!childNode) {
      break;
    }

    const childLength = Node.string(childNode).length;

    if (remainingOffset <= childLength) {
      break;
    }

    remainingOffset -= childLength;
  }

  if (childIndex === slateNode.children.length) {
    childIndex--;
    remainingOffset = Node.string(slateNode.children[childIndex]).length;
  }

  const childNode = slateNode.children[childIndex];

  if (Text.isText(childNode)) {
    return {
      path: [...path, childIndex],
      offset: remainingOffset,
    };
  }

  return calculatePointFromParentOffset(childNode, [...path, childIndex], remainingOffset);
}

