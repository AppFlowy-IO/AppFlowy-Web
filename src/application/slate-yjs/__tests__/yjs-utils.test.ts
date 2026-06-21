import { describe, it, expect, beforeEach } from '@jest/globals';
import * as Y from 'yjs';

import {
  createBlock,
  createEmptyDocument,
  getBlock,
  getChildrenArray,
  getText,
  initializeDocumentStructure,
  pageIdFromDocumentId,
  turnToBlock,
  updateBlockParent,
} from '../utils/yjs';
import { YjsEditorKey, BlockType, YBlock, YSharedRoot } from '@/application/types';

const LOCAL_ORIGIN = 'local';

function getDocumentData(doc: Y.Doc) {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const document = sharedRoot.get(YjsEditorKey.document);
  const pageId = document.get(YjsEditorKey.page_id);
  const blocks = document.get(YjsEditorKey.blocks);
  const meta = document.get(YjsEditorKey.meta);
  const childrenMap = meta.get(YjsEditorKey.children_map);
  const textMap = meta.get(YjsEditorKey.text_map);

  return { sharedRoot, document, pageId, blocks, meta, childrenMap, textMap };
}

function createTextBlock({
  sharedRoot,
  parent,
  type,
  data,
  text,
}: {
  sharedRoot: YSharedRoot;
  parent: YBlock;
  type: BlockType;
  data: Record<string, unknown>;
  text: string;
}) {
  const block = createBlock(sharedRoot, { ty: type, data });
  const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);

  updateBlockParent(sharedRoot, block, parent, parentChildren?.length ?? 0);

  const yText = getText(block.get(YjsEditorKey.block_external_id), sharedRoot);

  if (!yText) {
    throw new Error(`Text entry not found for block ${block.get(YjsEditorKey.block_id)}`);
  }

  yText.applyDelta([{ insert: text }]);

  return block;
}

function getRequiredText(block: YBlock, sharedRoot: YSharedRoot) {
  const text = getText(block.get(YjsEditorKey.block_external_id), sharedRoot);

  if (!text) {
    throw new Error(`Text entry not found for block ${block.get(YjsEditorKey.block_id)}`);
  }

  return text;
}

