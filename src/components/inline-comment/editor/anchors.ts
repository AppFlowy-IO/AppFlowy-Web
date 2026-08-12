import { Editor, Element, Node, NodeEntry, Path, Point, Range, Text, Transforms } from 'slate';
import * as Y from 'yjs';

import { YjsEditor } from '@/application/slate-yjs';
import { INLINE_COMMENT_IDS_KEY } from '@/application/slate-yjs/types';
import { calculateOffsetRelativeToParent } from '@/application/slate-yjs/utils/positions';
import { getText } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YjsEditorKey, YSharedRoot } from '@/application/types';

export { INLINE_COMMENT_IDS_KEY };

export interface InlineCommentSelection {
  range: Range;
  blockId: string;
  quotedText: string;
}

export interface InlineCommentAnchor extends InlineCommentSelection {
  commentId: string;
}

export type InlineCommentAnchorUpdate = Uint8Array | null;

interface InlineCommentFormatSegment {
  commentIds: string[] | null;
  length: number;
  start: number;
  textId: string;
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

function getFormatSegment(
  editor: Editor,
  node: Text,
  path: Path,
  range: Range,
  commentIds: string[] | null
): InlineCommentFormatSegment | null {
  const textContainer = Node.get(editor, Path.parent(path)) as Element & { textId?: string };
  const textId = textContainer.textId;

  if (!textId) return null;

  const [startPoint, endPoint] = Range.edges(range);
  const start = calculateOffsetRelativeToParent(textContainer, startPoint);
  const end = calculateOffsetRelativeToParent(textContainer, endPoint);

  if (end <= start || !Text.isText(node) || !Node.has(editor, path)) return null;

  return { commentIds, length: end - start, start, textId };
}

/**
 * Read-and-comment writes are prepared in a disposable Y.Doc. A failed HTTP
 * request therefore cannot consume clocks in the live document and leave the
 * next authorized update with a missing causal dependency.
 */
function createIsolatedAuthorizedUpdate(
  editor: Editor,
  segments: readonly InlineCommentFormatSegment[]
): InlineCommentAnchorUpdate {
  if (
    segments.length === 0 ||
    !YjsEditor.isYjsEditor(editor) ||
    !YjsEditor.connected(editor) ||
    !editor.sharedRoot.doc
  ) {
    return null;
  }

  editor.flushLocalChanges();

  const liveDoc = editor.sharedRoot.doc;
  const isolatedDoc = new Y.Doc({ guid: liveDoc.guid });

  try {
    Y.applyUpdate(isolatedDoc, Y.encodeStateAsUpdate(liveDoc));

    const beforeState = Y.encodeStateVector(isolatedDoc);
    const sharedRoot = isolatedDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

    isolatedDoc.transact(() => {
      for (const segment of segments) {
        const text = getText(segment.textId, sharedRoot);

        text?.format(segment.start, segment.length, {
          [INLINE_COMMENT_IDS_KEY]: segment.commentIds,
        });
      }
    }, CollabOrigin.InlineCommentAuthorized);

    return Y.encodeStateAsUpdate(isolatedDoc, beforeState);
  } finally {
    isolatedDoc.destroy();
  }
}

/** Apply an update only after the comment-authorized endpoint accepted it. */
export function applyAuthorizedInlineCommentUpdate(editor: Editor, update: Uint8Array): boolean {
  if (!YjsEditor.isYjsEditor(editor) || !YjsEditor.connected(editor) || !editor.sharedRoot.doc) return false;

  // The server already persisted this update. Treat it as remote locally so
  // Slate refreshes while the ordinary collaboration outbox ignores it.
  Y.applyUpdate(editor.sharedRoot.doc, update, CollabOrigin.Remote);
  return true;
}

// Every leaf render and every anchor scan calls `getInlineCommentIds`, and the
// overwhelmingly common answer is "none" — return one shared array rather than
// allocating per text node. Callers must treat the result as read-only.
const NO_INLINE_COMMENT_IDS: readonly string[] = Object.freeze([]);

export function getInlineCommentIds(node: Text): readonly string[] {
  const value: unknown = node[INLINE_COMMENT_IDS_KEY];

  // Desktop accepts the legacy scalar form while writing only string arrays.
  // Reading both avoids dropping anchors from older collaborative documents.
  if (typeof value === 'string') return value.length > 0 ? [value] : NO_INLINE_COMMENT_IDS;

  if (!Array.isArray(value)) return NO_INLINE_COMMENT_IDS;

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

function applyAnchorChange(editor: Editor, change: () => void): InlineCommentAnchorUpdate {
  if (!YjsEditor.isYjsEditor(editor) || !YjsEditor.connected(editor) || !editor.sharedRoot.doc) {
    change();
    return null;
  }

  // Do not accidentally fold a pending text edit into the anchor-only update.
  // It belongs to the normal local origin and therefore to text undo history.
  editor.flushLocalChanges();

  const doc = editor.sharedRoot.doc;
  const beforeState = Y.encodeStateVector(doc);

  change();
  editor.flushLocalChanges(CollabOrigin.InlineComment);

  return Y.encodeStateAsUpdate(doc, beforeState);
}

/**
 * Apply the cloud comment id to exactly the selected Delta segments. Each text
 * node keeps its existing ids so overlapping comments remain representable.
 *
 * The dedicated origin is not tracked by the document undo manager. For a
 * Read-and-comment editor, the returned update must be sent through the
 * comment-authorized endpoint because the normal collaboration lane rejects
 * document writes from that access level.
 */
export function addInlineCommentAnchor(
  editor: Editor,
  selection: InlineCommentSelection,
  commentId: string,
  requiresAuthorizedPersistence = false
): InlineCommentAnchorUpdate {
  const entries = Array.from(
    Editor.nodes(editor, {
      at: selection.range,
      match: Text.isText,
    })
  ).reverse();

  if (requiresAuthorizedPersistence) {
    const segments = entries.flatMap(([node, path]) => {
      if (!Text.isText(node)) return [];

      const intersection = Range.intersection(selection.range, Editor.range(editor, path));

      if (!intersection || Range.isCollapsed(intersection)) return [];

      const existingIds = getInlineCommentIds(node);
      const ids = existingIds.includes(commentId) ? [...existingIds] : [...existingIds, commentId];
      const segment = getFormatSegment(editor, node, path, intersection, ids);

      return segment ? [segment] : [];
    });

    return createIsolatedAuthorizedUpdate(editor, segments);
  }

  return applyAnchorChange(editor, () => {
    Editor.withoutNormalizing(editor, () => {
      for (const [node, path] of entries) {
        if (!Text.isText(node)) continue;

        const intersection = Range.intersection(selection.range, Editor.range(editor, path));

        if (!intersection || Range.isCollapsed(intersection)) continue;

        const existingIds = getInlineCommentIds(node);
        const ids = existingIds.includes(commentId) ? [...existingIds] : [...existingIds, commentId];

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
  });
}

export function removeInlineCommentAnchor(
  editor: Editor,
  commentId: string,
  requiresAuthorizedPersistence = false
): InlineCommentAnchorUpdate {
  const entries = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (node) => Text.isText(node) && getInlineCommentIds(node).includes(commentId),
    })
  ).reverse();

  if (requiresAuthorizedPersistence) {
    const segments = entries.flatMap(([node, path]) => {
      if (!Text.isText(node)) return [];

      const ids = getInlineCommentIds(node).filter((id) => id !== commentId);
      const segment = getFormatSegment(editor, node, path, Editor.range(editor, path), ids.length > 0 ? ids : null);

      return segment ? [segment] : [];
    });

    return createIsolatedAuthorizedUpdate(editor, segments);
  }

  return applyAnchorChange(editor, () => {
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
