import { Editor, Element, Node, Path, Range, Text, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TEXT_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId, getBlockEntry, getSharedRoot } from '@/application/slate-yjs/utils/editor';
import { assertDocExists, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { Log } from '@/utils/log';

type BlockElement = Element & { blockId?: string };

/**
 * Inserts a sequence of pasted block elements relative to the caret,
 * mirroring the semantics of Slate's `insertFragment` (and the desktop
 * editor's paste command) while going through the YJS insertion path so
 * blocks land as siblings at the right indent level:
 *
 * - An expanded selection is deleted first, like any native paste.
 * - If the current block is empty, the pasted blocks replace it so the first
 *   block keeps its type (pasting a heading into an empty line yields a
 *   heading, not a paragraph with the heading's text).
 * - If `mergeFirstBlockInline` is set and both the first pasted block and the
 *   block under the caret can merge, the first block's inline content is
 *   inserted AT the caret instead of below the line — this is what makes
 *   paste land at the cursor position. For multi-block pastes the text after
 *   the caret moves to the end of the last pasted block, preserving reading
 *   order exactly like Slate's split-based `insertFragment`.
 * - Otherwise every block is inserted as a sibling after the current block
 *   (the previous behavior).
 *
 * Every element must be block-level with a text wrapper as its first child —
 * callers are responsible for converting/validating their input.
 *
 * Returns true when the content was inserted; false when the caller should
 * fall back to its own default handling.
 */
export function insertBlocksAtCaret(
  editor: YjsEditor,
  nodes: Element[],
  options: { mergeFirstBlockInline: boolean }
): boolean {
  if (nodes.length === 0) return false;

  try {
    // Match Slate's default `insertFragment`: a paste over an expanded
    // selection replaces it.
    if (editor.selection && Range.isExpanded(editor.selection)) {
      Transforms.delete(editor);
    }

    const entry = getBlockEntry(editor);

    if (!entry) return false;

    const [node, nodePath] = entry;
    const blockId = (node as BlockElement).blockId;

    if (!blockId) return false;

    const sharedRoot = getSharedRoot(editor);
    const block = getBlock(blockId, sharedRoot);

    if (!block) return false;

    const parentId = block.get(YjsEditorKey.block_parent);
    const parent = getBlock(parentId, sharedRoot);

    if (!parent) return false;

    const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
    const index = parentChildren.toArray().findIndex((id) => id === blockId);

    if (index < 0) return false;

    const doc = assertDocExists(sharedRoot);

    // If the current block is empty (no text, no children), the user expects
    // paste to fill that block — not push it above the pasted content. Insert
    // at the current index and remove the empty original.
    const isEmpty = CustomEditor.getBlockTextContent(node as Node).length === 0 && (node.children?.length ?? 0) <= 1;

    if (isEmpty) {
      let insertedIds: string[] = [];

      doc.transact(() => {
        insertedIds = slateContentInsertToYData(parentId, index, nodes, doc);
        CustomEditor.deleteBlock(editor, blockId);
      }, CollabOrigin.LocalManual);

      selectBlockTextOffset(editor, insertedIds[insertedIds.length - 1]);
      return true;
    }

    const mergeSource = options.mergeFirstBlockInline ? extractMergeableInlineNodes(nodes[0]) : null;

    if (mergeSource && mergeSource.length > 0 && canMergeIntoBlock(node as BlockElement, nodePath, editor.selection)) {
      insertWithFirstBlockMerged(editor, doc, mergeSource, nodes.slice(1), {
        nodePath,
        parentId,
        index,
      });
      return true;
    }

    // Default: insert every block as a sibling after the current block.
    let insertedIds: string[] = [];

    doc.transact(() => {
      insertedIds = slateContentInsertToYData(parentId, index + 1, nodes, doc);
    }, CollabOrigin.LocalManual);

    selectBlockTextOffset(editor, insertedIds[insertedIds.length - 1]);
    return true;
  } catch (err) {
    Log.error('insertBlocksAtCaret failed', err);
    return false;
  }
}

/**
 * Inserts the first pasted block's inline content at the caret and the
 * remaining blocks as siblings below. When there are remaining blocks, the
 * text after the caret moves to the end of the last pasted block so the
 * document keeps reading in order (Slate's split semantics).
 */
function insertWithFirstBlockMerged(
  editor: YjsEditor,
  doc: ReturnType<typeof assertDocExists>,
  mergeSource: Text[],
  rest: Element[],
  { nodePath, parentId, index }: { nodePath: Path; parentId: string; index: number }
) {
  const selection = editor.selection;

  if (!selection) return;

  const caret = Range.start(selection);

  if (rest.length === 0) {
    Transforms.insertNodes(editor, mergeSource, { at: caret, select: true, voids: false });
    return;
  }

  // Move the text between the caret and the end of the current line into the
  // last pasted block, when that block can hold text. Otherwise the tail
  // stays on the current line right after the merged text.
  const last = rest[rest.length - 1];
  const lastWrapper = getTextWrapper(last);
  const lastAcceptsTail = lastWrapper !== null && TEXT_BLOCK_TYPES.includes(last.type as BlockType);
  let restNodes = rest;
  let caretOffsetInLastBlock: number | null = null;

  if (lastAcceptsTail && lastWrapper) {
    const textWrapperPath = caret.path.slice(0, nodePath.length + 1);
    const wrapperEnd = Editor.end(editor, textWrapperPath);
    const tailRange: Range = { anchor: caret, focus: wrapperEnd };

    if (!Range.isCollapsed(tailRange)) {
      const tailNodes = extractInlineNodesFromRangeFragment(Editor.fragment(editor, tailRange));

      Transforms.delete(editor, { at: tailRange });

      if (tailNodes.length > 0) {
        caretOffsetInLastBlock = inlineTextLength(lastWrapper.children);
        const mergedLast = {
          ...last,
          children: [
            { ...lastWrapper, children: [...lastWrapper.children, ...tailNodes] } as Element,
            ...last.children.slice(1),
          ],
        } as Element;

        restNodes = [...rest.slice(0, -1), mergedLast];
      }
    }
  }

  Transforms.insertNodes(editor, mergeSource, { at: caret, select: true, voids: false });

  let insertedIds: string[] = [];

  doc.transact(() => {
    insertedIds = slateContentInsertToYData(parentId, index + 1, restNodes, doc);
  }, CollabOrigin.LocalManual);

  // Leave the caret at the end of the pasted content — before any moved tail.
  selectBlockTextOffset(editor, insertedIds[insertedIds.length - 1], caretOffsetInLastBlock ?? undefined);
}

/**
 * Returns the first pasted block's inline text nodes when the block is a pure
 * text block (a single text-wrapper child holding only text leaves), or null
 * when its structure cannot be merged inline.
 */
function extractMergeableInlineNodes(node: Element): Text[] | null {
  if (node.children?.length !== 1) return null;

  const wrapper = getTextWrapper(node);

  if (!wrapper) return null;

  const children = wrapper.children;

  if (!children.every((child) => Text.isText(child))) return null;

  return (children as Text[]).filter((child) => child.text.length > 0);
}

/** The block under the caret can receive inline text at the caret position. */
function canMergeIntoBlock(node: BlockElement, nodePath: Path, selection: Range | null): boolean {
  if (!selection) return false;

  const type = node.type as BlockType;

  // Code blocks take plain text only and are handled by the soft-break path.
  if (!TEXT_BLOCK_TYPES.includes(type) || type === BlockType.CodeBlock) return false;

  const wrapper = getTextWrapper(node);

  if (!wrapper) return false;

  // The caret must sit inside the block's text wrapper (child 0).
  const wrapperPath = [...nodePath, 0];

  return Path.isCommon(wrapperPath, Range.start(selection).path);
}

function getTextWrapper(node: Element): Element | null {
  const wrapper = node.children?.[0];

  if (!Element.isElement(wrapper) || wrapper.type !== YjsEditorKey.text) return null;

  return wrapper;
}

function inlineTextLength(children: Element['children']): number {
  return children.reduce((sum, child) => sum + (Text.isText(child) ? child.text.length : 0), 0);
}

/**
 * Extracts the inline text leaves from a fragment produced by
 * `Editor.fragment` over a range inside one block's text wrapper.
 */
function extractInlineNodesFromRangeFragment(fragment: Node[]): Text[] {
  const block = fragment[0];

  if (!Element.isElement(block)) return [];

  const wrapper = getTextWrapper(block);

  if (!wrapper) return [];

  return wrapper.children.filter((child): child is Text => Text.isText(child) && child.text.length > 0);
}

/**
 * Places the caret inside the given block's text: at `offset` characters into
 * its text wrapper, or at the block's end when no offset is given.
 */
function selectBlockTextOffset(editor: YjsEditor, blockId: string | undefined, offset?: number) {
  if (!blockId) return;

  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry) return;

  const [node, path] = entry;

  try {
    if (offset === undefined) {
      Transforms.select(editor, Editor.end(editor, path));
      return;
    }

    const wrapper = getTextWrapper(node);
    const wrapperPath = [...path, 0];

    if (!wrapper) {
      Transforms.select(editor, Editor.end(editor, path));
      return;
    }

    let remaining = offset;

    for (let i = 0; i < wrapper.children.length; i++) {
      const child = wrapper.children[i];

      if (!Text.isText(child)) continue;

      if (remaining <= child.text.length) {
        Transforms.select(editor, { path: [...wrapperPath, i], offset: remaining });
        return;
      }

      remaining -= child.text.length;
    }

    Transforms.select(editor, Editor.end(editor, wrapperPath));
  } catch (err) {
    // Editor.end can throw if the path was rebuilt mid-transact; the
    // selection will be re-derived on the next user keystroke.
    Log.warn('selectBlockTextOffset: could not set selection', err);
  }
}