describe('pageIdFromDocumentId', () => {
  it('should generate deterministic page_id from valid UUID', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    const pageId1 = pageIdFromDocumentId(documentId);
    const pageId2 = pageIdFromDocumentId(documentId);

    // Should be deterministic - same input produces same output
    expect(pageId1).toBe(pageId2);

    // Should be a valid UUID format
    expect(pageId1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate different page_ids for different document_ids', () => {
    const documentId1 = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    const documentId2 = '7f02259c-f53b-67c2-c1b1-69gcbb42663e';

    const pageId1 = pageIdFromDocumentId(documentId1);
    const pageId2 = pageIdFromDocumentId(documentId2);

    expect(pageId1).not.toBe(pageId2);
  });

  it('should handle non-UUID strings by generating UUID first', () => {
    const nonUuidString = 'some-random-string';
    const pageId = pageIdFromDocumentId(nonUuidString);

    // Should still produce a valid UUID
    expect(pageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Should be deterministic
    expect(pageIdFromDocumentId(nonUuidString)).toBe(pageId);
  });
});

describe('initializeDocumentStructure', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('should create basic document structure without initial paragraph', () => {
    initializeDocumentStructure(doc, false);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);

    expect(document).toBeDefined();

    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);

    expect(pageId).toBeDefined();
    expect(blocks).toBeDefined();
    expect(meta).toBeDefined();

    // Should have page block
    const pageBlock = blocks.get(pageId);
    expect(pageBlock).toBeDefined();
    expect(pageBlock.get(YjsEditorKey.block_type)).toBe(BlockType.Page);

    // Page should have no children (no initial paragraph)
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    expect(pageChildren.toArray()).toHaveLength(0);
  });

  it('should create document structure with initial paragraph', () => {
    initializeDocumentStructure(doc, true);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);

    // Page should have one child (paragraph)
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    expect(pageChildren.toArray()).toHaveLength(1);

    // Verify the child is a paragraph
    const paragraphId = pageChildren.get(0);
    const paragraphBlock = blocks.get(paragraphId);
    expect(paragraphBlock).toBeDefined();
    expect(paragraphBlock.get(YjsEditorKey.block_type)).toBe(BlockType.Paragraph);
    expect(paragraphBlock.get(YjsEditorKey.block_parent)).toBe(pageId);
  });

  it('should use deterministic page_id when documentId is provided', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    initializeDocumentStructure(doc, false, documentId);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);

    // Page ID should match what pageIdFromDocumentId returns
    const expectedPageId = pageIdFromDocumentId(documentId);
    expect(pageId).toBe(expectedPageId);
  });

  it('should skip initialization if document already exists', () => {
    // First initialization
    initializeDocumentStructure(doc, false);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const originalPageId = document.get(YjsEditorKey.page_id);

    // Second initialization should be skipped
    initializeDocumentStructure(doc, true, 'different-doc-id');

    // Page ID should remain the same (not overwritten)
    const pageIdAfter = document.get(YjsEditorKey.page_id);
    expect(pageIdAfter).toBe(originalPageId);
  });

  it('should create text entries in textMap', () => {
    initializeDocumentStructure(doc, true);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const meta = document.get(YjsEditorKey.meta);
    const textMap = meta.get(YjsEditorKey.text_map);

    // Should have text entry for page
    expect(textMap.has(pageId)).toBe(true);

    // Should have text entry for paragraph
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    const paragraphId = pageChildren.get(0);
    expect(textMap.has(paragraphId)).toBe(true);
  });

  it('should turn text blocks in place without changing block or text ids', () => {
    initializeDocumentStructure(doc, true);

    const { sharedRoot, pageId, blocks, childrenMap, textMap } = getDocumentData(doc);
    const pageChildren = childrenMap.get(pageId);
    const paragraphId = pageChildren.get(0);
    const paragraphBlock = blocks.get(paragraphId);
    const text = textMap.get(paragraphId);

    text.applyDelta([{ insert: 'Hello AppFlowy' }]);

    // No children: this is the safe in-place path. A heading conversion should
    // update the existing block and text entry so undo/redo can restore only
    // type/data instead of deleting and recreating the block.
    const undoManager = new Y.UndoManager(sharedRoot, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    let newBlockId: string | undefined;

    doc.transact(() => {
      newBlockId = turnToBlock(sharedRoot, paragraphBlock, BlockType.HeadingBlock, {
        level: 2,
      });
    }, LOCAL_ORIGIN);

    expect(newBlockId).toBe(paragraphId);
    expect(blocks.get(paragraphId)).toBe(paragraphBlock);
    expect(pageChildren.toArray()).toEqual([paragraphId]);
    expect(paragraphBlock.get(YjsEditorKey.block_type)).toBe(BlockType.HeadingBlock);
    expect(JSON.parse(paragraphBlock.get(YjsEditorKey.block_data))).toEqual({ level: 2 });
    expect(paragraphBlock.get(YjsEditorKey.block_external_id)).toBe(paragraphId);
    expect(textMap.get(paragraphId).toDelta()).toEqual([{ insert: 'Hello AppFlowy' }]);

    undoManager.undo();

    expect(blocks.get(paragraphId)).toBe(paragraphBlock);
    expect(pageChildren.toArray()).toEqual([paragraphId]);
    expect(paragraphBlock.get(YjsEditorKey.block_type)).toBe(BlockType.Paragraph);
    expect(textMap.get(paragraphId).toDelta()).toEqual([{ insert: 'Hello AppFlowy' }]);

    undoManager.redo();

    expect(blocks.get(paragraphId)).toBe(paragraphBlock);
    expect(pageChildren.toArray()).toEqual([paragraphId]);
    expect(paragraphBlock.get(YjsEditorKey.block_type)).toBe(BlockType.HeadingBlock);
    expect(JSON.parse(paragraphBlock.get(YjsEditorKey.block_data))).toEqual({ level: 2 });
    expect(textMap.get(paragraphId).toDelta()).toEqual([{ insert: 'Hello AppFlowy' }]);
  });
});

