import { Editor, Element, Node, NodeEntry, Path, Point, Range, Text, Transforms } from 'slate';

import { INLINE_COMMENT_IDS_KEY } from '@/application/slate-yjs/types';
import { BlockType } from '@/application/types';

export { INLINE_COMMENT_IDS_KEY };

export interface InlineCommentSelection {
  range: Range;
  blockId: string;
  quotedText: string;
}

export interface InlineCommentAnchor extends InlineCommentSelection {
  commentId: string;
}

function copyRange(range: Range): Range {
  return {
    anchor: { path: [...range.anchor.path], offset: range.anchor.offset },
    focus: { path: [...range.focus.path], offset: range.focus.offset },
  };
}

function getBlockEntry(editor: Editor, point: Point): NodeEntry<Element> | undefined {
  const entry = Editor.above(editor, {
    at: point,
    match: (node) => !Editor.isEditor(node) && Element.isElement(node) && typeof node.blockId === 'string',
  });

  if (!entry || !Element.isElement(entry[0])) return undefined;
  return entry;
}

export function getInlineCommentIds(node: Text): string[] {
  const value: unknown = node[INLINE_COMMENT_IDS_KEY];

  // Desktop accepts the legacy scalar form while writing only string arrays.
  // Reading both avoids dropping anchors from older collaborative documents.
  if (typeof value === 'string') return value.length > 0 ? [value] : [];

  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0)));
}

export function getInlineCommentSelection(
  editor: Editor,
  at: Range | null = editor.selection
): InlineCommentSelection | null {
  if (!at || Range.isCollapsed(at)) return null;

  const [start, end] = Range.edges(at);
  const startBlock = getBlockEntry(editor, start);
  const endBlock = getBlockEntry(editor, end);

  if (!startBlock || !endBlock) return null;

  const [startNode, startPath] = startBlock;
  const [endNode, endPath] = endBlock;
  const blockId = startNode.blockId;

  if (
    typeof blockId !== 'string' ||
    blockId.length === 0 ||
    blockId !== endNode.blockId ||
    !Path.equals(startPath, endPath) ||
    startNode.type === BlockType.CodeBlock
  ) {
    return null;
  }

  const quotedText = Editor.string(editor, at);

  if (!quotedText.trim()) return null;

  return {
    range: copyRange(at),
    blockId,
    quotedText,
  };
}

/**
 * Apply the cloud comment id to exactly the selected Delta segments. Each text
 * node keeps its existing ids so overlapping comments remain representable.
 */
export function addInlineCommentAnchor(editor: Editor, selection: InlineCommentSelection, commentId: string): void {
  const entries = Array.from(
    Editor.nodes(editor, {
      at: selection.range,
      match: Text.isText,
    })
  ).reverse();

  Editor.withoutNormalizing(editor, () => {
    for (const [node, path] of entries) {
      if (!Text.isText(node)) continue;

      const intersection = Range.intersection(selection.range, Editor.range(editor, path));

      if (!intersection || Range.isCollapsed(intersection)) continue;

      const ids = getInlineCommentIds(node);

      if (!ids.includes(commentId)) {
        ids.push(commentId);
      }

      Transforms.setNodes(
        editor,
        { [INLINE_COMMENT_IDS_KEY]: ids },
        {
          at: intersection,
          match: Text.isText,
          split: true,
        }
      );
    }
  });
}

export function removeInlineCommentAnchor(editor: Editor, commentId: string): void {
  const entries = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (node) => Text.isText(node) && getInlineCommentIds(node).includes(commentId),
    })
  ).reverse();

  Editor.withoutNormalizing(editor, () => {
    for (const [node, path] of entries) {
      if (!Text.isText(node) || !Node.has(editor, path)) continue;

      const ids = getInlineCommentIds(node).filter((id) => id !== commentId);

      if (ids.length > 0) {
        Transforms.setNodes(editor, { [INLINE_COMMENT_IDS_KEY]: ids }, { at: path });
      } else {
        Transforms.unsetNodes(editor, INLINE_COMMENT_IDS_KEY, { at: path });
      }
    }
  });
}

export function collectInlineCommentAnchors(editor: Editor): Map<string, InlineCommentAnchor> {
  const segments = new Map<
    string,
    {
      first: Point;
      last: Point;
      blockId: string;
      text: string[];
    }
  >();

  for (const [node, path] of Editor.nodes(editor, { at: [], match: Text.isText })) {
    if (!Text.isText(node)) continue;

    const ids = getInlineCommentIds(node);

    if (ids.length === 0) continue;

    const range = Editor.range(editor, path);
    const block = getBlockEntry(editor, range.anchor);
    const blockId = block?.[0].blockId;

    if (typeof blockId !== 'string' || blockId.length === 0) continue;

    for (const id of ids) {
      const segment = segments.get(id);

      if (segment) {
        segment.last = range.focus;
        segment.text.push(node.text);
      } else {
        segments.set(id, {
          first: range.anchor,
          last: range.focus,
          blockId,
          text: [node.text],
        });
      }
    }
  }

  const anchors = new Map<string, InlineCommentAnchor>();

  for (const [commentId, segment] of segments) {
    anchors.set(commentId, {
      commentId,
      blockId: segment.blockId,
      quotedText: segment.text.join(''),
      range: {
        anchor: segment.first,
        focus: segment.last,
      },
    });
  }

  return anchors;
}

export function inlineCommentAnchorsEqual(
  left: ReadonlyMap<string, InlineCommentAnchor>,
  right: ReadonlyMap<string, InlineCommentAnchor>
): boolean {
  if (left.size !== right.size) return false;

  for (const [id, leftAnchor] of left) {
    const rightAnchor = right.get(id);

    if (
      !rightAnchor ||
      leftAnchor.blockId !== rightAnchor.blockId ||
      leftAnchor.quotedText !== rightAnchor.quotedText ||
      !Range.equals(leftAnchor.range, rightAnchor.range)
    ) {
      return false;
    }
  }

  return true;
}
