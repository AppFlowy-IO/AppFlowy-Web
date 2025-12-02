import isEqual from 'lodash-es/isEqual';
import { BasePoint, BaseRange, Editor, Element, Node, NodeEntry, Path, Range, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { LIST_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { YjsEditor } from '@/application/slate-yjs/plugins/withYjs';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import {
  addBlock,
  beforePasted,
  findSlateEntryByBlockId,
  getAffectedBlocks,
  getBlockEntry,
  getSelectionOrThrow,
  getSelectionTexts,
  getSharedRoot,
  handleCollapsedBreakWithTxn,
  handleDeleteEntireDocumentWithTxn,
  handleLiftBlockOnBackspaceAndEnterWithTxn,
  handleMergeBlockBackwardWithTxn,
  handleMergeBlockForwardWithTxn,
  handleNonParagraphBlockBackspaceAndEnterWithTxn,
  handleRangeBreak,
  preventIndentNode,
  preventLiftNode,
  removeRangeWithTxn,
} from '@/application/slate-yjs/utils/editor';
import { findNearestValidSelection, isValidSelection } from '@/application/slate-yjs/utils/transformSelection';
import {
  dataStringTOJson,
  deepCopyBlock,
  deleteBlock,
  executeOperations,
  getBlock,
  getBlockIndex,
  getParent,
  getPreviousSiblingBlock,
  indentBlock,
  liftBlock,
  turnToBlock,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import {
  BlockData,
  BlockType,
  Mention,
  MentionType,
  TodoListBlockData,
  ToggleListBlockData,
  YjsEditorKey,
} from '@/application/types';
import { EditorInlineAttributes } from '@/slate-editor';
import { Log } from '@/utils/log';
import { renderDate } from '@/utils/time';

export const CustomEditor = {
  getEditorContent(editor: YjsEditor) {
    const allNodes = editor.children ?? [];

    return allNodes
      .map((node) => {
        return CustomEditor.getBlockTextContent(node);
      })
      .join('\n');
  },

  getSelectionContent(editor: YjsEditor, range?: Range) {
    const at = range || editor.selection;

    if (!at) return '';

    return editor.string(at);
  },
  // Get the text content of a block node, including the text content of its children and formula nodes
  getBlockTextContent(node: Node, depth: number = Infinity): string {
    if (Text.isText(node)) {
      if (node.formula) {
        return node.formula;
      }

      if (node.mention) {
        if (node.mention.type === MentionType.Date) {
          const date = node.mention.date || '';
          const isUnix = date?.length === 10;

          return renderDate(date, 'MMM DD, YYYY', isUnix);
        } else {
          const name = document.querySelector('[data-mention-id="' + node.mention.page_id + '"]')?.textContent || '';

          return name;
        }
      }

      return node.text || '';
    }

    if (depth <= 0) {
      return ''; // Prevent infinite recursion
    }

    return node.children.map((n) => CustomEditor.getBlockTextContent(n, depth - 1)).join('');
  },

  setBlockData<T = BlockData>(editor: YjsEditor, blockId: string, updateData: T, select?: boolean) {
    const block = getBlock(blockId, editor.sharedRoot);
    const oldData = dataStringTOJson(block.get(YjsEditorKey.block_data));
    const newData = {
      ...oldData,
      ...updateData,
    };

    const newProperties = {
      data: newData,
    } as Partial<Element>;
    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) {
      Log.error('Block not found');
      return;
    }

    const [, path] = entry;
    let atChild = false;
    const { selection } = editor;

    if (selection && Path.isAncestor(path, selection.anchor.path)) {
      atChild = true;
    }

    Transforms.setNodes(editor, newProperties, { at: path });

    if (!select) return;

    if (atChild) {
      Transforms.select(editor, Editor.start(editor, path));
    }
  },
  // Insert break line at the specified path
  insertBreak(editor: YjsEditor, at?: BaseRange) {
    const sharedRoot = getSharedRoot(editor);
    const newAt = getSelectionOrThrow(editor, at);

    const isCollapsed = Range.isCollapsed(newAt);

    if (isCollapsed) {
      handleCollapsedBreakWithTxn(editor, sharedRoot, newAt);
    } else {
      handleRangeBreak(editor, sharedRoot, newAt);
    }
  },

  deleteBlockBackward(editor: YjsEditor, at?: BaseRange) {
    Log.trace('deleteBlockBackward', editor.selection, at);

    const sharedRoot = getSharedRoot(editor);
    const newAt = getSelectionOrThrow(editor, at);

    const isCollapsed = Range.isCollapsed(newAt);

    if (isCollapsed) {
      const point = newAt.anchor;

      const blockEntry = getBlockEntry(editor, point);

      if (!blockEntry) {
        Log.warn('Block not found', point);
        return;
      }

      const [node, path] = blockEntry;
      const block = getBlock(node.blockId as string, sharedRoot);
      const blockType = block.get(YjsEditorKey.block_type);
      const parent = getParent(node.blockId as string, sharedRoot);

      if (
        blockType !== BlockType.Paragraph &&
        parent?.get(YjsEditorKey.block_type) === BlockType.QuoteBlock &&
        LIST_BLOCK_TYPES.includes(blockType)
      ) {
        handleNonParagraphBlockBackspaceAndEnterWithTxn(editor, sharedRoot, block, point);
        return;
      }

      if (path.length > 1 && handleLiftBlockOnBackspaceAndEnterWithTxn(editor, sharedRoot, block, point)) {
        return;
      }

      if (blockType !== BlockType.Paragraph) {
        handleNonParagraphBlockBackspaceAndEnterWithTxn(editor, sharedRoot, block, point);
        return;
      }

      handleMergeBlockBackwardWithTxn(editor, node, point);
    } else {
      Transforms.collapse(editor, { edge: 'start' });
      removeRangeWithTxn(editor, sharedRoot, newAt);
    }
  },

  deleteBlockForward(editor: YjsEditor, at?: BaseRange) {
    const sharedRoot = getSharedRoot(editor);
    const newAt = getSelectionOrThrow(editor, at);

    const isCollapsed = Range.isCollapsed(newAt);

    if (isCollapsed) {
      const point = newAt.anchor;

      const blockEntry = getBlockEntry(editor, point);

      if (!blockEntry) {
        Log.warn('Block not found', point);
        return;
      }

      const [node] = blockEntry;

      handleMergeBlockForwardWithTxn(editor, node, point);
    } else {
      Transforms.collapse(editor, { edge: 'start' });
      removeRangeWithTxn(editor, sharedRoot, newAt);
    }
  },

  deleteEntireDocument(editor: YjsEditor) {
    handleDeleteEntireDocumentWithTxn(editor);
  },

  removeRange(editor: YjsEditor, at: BaseRange) {
    removeRangeWithTxn(editor, getSharedRoot(editor), at);
  },

  tabEvent(editor: YjsEditor, event: KeyboardEvent) {
    const type = event.shiftKey ? 'tabBackward' : 'tabForward';
    const sharedRoot = getSharedRoot(editor);
    const { selection } = editor;

    if (!selection) return;
    const [point, endPoint] = editor.edges(selection);
    const { middleBlocks, startBlock: node, endBlock: endNode } = getAffectedBlocks(editor, selection);

    if (type === 'tabBackward' && preventLiftNode(editor, node[0].blockId as string)) {
      return;
    }

    if (type === 'tabForward' && preventIndentNode(editor, node[0].blockId as string)) {
      return;
    }

    const startBlockPath = node[1];
    const endBlockPath = endNode[1];
    const startAtPath = point.path.slice(startBlockPath.length);
    const startAtOffset = point.offset;
    const endAtPath = endPoint.path.slice(endBlockPath.length);
    const endAtOffset = endPoint.offset;
    let newStartBlockPath: Path = [];
    let newEndBlockPath: Path = [];

    // Store original selection for fallback
    const originalSelection = { anchor: point, focus: endPoint };

    const isSameBlock = node[0].blockId === endNode[0].blockId;

    editor.deselect();
    if (isSameBlock) {
      const block = getBlock(node[0].blockId as string, sharedRoot);
      let newBlockId: string | undefined;

      executeOperations(
        sharedRoot,
        [
          () => {
            newBlockId = type === 'tabForward' ? indentBlock(sharedRoot, block) : liftBlock(sharedRoot, block);
          },
        ],
        type === 'tabForward' ? 'indentBlock' : 'liftBlock'
      );

      if (!newBlockId) return;
      const newBlockEntry = findSlateEntryByBlockId(editor, newBlockId);

      if (!newBlockEntry) return;

      newStartBlockPath = newBlockEntry[1];
      newEndBlockPath = newStartBlockPath;
    } else {
      const blocks = [node, ...middleBlocks, endNode] as NodeEntry<Element>[];
      const blockResults: Array<{
        originalId: string;
        newId: string | null;
        isStart: boolean;
        isEnd: boolean;
      }> = [];

      blocks.forEach((entry, index) => {
        const blockId = entry[0].blockId as string;
        const block = getBlock(blockId, sharedRoot);
        const isStart = index === 0;
        const isEnd = index === blocks.length - 1;

        if (!block) return;

        let newBlockId: string | null = null;

        executeOperations(
          sharedRoot,
          [
            () => {
              const result =
                type === 'tabForward' ? indentBlock(sharedRoot, block) : liftBlock(sharedRoot, block, index);

              newBlockId = result || null;
            },
          ],
          type === 'tabForward' ? 'indentBlock' : 'liftBlock'
        );

        blockResults.push({
          originalId: blockId,
          newId: newBlockId,
          isStart,
          isEnd,
        });
      });

      // Find new start and end block entries
      const startResult = blockResults.find((r) => r.isStart);
      const endResult = blockResults.find((r) => r.isEnd);

      if (!startResult?.newId || !endResult?.newId) {
        Log.warn('Failed to get new block IDs after tab operation');
        return;
      }

      const newStartBlockEntry = findSlateEntryByBlockId(editor, startResult.newId);
      const newEndBlockEntry = findSlateEntryByBlockId(editor, endResult.newId);

      if (!newStartBlockEntry || !newEndBlockEntry) {
        Log.warn('Failed to find new block entries after tab operation');
        // Try to restore selection using original selection
        const fallbackSelection = findNearestValidSelection(editor, originalSelection);

        if (fallbackSelection) {
          Transforms.select(editor, fallbackSelection);
        }

        return;
      }

      newStartBlockPath = newStartBlockEntry[1];
      newEndBlockPath = newEndBlockEntry[1];
    }

    // Safely construct new selection paths with validation
    let newSelection: Range | null = null;

    try {
      const newStartPath = [...newStartBlockPath, ...startAtPath];
      const newEndPath = [...newEndBlockPath, ...endAtPath];

      // Validate paths exist and are within bounds
      const startPathValid = Editor.hasPath(editor, newStartPath);
      const endPathValid = Editor.hasPath(editor, newEndPath);

      if (startPathValid && endPathValid) {
        // Validate offsets are within text bounds
        const startText = Editor.string(editor, newStartPath);
        const endText = Editor.string(editor, newEndPath);
        const clampedStartOffset = Math.max(0, Math.min(startAtOffset, startText.length));
        const clampedEndOffset = Math.max(0, Math.min(endAtOffset, endText.length));

        newSelection = {
          anchor: {
            path: newStartPath,
            offset: clampedStartOffset,
          },
          focus: {
            path: newEndPath,
            offset: clampedEndOffset,
          },
        };
      }
    } catch (error) {
      Log.warn('Error constructing new selection paths:', error);
      newSelection = null;
    }

    // Try to apply the new selection, with multiple fallback strategies
    if (newSelection && isValidSelection(editor, newSelection)) {
      Log.debug('✅ Using calculated selection:', newSelection);
      Transforms.select(editor, newSelection);
    } else {
      Log.warn('⚠️ Calculated selection invalid, trying fallback strategies');

      // Strategy 1: Try to find nearest valid selection from our calculated selection
      if (newSelection) {
        const nearestFromCalculated = findNearestValidSelection(editor, newSelection);

        if (nearestFromCalculated) {
          Log.debug('✅ Using nearest from calculated:', nearestFromCalculated);
          Transforms.select(editor, nearestFromCalculated);
          return;
        }
      }

      // Strategy 2: Try to find nearest valid selection from original selection
      const nearestFromOriginal = findNearestValidSelection(editor, originalSelection);

      if (nearestFromOriginal) {
        Log.debug('✅ Using nearest from original:', nearestFromOriginal);
        Transforms.select(editor, nearestFromOriginal);
        return;
      }

      // Strategy 3: Try to select the start of the first affected block
      if (newStartBlockPath.length > 0) {
        try {
          const startOfBlock = Editor.start(editor, newStartBlockPath);

          if (isValidSelection(editor, { anchor: startOfBlock, focus: startOfBlock })) {
            Log.debug('✅ Using start of block:', startOfBlock);
            Transforms.select(editor, startOfBlock);
            return;
          }
        } catch (error) {
          Log.warn('Failed to select start of block:', error);
        }
      }

      // Strategy 4: Last resort - find any valid selection in the document
      const documentSelection = findNearestValidSelection(editor, null);

      if (documentSelection) {
        Log.debug('✅ Using document fallback:', documentSelection);
        Transforms.select(editor, documentSelection);
      } else {
        Log.warn('❌ Could not establish any valid selection after tab operation');
      }
    }
  },

  toggleToggleList(editor: YjsEditor, blockId: string) {
    const sharedRoot = getSharedRoot(editor);
    const data = dataStringTOJson(getBlock(blockId, sharedRoot).get(YjsEditorKey.block_data)) as ToggleListBlockData;
    const { selection } = editor;

    if (selection && Range.isExpanded(selection)) {
      Transforms.collapse(editor, { edge: 'start' });
    }

    let selected = false;

    if (selection) {
      const point = Editor.start(editor, selection);

      const blockEntry = getBlockEntry(editor, point);

      if (!blockEntry) {
        Log.warn('Block not found', point);
        return;
      }

      const [node] = blockEntry;

      selected = node.blockId !== blockId;
    }

    CustomEditor.setBlockData(
      editor,
      blockId,
      {
        collapsed: !data.collapsed,
      },
      selected
    );
  },

  toggleTodoList(editor: YjsEditor, blockId: string, shiftKey: boolean) {
    const sharedRoot = getSharedRoot(editor);
    const block = getBlock(blockId, sharedRoot);
    const data = dataStringTOJson(block.get(YjsEditorKey.block_data)) as TodoListBlockData;
    const checked = data.checked;

    if (!shiftKey) {
      CustomEditor.setBlockData(
        editor,
        blockId,
        {
          checked: !checked,
        },
        false
      );
      return;
    }

    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) return;

    const [, path] = entry;
    const [start, end] = editor.edges(path);

    const toggleBlockNodes = Array.from(
      Editor.nodes(editor, {
        at: {
          anchor: start,
          focus: end,
        },
        match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.TodoListBlock,
      })
    ) as unknown as NodeEntry<Element>[];

    toggleBlockNodes.forEach(([node]) => {
      CustomEditor.setBlockData(
        editor,
        node.blockId as string,
        {
          checked: !checked,
        },
        false
      );
    });
  },

  toggleMark(
    editor: ReactEditor,
    {
      key,
      value,
    }: {
      key: EditorMarkFormat;
      value: boolean | string;
    }
  ) {
    if (CustomEditor.isMarkActive(editor, key)) {
      CustomEditor.removeMark(editor, key);
    } else {
      CustomEditor.addMark(editor, {
        key,
        value,
      });
    }
  },

  getTextNodes(editor: ReactEditor) {
    return getSelectionTexts(editor);
  },

  addMark(
    editor: ReactEditor,
    {
      key,
      value,
    }: {
      key: EditorMarkFormat;
      value: boolean | string | Mention;
    }
  ) {
    editor.addMark(key, value);
  },

  removeMark(editor: ReactEditor, key: EditorMarkFormat) {
    editor.removeMark(key);
  },

  turnToBlock<T extends BlockData>(editor: YjsEditor, blockId: string, type: BlockType, data: T) {
    const operations: (() => void)[] = [];
    const sharedRoot = getSharedRoot(editor);
    const sourceBlock = getBlock(blockId, sharedRoot);
    const sourceType = sourceBlock.get(YjsEditorKey.block_type);
    const oldData = dataStringTOJson(sourceBlock.get(YjsEditorKey.block_data));

    if (sourceType === type && isEqual(oldData, data)) {
      return;
    }

    let newBlockId: string | undefined;

    operations.push(() => {
      newBlockId = turnToBlock(sharedRoot, sourceBlock, type, data);
    });

    executeOperations(sharedRoot, operations, 'turnToBlock');
    return newBlockId;
  },

  isBlockActive(editor: YjsEditor, type: BlockType) {
    try {
      const entry = getBlockEntry(editor);

      if (!entry) return false;

      const [node] = entry;

      return node.type === type;
    } catch (e) {
      return false;
    }
  },

  hasMark(editor: ReactEditor, key: string) {
    const selection = editor.selection;

    if (!selection) return false;

    const isExpanded = Range.isExpanded(selection);

    if (isExpanded) {
      try {
        const texts = getSelectionTexts(editor);

        return texts.some((node) => {
          const { text, ...attributes } = node;

          if (!text) return true;
          return Boolean((attributes as Record<string, boolean | string>)[key]);
        });
      } catch (error) {
        Log.warn('Error checking mark in expanded selection:', error);
        return false;
      }
    }

    try {
      const marks = Editor.marks(editor) as Record<string, string | boolean> | null;

      return marks ? !!marks[key] : false;
    } catch (error) {
      Log.warn('Error checking mark at collapsed selection:', error);
      return false;
    }
  },

  getAllMarks(editor: ReactEditor) {
    const selection = editor.selection;

    if (!selection) return [];

    if (!isValidSelection(editor, selection)) return [];

    const isExpanded = Range.isExpanded(selection);

    if (isExpanded) {
      try {
        const texts = getSelectionTexts(editor);

        return texts.map((node) => {
          const { text, ...attributes } = node;

          if (!text) return {};
          return attributes as EditorInlineAttributes;
        });
      } catch (error) {
        Log.warn('Error getting all marks:', error);
        return [];
      }
    }

    try {
      const marks = Editor.marks(editor) as EditorInlineAttributes;

      return [marks];
    } catch (error) {
      Log.warn('Error getting marks at collapsed selection:', error);
      return [];
    }
  },

  isMarkActive(editor: ReactEditor, key: string) {
    try {
      const selection = editor.selection;

      if (!selection) return false;

      const isExpanded = Range.isExpanded(selection);

      if (isExpanded) {
        const texts = getSelectionTexts(editor);

        return texts.every((node) => {
          const { text, ...attributes } = node;

          if (!text) return true;
          return Boolean((attributes as Record<string, boolean | string>)[key]);
        });
      }

      const marks = Editor.marks(editor) as Record<string, string | boolean> | null;

      return marks ? !!marks[key] : false;
    } catch (e) {
      return false;
    }
  },

  addChildBlock(editor: YjsEditor, blockId: string, type: BlockType, data: BlockData) {
    const sharedRoot = getSharedRoot(editor);
    const parent = getBlock(blockId, sharedRoot);

    if (!parent) {
      Log.warn('Parent block not found');
      return;
    }

    const newBlockId = addBlock(
      editor,
      {
        ty: type,
        data,
      },
      parent,
      0
    );

    if (!newBlockId) {
      Log.warn('Failed to add block');
      return;
    }

    try {
      const entry = findSlateEntryByBlockId(editor, newBlockId);

      if (!entry) return;

      const [, path] = entry;

      if (path) {
        ReactEditor.focus(editor);
        const point = editor.start(path);

        Transforms.select(editor, point);
        return newBlockId;
      }
    } catch (e) {
      Log.error(e);
    }
  },

  addBlock(editor: YjsEditor, blockId: string, direction: 'below' | 'above', type: BlockType, data: BlockData) {
    const parent = getParent(blockId, editor.sharedRoot);
    const index = getBlockIndex(blockId, editor.sharedRoot);

    if (!parent) return;

    const newBlockId = addBlock(
      editor,
      {
        ty: type,
        data,
      },
      parent,
      direction === 'below' ? index + 1 : index
    );

    if (!newBlockId) {
      return;
    }

    // Skip focus and selection for database blocks (Grid, Board, Calendar)
    // as they open in a modal and don't need cursor positioning
    const isDatabaseBlock = [BlockType.GridBlock, BlockType.BoardBlock, BlockType.CalendarBlock].includes(type);

    if (isDatabaseBlock) {
      return newBlockId;
    }

    try {
      const entry = findSlateEntryByBlockId(editor, newBlockId);

      if (!entry) return;

      const [, path] = entry;

      if (path) {
        ReactEditor.focus(editor);
        const point = editor.start(path);

        Transforms.select(editor, point);
        return newBlockId;
      }
    } catch (e) {
      Log.error(e);
    }
  },

  addBelowBlock(editor: YjsEditor, blockId: string, type: BlockType, data: BlockData) {
    return CustomEditor.addBlock(editor, blockId, 'below', type, data);
  },

  addAboveBlock(editor: YjsEditor, blockId: string, type: BlockType, data: BlockData) {
    return CustomEditor.addBlock(editor, blockId, 'above', type, data);
  },

  deleteBlock(editor: YjsEditor, blockId: string) {
    const sharedRoot = getSharedRoot(editor);
    const parent = getParent(blockId, sharedRoot);

    if (!parent) {
      Log.warn('Parent block not found');
      return;
    }

    try {
      const prevBlockId = getPreviousSiblingBlock(sharedRoot, getBlock(blockId, sharedRoot));
      let point: BasePoint | undefined;

      if (!prevBlockId) {
        if (parent.get(YjsEditorKey.block_type) !== BlockType.Page) {
          const entry = findSlateEntryByBlockId(editor, parent.get(YjsEditorKey.block_id));

          if (!entry) return;

          const [, path] = entry;

          point = editor.start(path);
        }
      } else {
        const entry = findSlateEntryByBlockId(editor, prevBlockId);

        if (!entry) return;

        const [, path] = entry;

        point = editor.end(path);
      }

      if (
        point &&
        ReactEditor.hasRange(editor, {
          anchor: point,
          focus: point,
        })
      ) {
        Transforms.select(editor, point);
      } else {
        Transforms.deselect(editor);
      }
    } catch (e) {
      // do nothing
    }

    executeOperations(
      sharedRoot,
      [
        () => {
          deleteBlock(sharedRoot, blockId);
        },
      ],
      'deleteBlock'
    );
    const children = editor.children;

    if (children.length === 0) {
      addBlock(
        editor,
        {
          ty: BlockType.Paragraph,
          data: {},
        },
        parent,
        0
      );
    }

    ReactEditor.focus(editor);
  },

  duplicateBlock(editor: YjsEditor, blockId: string, prevId?: string) {
    const sharedRoot = getSharedRoot(editor);
    const block = getBlock(blockId, sharedRoot);

    const parent = getParent(blockId, sharedRoot);
    const prevIndex = getBlockIndex(prevId || blockId, sharedRoot);

    if (!parent) {
      Log.warn('Parent block not found');
      return;
    }

    let newBlockId: string | null = null;

    executeOperations(
      sharedRoot,
      [
        () => {
          newBlockId = deepCopyBlock(sharedRoot, block);

          if (!newBlockId) {
            Log.warn('Copied block not found');
            return;
          }

          const copiedBlock = getBlock(newBlockId, sharedRoot);

          updateBlockParent(sharedRoot, copiedBlock, parent, prevIndex + 1);
        },
      ],
      'duplicateBlock'
    );

    return newBlockId;
  },

  pastedText(editor: YjsEditor, text: string) {
    if (!beforePasted(editor)) return;

    const point = editor.selection?.anchor as BasePoint;

    Transforms.insertNodes(editor, { text }, { at: point, select: true, voids: false });
  },

  highlight(editor: ReactEditor) {
    const selection = editor.selection;

    if (!selection) return;

    const [start, end] = Range.edges(selection);

    if (isEqual(start, end)) return;

    const marks = CustomEditor.getAllMarks(editor);

    marks.forEach((mark) => {
      if (mark[EditorMarkFormat.BgColor]) {
        CustomEditor.removeMark(editor, EditorMarkFormat.BgColor);
      } else {
        CustomEditor.addMark(editor, {
          key: EditorMarkFormat.BgColor,
          value: '#ffeb3b',
        });
      }
    });
  },
};