describe('turnToBlock', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initializeDocumentStructure(doc, false);
  });

  it('should preserve nested block ids when converting between child-compatible list types', () => {
    const { sharedRoot, pageId, blocks, childrenMap } = getDocumentData(doc);
    const pageBlock = getBlock(pageId, sharedRoot);
    const parent = createTextBlock({
      sharedRoot,
      parent: pageBlock,
      type: BlockType.TodoListBlock,
      data: { checked: false },
      text: '1. Parent task',
    });
    const child1 = createTextBlock({
      sharedRoot,
      parent,
      type: BlockType.TodoListBlock,
      data: { checked: false },
      text: 'First child',
    });
    const child2 = createTextBlock({
      sharedRoot,
      parent,
      type: BlockType.TodoListBlock,
      data: { checked: false },
      text: 'Second child',
    });
    const parentId = parent.get(YjsEditorKey.block_id);
    const child1Id = child1.get(YjsEditorKey.block_id);
    const child2Id = child2.get(YjsEditorKey.block_id);
    const pageChildren = childrenMap.get(pageId);
    const parentChildren = childrenMap.get(parentId);

    // Unlike heading, numbered lists can keep the same child shape. This covers
    // the safe in-place path for nested blocks and verifies undo/redo does not
    // regenerate parent, child, or text ids.
    const undoManager = new Y.UndoManager(sharedRoot, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    let newBlockId: string | undefined;

    doc.transact(() => {
      newBlockId = turnToBlock(sharedRoot, parent, BlockType.NumberedListBlock, { number: 1 });
    }, LOCAL_ORIGIN);

    expect(newBlockId).toBe(parentId);
    expect(blocks.get(parentId)).toBe(parent);
    expect(pageChildren.toArray()).toEqual([parentId]);
    expect(parentChildren.toArray()).toEqual([child1Id, child2Id]);
    expect(parent.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(JSON.parse(parent.get(YjsEditorKey.block_data))).toEqual({ number: 1 });
    expect(child1.get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(child2.get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(getRequiredText(parent, sharedRoot).toDelta()).toEqual([{ insert: '1. Parent task' }]);
    expect(getRequiredText(child1, sharedRoot).toDelta()).toEqual([{ insert: 'First child' }]);
    expect(getRequiredText(child2, sharedRoot).toDelta()).toEqual([{ insert: 'Second child' }]);

    undoManager.undo();

    expect(blocks.get(parentId)).toBe(parent);
    expect(pageChildren.toArray()).toEqual([parentId]);
    expect(parentChildren.toArray()).toEqual([child1Id, child2Id]);
    expect(parent.get(YjsEditorKey.block_type)).toBe(BlockType.TodoListBlock);
    expect(JSON.parse(parent.get(YjsEditorKey.block_data))).toEqual({ checked: false });
    expect(child1.get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(child2.get(YjsEditorKey.block_parent)).toBe(parentId);

    undoManager.redo();

    expect(blocks.get(parentId)).toBe(parent);
    expect(pageChildren.toArray()).toEqual([parentId]);
    expect(parentChildren.toArray()).toEqual([child1Id, child2Id]);
    expect(parent.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(JSON.parse(parent.get(YjsEditorKey.block_data))).toEqual({ number: 1 });
    expect(child1.get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(child2.get(YjsEditorKey.block_parent)).toBe(parentId);
  });

  it('should flatten children when converting a nested numbered list to heading', () => {
    const { sharedRoot, pageId, blocks, childrenMap } = getDocumentData(doc);
    const pageBlock = getBlock(pageId, sharedRoot);
    const parent = createTextBlock({
      sharedRoot,
      parent: pageBlock,
      type: BlockType.NumberedListBlock,
      data: { number: 1 },
      text: 'Parent item',
    });
    const child1 = createTextBlock({
      sharedRoot,
      parent,
      type: BlockType.NumberedListBlock,
      data: { number: 1 },
      text: 'First nested item',
    });
    const child2 = createTextBlock({
      sharedRoot,
      parent,
      type: BlockType.NumberedListBlock,
      data: { number: 2 },
      text: 'Second nested item',
    });
    const parentId = parent.get(YjsEditorKey.block_id);
    const child1Id = child1.get(YjsEditorKey.block_id);
    const child2Id = child2.get(YjsEditorKey.block_id);
    const pageChildren = childrenMap.get(pageId);

    // Historical AppFlowy PR #6516 covered this corner case: heading blocks
    // cannot contain children, so nested list children must become siblings
    // below the converted heading instead of staying under the heading.
    const undoManager = new Y.UndoManager(sharedRoot, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    let headingId: string | undefined;

    doc.transact(() => {
      headingId = turnToBlock(sharedRoot, parent, BlockType.HeadingBlock, { level: 1 });
    }, LOCAL_ORIGIN);

    const flattenedChildIds = pageChildren.toArray().slice(1);
    const flattenedChild1 = blocks.get(flattenedChildIds[0]);
    const flattenedChild2 = blocks.get(flattenedChildIds[1]);

    expect(headingId).not.toBe(parentId);
    expect(blocks.has(parentId)).toBe(false);
    expect(blocks.has(child1Id)).toBe(false);
    expect(blocks.has(child2Id)).toBe(false);
    expect(pageChildren.toArray()).toEqual([headingId, ...flattenedChildIds]);
    expect(pageChildren.toArray()).toHaveLength(3);
    expect(blocks.get(headingId).get(YjsEditorKey.block_type)).toBe(BlockType.HeadingBlock);
    expect(childrenMap.get(headingId).toArray()).toEqual([]);
    expect(getRequiredText(blocks.get(headingId), sharedRoot).toDelta()).toEqual([{ insert: 'Parent item' }]);
    expect(flattenedChild1.get(YjsEditorKey.block_parent)).toBe(pageId);
    expect(flattenedChild2.get(YjsEditorKey.block_parent)).toBe(pageId);
    expect(flattenedChild1.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(flattenedChild2.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(getRequiredText(flattenedChild1, sharedRoot).toDelta()).toEqual([{ insert: 'First nested item' }]);
    expect(getRequiredText(flattenedChild2, sharedRoot).toDelta()).toEqual([{ insert: 'Second nested item' }]);

    undoManager.undo();

    expect(pageChildren.toArray()).toEqual([parentId]);
    expect(blocks.get(parentId).get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(childrenMap.get(parentId).toArray()).toEqual([child1Id, child2Id]);
    expect(blocks.get(child1Id).get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(blocks.get(child2Id).get(YjsEditorKey.block_parent)).toBe(parentId);
    expect(getRequiredText(blocks.get(parentId), sharedRoot).toDelta()).toEqual([{ insert: 'Parent item' }]);

    undoManager.redo();

    const redonePageChildren = pageChildren.toArray();
    const redoneHeading = blocks.get(redonePageChildren[0]);
    const redoneFlattenedChild1 = blocks.get(redonePageChildren[1]);
    const redoneFlattenedChild2 = blocks.get(redonePageChildren[2]);

    expect(redonePageChildren).toHaveLength(3);
    expect(redoneHeading.get(YjsEditorKey.block_type)).toBe(BlockType.HeadingBlock);
    expect(childrenMap.get(redoneHeading.get(YjsEditorKey.block_id)).toArray()).toEqual([]);
    expect(redoneFlattenedChild1.get(YjsEditorKey.block_parent)).toBe(pageId);
    expect(redoneFlattenedChild2.get(YjsEditorKey.block_parent)).toBe(pageId);
    expect(redoneFlattenedChild1.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(redoneFlattenedChild2.get(YjsEditorKey.block_type)).toBe(BlockType.NumberedListBlock);
    expect(getRequiredText(redoneHeading, sharedRoot).toDelta()).toEqual([{ insert: 'Parent item' }]);
    expect(getRequiredText(redoneFlattenedChild1, sharedRoot).toDelta()).toEqual([{ insert: 'First nested item' }]);
    expect(getRequiredText(redoneFlattenedChild2, sharedRoot).toDelta()).toEqual([{ insert: 'Second nested item' }]);
  });
});

describe('createEmptyDocument', () => {
  it('should create a Y.Doc with document structure', () => {
    const doc = createEmptyDocument();

    expect(doc).toBeInstanceOf(Y.Doc);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);

    expect(document).toBeDefined();
    expect(document.get(YjsEditorKey.page_id)).toBeDefined();
  });

  it('should create document without initial paragraph', () => {
    const doc = createEmptyDocument();

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const meta = document.get(YjsEditorKey.meta);
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);

    // createEmptyDocument uses includeInitialParagraph=false
    expect(pageChildren.toArray()).toHaveLength(0);
  });
});
